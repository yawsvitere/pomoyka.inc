namespace Feed.Api.Models;

public class InviteCode
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string CodeHash { get; set; } = string.Empty;

    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public Guid CreatedById { get; set; }

    public AppUser CreatedBy { get; set; } = null!;

    public Guid? UsedById { get; set; }

    public AppUser? UsedBy { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? ExpiresAt { get; set; }

    public DateTime? UsedAt { get; set; }
}