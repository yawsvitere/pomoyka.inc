using System.Data;
using System.Security.Claims;
using Feed.Api.Data;
using Feed.Api.Hubs;
using Feed.Api.Models;
using Feed.Api.Models.Dto;
using Feed.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.SignalR;

namespace Feed.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private static readonly TimeSpan OnlineWindow = TimeSpan.FromMinutes(2);
    private readonly UserManager<AppUser> _userManager;
    private readonly IJwtService _jwtService;
    private readonly InviteCodeService _inviteCodeService;
    private readonly AuthAttemptLimiter _attemptLimiter;
    private readonly AppDbContext _db;
    private readonly IHubContext<FeedHub> _feedHub;

    public AuthController(
        UserManager<AppUser> userManager,
        IJwtService jwtService,
        InviteCodeService inviteCodeService,
        AuthAttemptLimiter attemptLimiter,
        AppDbContext db,
        IHubContext<FeedHub> feedHub)
    {
        _userManager = userManager;
        _jwtService = jwtService;
        _inviteCodeService = inviteCodeService;
        _attemptLimiter = attemptLimiter;
        _db = db;
        _feedHub = feedHub;
    }

    [HttpPost("verify-code")]
    public async Task<ActionResult> VerifyCode(VerifyInviteCodeRequest request)
    {
        if (!await _userManager.Users.AnyAsync())
            return Ok(new { valid = true });

        var limiterKey = GetAttemptKey("invite");
        if (TryGetRateLimitResponse(limiterKey, out var rateLimitResponse))
            return rateLimitResponse;

        var invite = await _inviteCodeService.FindValidAsync(request.Code);
        if (invite == null)
        {
            _attemptLimiter.RecordFailure(limiterKey);
            return BadRequest(new { message = "Неверный или просроченный код приглашения" });
        }

        _attemptLimiter.RecordSuccess(limiterKey);
        return Ok(new { valid = true });
    }

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);

        var isFirstUser = !await _userManager.Users.AnyAsync();
        var limiterKey = GetAttemptKey("invite");
        if (!isFirstUser && TryGetRateLimitResponse(limiterKey, out var rateLimitResponse))
            return rateLimitResponse;

        var invite = isFirstUser
            ? null
            : await _inviteCodeService.FindValidAsync(request.InviteCode!);

        if (!isFirstUser && invite == null)
        {
            _attemptLimiter.RecordFailure(limiterKey);
            return BadRequest(new { message = "Неверный или просроченный код приглашения" });
        }

        if (!isFirstUser)
            _attemptLimiter.RecordSuccess(limiterKey);

        var existing = await _userManager.FindByEmailAsync(request.Email);
        if (existing != null)
            return Conflict(new { message = "Пользователь с таким email уже существует" });

        var user = new AppUser
        {
            UserName = request.Email,
            Email = request.Email,
            DisplayName = request.DisplayName,
            WelcomeName = isFirstUser || string.IsNullOrWhiteSpace(invite!.Name)
                ? request.DisplayName
                : invite.Name,
            NicknameColor = ValidateNicknameColor(request.NicknameColor) ? request.NicknameColor : "#4f46e5"
        };

        var result = await _userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            var errors = result.Errors.Select(TranslateIdentityError);
            return BadRequest(new { message = "Не удалось создать пользователя", errors });
        }

        if (isFirstUser)
        {
            var roleResult = await _userManager.AddToRoleAsync(user, "Admin");
            if (!roleResult.Succeeded)
                return BadRequest(new { message = "Не удалось назначить роль администратора", errors = roleResult.Errors });
        }
        else
        {
            await _inviteCodeService.MarkUsedAsync(invite!, user.Id);
        }

        await transaction.CommitAsync();

        var (token, expiresAt) = await _jwtService.GenerateTokenAsync(user);

        return Ok(new AuthResponse
        {
            Token = token,
            ExpiresAt = expiresAt,
            User = ToDto(user)
        });
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request)
    {
        var limiterKey = GetAttemptKey("login");
        if (TryGetRateLimitResponse(limiterKey, out var rateLimitResponse))
            return rateLimitResponse;

        var user = await _userManager.FindByEmailAsync(request.Email);
        if (user == null)
        {
            _attemptLimiter.RecordFailure(limiterKey);
            return Unauthorized(new { message = "Неверный email или пароль" });
        }

        var passwordValid = await _userManager.CheckPasswordAsync(user, request.Password);
        if (!passwordValid)
        {
            _attemptLimiter.RecordFailure(limiterKey);
            return Unauthorized(new { message = "Неверный email или пароль" });
        }

        _attemptLimiter.RecordSuccess(limiterKey);

        var (token, expiresAt) = await _jwtService.GenerateTokenAsync(user);

        return Ok(new AuthResponse
        {
            Token = token,
            ExpiresAt = expiresAt,
            User = ToDto(user)
        });
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<UserDto>> Me()
    {
        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();

        var user = await _userManager.FindByIdAsync(userId.Value.ToString());
        if (user == null)
            return NotFound();

        return Ok(ToDto(user));
    }

    [HttpPost("heartbeat")]
    [Authorize]
    public async Task<ActionResult> Heartbeat()
    {
        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();

        var updated = await _db.Users
            .Where(user => user.Id == userId.Value)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(user => user.LastSeenAt, DateTime.UtcNow));

        return updated == 0 ? NotFound() : NoContent();
    }

    [HttpPost("welcome-seen")]
    [Authorize]
    public async Task<ActionResult<UserDto>> MarkWelcomeAsSeen()
    {
        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();

        var user = await _userManager.FindByIdAsync(userId.Value.ToString());
        if (user == null)
            return NotFound();

        if (!user.HasSeenWelcome)
        {
            user.HasSeenWelcome = true;
            var result = await _userManager.UpdateAsync(user);
            if (!result.Succeeded)
                return BadRequest(result.Errors);
        }

        return Ok(ToDto(user));
    }

    [HttpGet("presence")]
    [Authorize]
    public async Task<ActionResult<object>> Presence()
    {
        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();

        var user = await _userManager.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == userId.Value);

        if (user == null)
            return NotFound();

        return Ok(new
        {
            isOnline = IsOnline(user),
            lastSeenAt = user.LastSeenAt
        });
    }

    [HttpPost("refresh")]
    [Authorize]
    public async Task<ActionResult<AuthResponse>> Refresh()
    {
        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();

        var user = await _userManager.FindByIdAsync(userId.Value.ToString());
        if (user == null)
            return NotFound();

        var (token, expiresAt) = await _jwtService.GenerateTokenAsync(user);
        return Ok(new AuthResponse
        {
            Token = token,
            ExpiresAt = expiresAt,
            User = ToDto(user)
        });
    }

    [HttpGet("profile/{displayName}")]
    [Authorize]
    public async Task<ActionResult<UserDto>> Profile(string displayName)
    {
        var user = await _userManager.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.DisplayName == displayName);
        return user == null ? NotFound() : Ok(ToDto(user));
    }

    [HttpPut("me")]
    [Authorize]
    public async Task<ActionResult<UserDto>> UpdateMe(UpdateProfileRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var user = await _userManager.FindByIdAsync(userId.Value.ToString());
        if (user == null) return NotFound();
        user.DisplayName = request.DisplayName.Trim();
        user.NicknameColor = ValidateNicknameColor(request.NicknameColor) ? request.NicknameColor : user.NicknameColor;
        user.About = string.IsNullOrWhiteSpace(request.About) ? null : request.About.Trim();
        var result = await _userManager.UpdateAsync(user);
        if (!result.Succeeded) return BadRequest(result.Errors);
        await _feedHub.Clients.Group("feed-global")
            .SendAsync("UserProfileChanged", user.Id, user.NicknameColor);
        return Ok(ToDto(user));
    }

    [HttpPut("password")]
    [Authorize]
    public async Task<ActionResult> ChangePassword(ChangePasswordRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var user = await _userManager.FindByIdAsync(userId.Value.ToString());
        if (user == null) return NotFound();

        var result = await _userManager.ChangePasswordAsync(
            user,
            request.CurrentPassword,
            request.NewPassword);

        if (!result.Succeeded)
            return BadRequest(new
            {
                message = "Не удалось изменить пароль",
                errors = result.Errors.Select(TranslateIdentityError)
            });

        return NoContent();
    }

    private string GetAttemptKey(string action) =>
        $"{action}:{HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown"}";

    private bool TryGetRateLimitResponse(string key, out ActionResult response)
    {
        if (!_attemptLimiter.IsBlocked(key, out var retryAfter))
        {
            response = null!;
            return false;
        }

        Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds)).ToString();
        response = StatusCode(StatusCodes.Status429TooManyRequests, new
        {
            message = "Слишком много неудачных попыток. Попробуй еще раз через минуту.",
            retryAfterSeconds = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds))
        });
        return true;
    }

    private static string TranslateIdentityError(IdentityError error)
    {
        return error.Code switch
        {
            "PasswordTooShort" => "Пароль немного короткий. Нужно хотя бы 8 символов, например: !дodАпица2012.",
            "PasswordRequiresNonAlphanumeric" => "Добавь в пароль специальный символ, например ! или _.",
            "PasswordRequiresDigit" => "Добавь хотя бы одну цифру, например 7.",
            "PasswordRequiresLower" => "Добавь строчную букву, например а или m.",
            "PasswordRequiresUpper" => "Добавь заглавную букву, например А или M.",
            "PasswordMismatch" => "Пароли не совпали. Проверь оба поля и попробуй еще раз.",
            "InvalidEmail" => "Похоже, email указан с ошибкой. Например: name@example.com.",
            "DuplicateEmail" => "Такой email уже зарегистрирован. Попробуй войти или укажи другой.",
            "DuplicateUserName" => "Такое имя уже занято. Выбери другое, пожалуйста.",
            _ => error.Description
        };
    }

    private Guid? GetCurrentUserId()
    {
        var rawId = User.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier")
            ?? User.FindFirstValue("nameid");

        return Guid.TryParse(rawId, out var id) ? id : null;
    }

    private static bool ValidateNicknameColor(string? color)
    {
        if (string.IsNullOrWhiteSpace(color)) return false;
        return System.Text.RegularExpressions.Regex.IsMatch(color, "^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$");
    }

    private static bool IsOnline(AppUser user) =>
        user.LastSeenAt.HasValue && DateTime.UtcNow - user.LastSeenAt.Value <= OnlineWindow;

    private static UserDto ToDto(AppUser user) => new()
    {
        Id = user.Id,
        Email = user.Email ?? string.Empty,
        DisplayName = user.DisplayName,
        WelcomeName = user.WelcomeName,
        NicknameColor = string.IsNullOrWhiteSpace(user.NicknameColor) ? "#4f46e5" : user.NicknameColor,
        AvatarUrl = user.AvatarUrl == null ? null : $"/api/files/avatar/{user.Id}?v={Uri.EscapeDataString(user.AvatarUrl)}",
        BannerUrl = user.BannerUrl == null ? null : $"/api/files/banner/{user.Id}",
        About = user.About,
        HasSeenWelcome = user.HasSeenWelcome,
        IsOnline = IsOnline(user),
        LastSeenAt = user.LastSeenAt
    };
}
