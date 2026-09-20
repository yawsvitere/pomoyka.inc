using System.ComponentModel.DataAnnotations;

namespace Feed.Api.Models.Dto;

public class RegisterRequest
{
    [Required, EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required, MinLength(8)]
    public string Password { get; set; } = string.Empty;

    [Required, MinLength(2), MaxLength(50)]
    public string DisplayName { get; set; } = string.Empty;

    [RegularExpression("^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")]
    public string NicknameColor { get; set; } = "#4f46e5";

    public string? InviteCode { get; set; }
}

public class VerifyInviteCodeRequest
{
    [Required]
    public string Code { get; set; } = string.Empty;
}

public class LoginRequest
{
    [Required, EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    public string Password { get; set; } = string.Empty;
}

public class AuthResponse
{
    public string Token { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public UserDto User { get; set; } = null!;
}

public class UserDto
{
    public Guid Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? WelcomeName { get; set; }
    public string NicknameColor { get; set; } = "#4f46e5";
    public string? AvatarUrl { get; set; }
    public string? WelcomeImageUrl { get; set; }
    public string? BannerUrl { get; set; }
    public string? About { get; set; }
    public bool HasSeenWelcome { get; set; }
    public bool IsOnline { get; set; }
    public DateTime? LastSeenAt { get; set; }
}

public class UpdateProfileRequest
{
    [Required, MinLength(2), MaxLength(50)]
    public string DisplayName { get; set; } = string.Empty;

    [RegularExpression("^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")]
    public string NicknameColor { get; set; } = "#4f46e5";

    [MaxLength(500)]
    public string? About { get; set; }
}

public class ChangePasswordRequest
{
    [Required]
    public string CurrentPassword { get; set; } = string.Empty;

    [Required, MinLength(8)]
    public string NewPassword { get; set; } = string.Empty;
}
