using System.ComponentModel.DataAnnotations;

namespace Feed.Api.Models.Dto;

public record AddFeedBannerRequest(Guid PostId);

public class AdminUserDto
{
    public Guid Id { get; set; }

    public string Email { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public string NicknameColor { get; set; } = "#4f46e5";

    public string? AvatarUrl { get; set; }

    public DateTime CreatedAt { get; set; }

    public List<string> Roles { get; set; } = [];

    public long StorageUsedBytes { get; set; }

    public long? StorageQuotaBytes { get; set; }

    public long EffectiveStorageQuotaBytes { get; set; }

    public bool IsOnline { get; set; }

    public DateTime? LastSeenAt { get; set; }
}

public class CreateInviteCodeRequest
{
    [Required, MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    [Range(0.1, 24 * 365)]
    public double? ExpiresInHours { get; set; }
}

public class ChangeRoleRequest
{
    [Required]
    public string Role { get; set; } = string.Empty;
}

public class UpdateStorageSettingsRequest
{
    [Range(1, long.MaxValue)]
    public long TotalQuotaBytes { get; set; }

    [Range(1, long.MaxValue)]
    public long? DefaultUserQuotaBytes { get; set; }
}

public class UpdateUserStorageQuotaRequest
{
    [Range(1, long.MaxValue)]
    public long? QuotaBytes { get; set; }
}

public class AdminStorageSummaryDto
{
    public long TotalQuotaBytes { get; set; }
    public long UsedBytes { get; set; }
    public long DefaultUserQuotaBytes { get; set; }
    public int UserCount { get; set; }
    public DateTime MeasuredAt { get; set; }
}

public class AdminInviteCodeDto
{
    public Guid Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }
    public Guid? UsedById { get; set; }
}
