namespace Feed.Api.Models;

/// <summary>
/// Represents an archived "Помойка" (dumpster) - a closed daily container.
/// Contains metadata about an archived day and references to archived posts.
/// </summary>
public class ArchiveDay
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>
    /// The calendar date (00:00:00 UTC) that this archive represents.
    /// </summary>
    public DateOnly Date { get; set; }

    /// <summary>
    /// Total number of posts in this archive (cached for performance).
    /// </summary>
    public int PostCount { get; set; }

    public int PostishkaCount { get; set; }

    /// <summary>
    /// Number of unique participants in this archive (cached for performance).
    /// </summary>
    public int ParticipantCount { get; set; }

    /// <summary>
    /// When this archive was created (when the Pomojka was closed).
    /// </summary>
    public DateTime ClosedAt { get; set; } = DateTime.UtcNow;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Navigation property to archived posts from this day.
    /// </summary>
    public List<ArchivedPost> Posts { get; set; } = new();
}

/// <summary>
/// An archived post - a snapshot of a post after the Pomojka was closed.
/// This is read-only and cannot be modified.
/// </summary>
public class ArchivedPost
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid ArchiveDayId { get; set; }
    public ArchiveDay? ArchiveDay { get; set; }

    public Guid AuthorId { get; set; }
    public AppUser? Author { get; set; }

    public string? Text { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<ArchivedPostFile> Files { get; set; } = new();
    public string? Title { get; set; }
    public List<ArchivedPostBlock> Blocks { get; set; } = new();
    public List<ArchivedPostComment> Comments { get; set; } = new();
    public List<ArchivedPostLike> Likes { get; set; } = new();
}

public class ArchivedPostBlock
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ArchivedPostId { get; set; }
    public ArchivedPost? ArchivedPost { get; set; }
    public int SortOrder { get; set; }
    public string Type { get; set; } = "text";
    public string? Text { get; set; }
    public Guid? FileId { get; set; }
    public ArchivedPostFile? File { get; set; }
}

public class ArchivedPostComment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ArchivedPostId { get; set; }
    public ArchivedPost? ArchivedPost { get; set; }
    public Guid AuthorId { get; set; }
    public AppUser? Author { get; set; }
    public string Text { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<ArchivedCommentLike> Likes { get; set; } = new();
}

public class ArchivedPostLike
{
    public Guid ArchivedPostId { get; set; }
    public ArchivedPost? ArchivedPost { get; set; }
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
}

public class ArchivedCommentLike
{
    public Guid ArchivedCommentId { get; set; }
    public ArchivedPostComment? Comment { get; set; }
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
}

public class ArchivedPostFile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ArchivedPostId { get; set; }
    public ArchivedPost? ArchivedPost { get; set; }

    public string FileName { get; set; } = string.Empty;
    public string StorageKey { get; set; } = string.Empty; 
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
}
