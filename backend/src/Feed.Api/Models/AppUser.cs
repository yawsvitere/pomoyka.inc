using Microsoft.AspNetCore.Identity;

namespace Feed.Api.Models;

public class AppUser : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = string.Empty;
    public string? WelcomeName { get; set; }
    public string NicknameColor { get; set; } = "#4f46e5";
    public string? AvatarUrl { get; set; }
    public string? BannerUrl { get; set; }
    public string? About { get; set; }
    public bool HasSeenWelcome { get; set; }
    public long? StorageQuotaBytes { get; set; }
    public DateTime? LastSeenAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
