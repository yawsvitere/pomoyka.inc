using System.Security.Claims;
using System.Text;
using Amazon.S3;
using Amazon.Runtime;
using Feed.Api.Data;
using Feed.Api.Hubs;
using Feed.Api.Models;
using Feed.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler.DefaultInboundClaimTypeMap.Clear();


builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));


builder.Services
    .AddIdentity<AppUser, IdentityRole<Guid>>(options =>
    {

        options.Password.RequireNonAlphanumeric = false;
        options.Password.RequiredLength = 8;
        options.User.RequireUniqueEmail = true;
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();


var jwtSecret = builder.Configuration["Jwt:Secret"]
    ?? throw new InvalidOperationException("Jwt:Secret не задан");

builder.Services.AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            NameClaimType = "sub",
            RoleClaimType = ClaimTypes.Role,
            ClockSkew = TimeSpan.Zero
        };


        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) &&
                    (path.StartsWithSegments("/hubs") || path.StartsWithSegments("/api/files")))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            },
            OnTokenValidated = async context =>
            {
                var userId = context.Principal?.FindFirstValue("sub");
                if (!Guid.TryParse(userId, out var id))
                {
                    context.Fail("User ID was not found in authentication claims.");
                    return;
                }

                var userManager = context.HttpContext.RequestServices
                    .GetRequiredService<UserManager<AppUser>>();
                var user = await userManager.FindByIdAsync(id.ToString());
                if (user == null)
                {
                    context.Fail("User was not found.");
                    return;
                }

                var identity = context.Principal?.Identity as ClaimsIdentity;
                if (identity == null)
                    return;

                foreach (var claim in identity.FindAll(ClaimTypes.Role).ToList())
                    identity.RemoveClaim(claim);
                foreach (var claim in identity.FindAll("role").ToList())
                    identity.RemoveClaim(claim);

                var roles = await userManager.GetRolesAsync(user);
                foreach (var role in roles)
                {
                    identity.AddClaim(new Claim(ClaimTypes.Role, role));
                    identity.AddClaim(new Claim("role", role));
                }
            },
            OnAuthenticationFailed = context =>
            {
                Console.WriteLine($"JWT validation failed: {context.Exception.Message}");
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();


builder.Services.AddSingleton<IAmazonS3>(_ =>
{
    var config = builder.Configuration;
    var s3Config = new AmazonS3Config
    {
        ServiceURL = $"http{(config.GetValue<bool>("Minio:UseSSL") ? "s" : "")}://{config["Minio:Endpoint"]}",
        ForcePathStyle = true 
    };
    return new AmazonS3Client(
        new BasicAWSCredentials(config["Minio:AccessKey"], config["Minio:SecretKey"]),
        s3Config);
});
builder.Services.AddScoped<IStorageService, StorageService>();
builder.Services.AddScoped<AvatarImageOptimizer>();
builder.Services.AddScoped<IJwtService, JwtService>();
builder.Services.AddScoped<InviteCodeService>();
builder.Services.AddSingleton<AuthAttemptLimiter>();
builder.Services.AddScoped<PomojkaService>();


builder.Services.AddHostedService<ArchivalBackgroundService>();
builder.Services.AddHostedService<FileMetadataBackfillService>();


builder.Services.AddSignalR();


builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.AddSecurityDefinition("Bearer", new Microsoft.OpenApi.Models.OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.Http,
        Scheme = "Bearer",
        BearerFormat = "JWT",
        In = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Description = "Введи JWT токен без слова Bearer — Swagger добавит его сам"
    });

    options.AddSecurityRequirement(new Microsoft.OpenApi.Models.OpenApiSecurityRequirement
    {
        {
            new Microsoft.OpenApi.Models.OpenApiSecurityScheme
            {
                Reference = new Microsoft.OpenApi.Models.OpenApiReference
                {
                    Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});


builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        policy.WithOrigins("http://localhost:5173", "http://192.168.0.15:5173", "https://8002-2a01-ecc0-40-6c0-00-2.ngrok-free.app")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;

    var db = services.GetRequiredService<AppDbContext>();


    db.Database.Migrate();

    var roleManager = services.GetRequiredService<RoleManager<IdentityRole<Guid>>>();

    const string adminRole = "Admin";

    if (!await roleManager.RoleExistsAsync(adminRole))
    {
        var roleResult = await roleManager.CreateAsync(
            new IdentityRole<Guid>(adminRole)
        );

        if (!roleResult.Succeeded)
        {
            throw new Exception(
                "Не удалось создать роль Admin: " +
                string.Join(", ", roleResult.Errors.Select(e => e.Description))
            );
        }
    }

    var userManager = services.GetRequiredService<UserManager<AppUser>>();

    var adminEmail = builder.Configuration["ADMIN_EMAIL"];

    if (!string.IsNullOrWhiteSpace(adminEmail))
    {
        var adminUser = await userManager.FindByEmailAsync(adminEmail);

        if (adminUser != null)
        {
            var isAdmin = await userManager.IsInRoleAsync(
                adminUser,
                adminRole
            );

            if (!isAdmin)
            {
                var result = await userManager.AddToRoleAsync(
                    adminUser,
                    adminRole
                );

                if (!result.Succeeded)
                {
                    throw new Exception(
                        "Не удалось назначить Admin: " +
                        string.Join(", ", result.Errors.Select(e => e.Description))
                    );
                }
            }
        }
        else
        {
            Console.WriteLine(
                $"ADMIN_EMAIL задан ({adminEmail}), " +
                "но пользователь ещё не существует."
            );
        }
    }
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<FeedHub>("/hubs/feed");

app.Run();
