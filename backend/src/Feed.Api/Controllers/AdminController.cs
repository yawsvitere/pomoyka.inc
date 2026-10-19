using System.Security.Claims;
using System.Security.Cryptography;
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
[Route("api/admin")]
[Authorize(Roles = "Admin")]
public class AdminController : ControllerBase
{
    private readonly UserManager<AppUser> _userManager;
    private readonly InviteCodeService _inviteCodeService;
    private readonly PomoykaService _pomoykaService;
    private readonly IHubContext<FeedHub> _feedHub;
    private readonly AppDbContext _db;

    public AdminController(
        UserManager<AppUser> userManager,
        InviteCodeService inviteCodeService,
        PomoykaService pomoykaService,
        IHubContext<FeedHub> feedHub,
        AppDbContext db)
    {
        _userManager = userManager;
        _inviteCodeService = inviteCodeService;
        _pomoykaService = pomoykaService;
        _feedHub = feedHub;
        _db = db;
    }

    [HttpPost("archive/today")]
    public async Task<ActionResult> ArchiveToday()
    {
        var moscowTime = TimeZoneInfo.ConvertTimeFromUtc(
            DateTime.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Europe/Moscow"));
        var today = DateOnly.FromDateTime(moscowTime);

        await _pomoykaService.ArchivePomoykaAsync(today);

        return Ok(new
        {
            message = "Текущая лента отправлена в архив",
            date = today
        });
    }

    [HttpGet("users")]
    public async Task<ActionResult> GetUsers()
    {
        var users = await _userManager.Users
            .OrderByDescending(x => x.CreatedAt)
            .ToListAsync();

        var storageSummary = await GetStorageSummaryAsync();
        var result = new List<AdminUserDto>();

        foreach (var user in users)
        {
            var roles = await _userManager.GetRolesAsync(user);
            var storageUsedBytes = await _db.UserFiles
                .Where(x => x.OwnerId == user.Id)
                .SumAsync(x => (long?)x.SizeBytes) ?? 0;

            result.Add(new AdminUserDto
            {
                Id = user.Id,
                Email = user.Email ?? "",
                DisplayName = user.DisplayName,
                NicknameColor = string.IsNullOrWhiteSpace(user.NicknameColor) ? "#4f46e5" : user.NicknameColor,
                AvatarUrl = user.AvatarUrl == null
                    ? null
                    : $"/api/files/avatar/{user.Id}?v={Uri.EscapeDataString(user.AvatarUrl)}",
                CreatedAt = user.CreatedAt,
                Roles = roles.ToList(),
                StorageUsedBytes = storageUsedBytes,
                StorageQuotaBytes = user.StorageQuotaBytes,
                EffectiveStorageQuotaBytes = GetEffectiveQuotaBytes(user, storageSummary.DefaultUserQuotaBytes),
                IsOnline = IsOnline(user),
                LastSeenAt = user.LastSeenAt,
                IsBanned = IsActivelyBanned(user),
                BanUntil = IsActivelyBanned(user) ? user.BanUntil : null,
                BanReason = IsActivelyBanned(user) ? user.BanReason : null
            });
        }

        return Ok(result);
    }

    [HttpGet("storage-summary")]
    public async Task<ActionResult<AdminStorageSummaryDto>> GetStorageSummary()
    {
        var summary = await GetStorageSummaryAsync();
        return Ok(summary);
    }

    [HttpPut("storage-settings")]
    public async Task<ActionResult<AdminStorageSummaryDto>> UpdateStorageSettings([FromBody] UpdateStorageSettingsRequest request)
    {
        var settings = await _db.StorageSettings.FindAsync(StorageSettings.SingletonId)
            ?? new StorageSettings { Id = StorageSettings.SingletonId };

        settings.TotalQuotaBytes = request.TotalQuotaBytes;
        if (request.DefaultUserQuotaBytes.HasValue)
            settings.DefaultUserQuotaBytes = request.DefaultUserQuotaBytes.Value;

        if (settings.Id == 0)
            _db.StorageSettings.Add(settings);

        await _db.SaveChangesAsync();
        return Ok(await GetStorageSummaryAsync());
    }

    [HttpPut("users/{id:guid}/storage-quota")]
    public async Task<ActionResult> UpdateUserStorageQuota(Guid id, [FromBody] UpdateUserStorageQuotaRequest request)
    {
        var user = await _userManager.FindByIdAsync(id.ToString());
        if (user == null)
            return NotFound(new { message = "Пользователь не найден" });

        user.StorageQuotaBytes = request.QuotaBytes;
        var result = await _userManager.UpdateAsync(user);
        if (!result.Succeeded)
            return BadRequest(result.Errors);

        return Ok(new { quotaBytes = user.StorageQuotaBytes });
    }

    [HttpPost("users/{id:guid}/ban")]
    public async Task<ActionResult<BanStatusDto>> BanUser(
        Guid id,
        [FromBody] BanUserRequest request)
    {
        if (!Guid.TryParse(User.FindFirstValue("sub"), out var adminId) || adminId == id)
            return BadRequest(new { message = "Нельзя заблокировать собственный аккаунт" });

        var user = await _userManager.FindByIdAsync(id.ToString());
        if (user == null)
            return NotFound(new { message = "Пользователь не найден" });

        var reason = request.Reason.Trim();
        if (string.IsNullOrWhiteSpace(reason))
            return BadRequest(new { message = "Укажи причину блокировки" });

        user.IsBanned = true;
        user.BanUntil = request.DurationHours.HasValue
            ? DateTime.UtcNow.AddHours(request.DurationHours.Value)
            : null;
        user.BanReason = reason;

        var result = await _userManager.UpdateAsync(user);
        if (!result.Succeeded)
            return BadRequest(result.Errors);

        var status = new BanStatusDto
        {
            IsBanned = true,
            BanUntil = user.BanUntil,
            BanReason = user.BanReason
        };
        await _feedHub.Clients
            .Group($"user-{user.Id}")
            .SendAsync("UserBanned", status);

        return Ok(status);
    }

    [HttpDelete("users/{id:guid}/ban")]
    public async Task<ActionResult<BanStatusDto>> UnbanUser(Guid id)
    {
        var user = await _userManager.FindByIdAsync(id.ToString());
        if (user == null)
            return NotFound(new { message = "Пользователь не найден" });

        user.IsBanned = false;
        user.BanUntil = null;
        user.BanReason = null;

        var result = await _userManager.UpdateAsync(user);
        if (!result.Succeeded)
            return BadRequest(result.Errors);

        await _feedHub.Clients
            .Group($"user-{user.Id}")
            .SendAsync("UserUnbanned");

        return Ok(new BanStatusDto { IsBanned = false });
    }

    [HttpPut("users/{id:guid}/profile")]
    public async Task<ActionResult> UpdateUserProfile(
        Guid id,
        [FromBody] UpdateAdminUserProfileRequest request)
    {
        var user = await _userManager.FindByIdAsync(id.ToString());
        if (user == null)
            return NotFound(new { message = "Пользователь не найден" });

        var displayName = request.DisplayName.Trim();
        if (displayName.Length is < 2 or > 50)
            return BadRequest(new { message = "Ник должен содержать от 2 до 50 символов" });

        var email = request.Email.Trim();
        user.Email = email;
        user.UserName = email;
        user.DisplayName = displayName;

        var result = await _userManager.UpdateAsync(user);
        if (!result.Succeeded)
            return BadRequest(result.Errors);

        await _feedHub.Clients
            .Group("feed-global")
            .SendAsync("UserProfileChanged", user.Id, user.NicknameColor);

        return Ok(new { email = user.Email, displayName = user.DisplayName });
    }

    [HttpPost("users/{id:guid}/generate-password")]
    public async Task<ActionResult> GenerateUserPassword(Guid id)
    {
        var user = await _userManager.FindByIdAsync(id.ToString());
        if (user == null)
            return NotFound(new { message = "Пользователь не найден" });

        var password = GeneratePassword();
        var resetToken = await _userManager.GeneratePasswordResetTokenAsync(user);
        var result = await _userManager.ResetPasswordAsync(user, resetToken, password);
        if (!result.Succeeded)
        {
            return BadRequest(new
            {
                message = "Не удалось установить новый пароль",
                errors = result.Errors
            });
        }

        return Ok(new { password });
    }

    [HttpPost("invite-codes")]
    public async Task<ActionResult> CreateInviteCode(
        CreateInviteCodeRequest request)
    {
        var adminId = User.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (!Guid.TryParse(adminId, out var createdById))
            return Unauthorized();

        var code = await _inviteCodeService.CreateAsync(
            createdById,
            request.Name,
            request.ExpiresInHours.HasValue
                ? TimeSpan.FromHours(request.ExpiresInHours.Value)
                : null
        );

        return Ok(new AdminInviteCodeDto
        {
            Id = code.Id,
            Code = code.Code,
            Name = code.Name,
            ImageUrl = code.ImageUrl == null ? null : $"/api/files/invite/{code.Id}/image",
            CreatedAt = code.CreatedAt,
            ExpiresAt = code.ExpiresAt
        });
    }

    [HttpGet("invite-codes")]
    public async Task<ActionResult<List<AdminInviteCodeDto>>> GetInviteCodes()
    {
        var codes = await _inviteCodeService.GetAllAsync();
        return Ok(codes.Select(code => new AdminInviteCodeDto
        {
            Id = code.Id,
            Code = code.Code,
            Name = code.Name,
            ImageUrl = code.ImageUrl == null ? null : $"/api/files/invite/{code.Id}/image",
            CreatedAt = code.CreatedAt,
            ExpiresAt = code.ExpiresAt,
            UsedAt = code.UsedAt,
            UsedById = code.UsedById
        }));
    }

    [HttpDelete("invite-codes/{id:guid}")]
    public async Task<IActionResult> DeleteInviteCode(Guid id)
    {
        if (!await _inviteCodeService.DeleteAsync(id))
            return NotFound();

        return NoContent();
    }

    [HttpGet("banners")]
    public async Task<ActionResult<List<FeedBannerDto>>> GetBanners()
    {
        var banners = await _db.FeedBanners
            .AsNoTracking()
            .Include(x => x.Post)
                .ThenInclude(x => x!.Files)
            .OrderBy(x => x.SortOrder)
            .ToListAsync();

        return Ok(banners.Select(ToBannerDto).ToList());
    }

    [HttpPost("banners")]
    public async Task<ActionResult<FeedBannerDto>> AddBanner([FromBody] AddFeedBannerRequest request)
    {
        var post = await _db.Posts
            .Include(x => x.Files)
            .FirstOrDefaultAsync(x => x.Id == request.PostId && x.IsPostishka);

        if (post == null)
            return BadRequest(new { message = "Можно выбрать только постишку" });

        if (await _db.FeedBanners.AnyAsync(x => x.PostId == post.Id))
            return Conflict(new { message = "Эта постишка уже добавлена в баннеры" });

        var banner = new FeedBanner
        {
            PostId = post.Id,
            SortOrder = await _db.FeedBanners.CountAsync()
        };
        _db.FeedBanners.Add(banner);
        await _db.SaveChangesAsync();
        await NotifySidebarChangedAsync();

        banner.Post = post;
        return Ok(ToBannerDto(banner));
    }

    [HttpDelete("banners/{id:guid}")]
    public async Task<IActionResult> DeleteBanner(Guid id)
    {
        var banner = await _db.FeedBanners.FindAsync(id);
        if (banner == null)
            return NotFound();

        _db.FeedBanners.Remove(banner);
        await _db.SaveChangesAsync();
        await NotifySidebarChangedAsync();
        return NoContent();
    }

    [HttpGet("polls")]
    public async Task<ActionResult<List<FeedPollDto>>> GetPolls()
    {
        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();

        var polls = await GetPollQuery()
            .OrderByDescending(poll => poll.CreatedAt)
            .ToListAsync();

        return Ok(polls.Select(poll => FeedPollDtoMapper.ToDto(poll, userId.Value)).ToList());
    }

    [HttpPost("polls")]
    public async Task<ActionResult<FeedPollDto>> CreatePoll(
        [FromBody] CreateFeedPollRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Question))
            return BadRequest(new { message = "Укажи вопрос голосования" });
        if (request.Question.Trim().Length > 200)
            return BadRequest(new { message = "Вопрос не должен превышать 200 символов" });
        if (request.EndsAt.UtcDateTime <= DateTime.UtcNow)
            return BadRequest(new { message = "Дата завершения должна быть в будущем" });
        if (request.Options == null || request.Options.Count is < 2 or > 30)
            return BadRequest(new { message = "Добавь от 2 до 30 вариантов" });

        var options = request.Options.Select(option => option.Trim()).ToList();
        if (options.Any(option => option.Length is 0 or > 120))
            return BadRequest(new { message = "Варианты должны содержать от 1 до 120 символов" });
        if (options.Distinct(StringComparer.OrdinalIgnoreCase).Count() != options.Count)
            return BadRequest(new { message = "Варианты не должны повторяться" });

        var poll = new FeedPoll
        {
            Question = request.Question.Trim(),
            EndsAt = request.EndsAt.UtcDateTime,
            IsAnonymous = request.IsAnonymous,
            AllowUserOptions = request.AllowUserOptions,
            AllowMultipleChoices = request.AllowMultipleChoices,
            Options = options.Select((option, index) => new FeedPollOption
            {
                Text = option,
                SortOrder = index
            }).ToList()
        };

        _db.FeedPolls.Add(poll);
        await _db.SaveChangesAsync();
        await NotifySidebarChangedAsync();

        var createdPoll = await GetPollQuery().FirstAsync(item => item.Id == poll.Id);
        var adminId = GetCurrentUserId();
        return Ok(FeedPollDtoMapper.ToDto(createdPoll, adminId!.Value));
    }

    [HttpDelete("polls/{id:guid}")]
    public async Task<IActionResult> DeletePoll(Guid id)
    {
        var poll = await _db.FeedPolls.FindAsync(id);
        if (poll == null)
            return NotFound();

        _db.FeedPolls.Remove(poll);
        await _db.SaveChangesAsync();
        await NotifySidebarChangedAsync();
        return NoContent();
    }

    private FeedBannerDto ToBannerDto(FeedBanner banner) => new()
    {
        Id = banner.Id,
        PostId = banner.PostId,
        Title = banner.Post?.Title?.Trim() ?? "Без названия",
        CreatedAt = banner.Post?.CreatedAt ?? DateTime.UtcNow,
        ImageUrl = banner.Post?.Files
            .FirstOrDefault(file => file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)) is { } image
            ? $"/api/files/post/{image.Id}/download"
            : null
    };

    private IQueryable<FeedPoll> GetPollQuery() =>
        _db.FeedPolls
            .AsNoTracking()
            .AsSplitQuery()
            .Include(poll => poll.Options)
                .ThenInclude(option => option.Votes)
                    .ThenInclude(optionVote => optionVote.Vote)
                        .ThenInclude(vote => vote!.User)
            .Include(poll => poll.Votes)
                .ThenInclude(vote => vote.Options);

    private Task NotifySidebarChangedAsync() =>
        _feedHub.Clients.Group("feed-global").SendAsync("FeedSidebarChanged");

    [HttpPut("users/{id:guid}/role")]
    public async Task<ActionResult> ChangeRole(
        Guid id,
        ChangeRoleRequest request)
    {
        var currentAdminId = GetCurrentUserId();
        if (currentAdminId == null)
            return Unauthorized();

        if (currentAdminId == id && request.Role != "Admin")
        {
            return BadRequest(new
            {
                message = "Нельзя снять роль Admin с самого себя"
            });
        }

        var user = await _userManager.FindByIdAsync(
            id.ToString()
        );

        if (user == null)
            return NotFound(new
            {
                message = "Пользователь не найден"
            });

        if (request.Role != "Admin" &&
            request.Role != "User")
        {
            return BadRequest(new
            {
                message = "Недопустимая роль"
            });
        }

        var currentRoles = await _userManager.GetRolesAsync(user);
        var isRemovingAdmin = currentRoles.Contains("Admin") && request.Role != "Admin";
        if (isRemovingAdmin && !await HasAnotherAdminAsync(user.Id))
        {
            return BadRequest(new
            {
                message = "Нельзя снять роль Admin с последнего администратора"
            });
        }

        if (currentRoles.Count > 0)
        {
            var removeResult =
                await _userManager.RemoveFromRolesAsync(
                    user,
                    currentRoles
                );

            if (!removeResult.Succeeded)
                return BadRequest(removeResult.Errors);
        }

        if (request.Role != "User")
        {
            var addResult =
                await _userManager.AddToRoleAsync(
                    user,
                    request.Role
                );

            if (!addResult.Succeeded)
                return BadRequest(addResult.Errors);
        }

        await _feedHub.Clients
            .Group($"user-{user.Id}")
            .SendAsync("UserRoleChanged");

        return Ok(new
        {
            message = "Роль изменена",
            role = request.Role
        });
    }

    private Guid? GetCurrentUserId()
    {
        var rawId = User.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier);

        return Guid.TryParse(rawId, out var id) ? id : null;
    }

    private async Task<AdminStorageSummaryDto> GetStorageSummaryAsync()
    {
        var settings = await _db.StorageSettings.AsNoTracking().FirstOrDefaultAsync(x => x.Id == StorageSettings.SingletonId)
            ?? new StorageSettings { Id = StorageSettings.SingletonId };

        var userCount = await _userManager.Users.CountAsync();
        var totalUsedBytes = await _db.UserFiles.AsNoTracking().SumAsync(x => (long?)x.SizeBytes) ?? 0;

        return new AdminStorageSummaryDto
        {
            TotalQuotaBytes = settings.TotalQuotaBytes,
            UsedBytes = totalUsedBytes,
            DefaultUserQuotaBytes = settings.DefaultUserQuotaBytes,
            UserCount = userCount,
            MeasuredAt = DateTime.UtcNow
        };
    }

    private static long GetEffectiveQuotaBytes(AppUser user, long defaultUserQuotaBytes)
    {
        if (user.StorageQuotaBytes.HasValue)
            return user.StorageQuotaBytes.Value;

        return defaultUserQuotaBytes;
    }

    private static bool IsOnline(AppUser user)
    {
        if (!user.LastSeenAt.HasValue)
            return false;

        return DateTime.UtcNow - user.LastSeenAt.Value <= TimeSpan.FromMinutes(2);
    }

    private static bool IsActivelyBanned(AppUser user) =>
        user.IsBanned && (!user.BanUntil.HasValue || user.BanUntil.Value > DateTime.UtcNow);

    private async Task<bool> HasAnotherAdminAsync(Guid userId)
    {
        var adminUsers = await _userManager.GetUsersInRoleAsync("Admin");
        return adminUsers.Any(user => user.Id != userId);
    }

    private static string GeneratePassword()
    {
        const string uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
        const string lowercase = "abcdefghijkmnopqrstuvwxyz";
        const string digits = "23456789";
        const string allCharacters = uppercase + lowercase + digits;
        var characters = new char[16];

        characters[0] = uppercase[RandomNumberGenerator.GetInt32(uppercase.Length)];
        characters[1] = lowercase[RandomNumberGenerator.GetInt32(lowercase.Length)];
        characters[2] = digits[RandomNumberGenerator.GetInt32(digits.Length)];
        for (var i = 3; i < characters.Length; i++)
            characters[i] = allCharacters[RandomNumberGenerator.GetInt32(allCharacters.Length)];

        for (var i = characters.Length - 1; i > 0; i--)
        {
            var swapIndex = RandomNumberGenerator.GetInt32(i + 1);
            (characters[i], characters[swapIndex]) = (characters[swapIndex], characters[i]);
        }

        return new string(characters);
    }
}
