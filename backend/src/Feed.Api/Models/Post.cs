namespace Feed.Api.Models;

public class Post
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PomoykaId { get; set; }
    public Pomoyka? Pomoyka { get; set; }
    
    public Guid AuthorId { get; set; }
    public AppUser? Author { get; set; }

    public string? Text { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public bool IsPostishka { get; set; }
    public Guid? RelatedPostId { get; set; }

    public List<PostFile> Files { get; set; } = new();
    public string? Title { get; set; }
    public string? Description { get; set; }
    public PostAccessLevel AccessLevel { get; set; } = PostAccessLevel.Authenticated;
    public List<PostBlock> Blocks { get; set; } = new();
    public List<PostComment> Comments { get; set; } = new();
    public List<PostLike> Likes { get; set; } = new();
    public string ReactionData { get; set; } = "[]";
}

public class PostBlock
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PostId { get; set; }
    public Post? Post { get; set; }
    public int SortOrder { get; set; }
    public string Type { get; set; } = "text";
    public string? Text { get; set; }
    public Guid? FileId { get; set; }
    public PostFile? File { get; set; }
}

public class PostComment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PostId { get; set; }
    public Post? Post { get; set; }
    public Guid AuthorId { get; set; }
    public AppUser? Author { get; set; }
    public string Text { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<CommentLike> Likes { get; set; } = new();
}

public class PostLike
{
    public Guid PostId { get; set; }
    public Post? Post { get; set; }
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
}

public class CommentLike
{
    public Guid CommentId { get; set; }
    public PostComment? Comment { get; set; }
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
}

public class PostFile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PostId { get; set; }
    public Post? Post { get; set; }

    public string FileName { get; set; } = string.Empty;
    public string StorageKey { get; set; } = string.Empty; 
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
}
