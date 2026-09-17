namespace Feed.Api.Models;

/// <summary>
/// Represents a daily "Помойка" (dumpster) - a container for posts created within a single calendar day.
/// </summary>
public class Pomojka
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>
    /// The calendar date (00:00:00 UTC) that this Pomojka represents.
    /// </summary>
    public DateOnly Date { get; set; }

    /// <summary>
    /// True if this Pomojka is currently active and accepting new posts.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// When this Pomojka was closed (archived). Null if still active.
    /// </summary>
    public DateTime? ClosedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Posts in the current (active) Pomojka.
    /// </summary>
    public List<Post> Posts { get; set; } = new();
}
