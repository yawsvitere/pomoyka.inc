using System.ComponentModel.DataAnnotations;

namespace Feed.Api.Models.Dto;

public class CreatePostRequest
{
    [MaxLength(4000)]
    public string? Text { get; set; } = string.Empty;
}

public class PostDto
{
    public Guid Id { get; set; }
    public string? Text { get; set; }
        public string? Title { get; set; }
        public string? Description { get; set; }
        public bool IsArticle { get; set; }
        public bool IsPostishka { get; set; }
        public PostAccessLevel AccessLevel { get; set; }
        public Guid? RelatedPostId { get; set; }
        public List<PostBlockDto> Blocks { get; set; } = new();
    public DateTime CreatedAt { get; set; }
    public UserDto Author { get; set; } = null!;
    public List<PostFileDto> Files { get; set; } = new();
    public List<CommentDto> Comments { get; set; } = new();
    public int LikeCount { get; set; }
    public bool IsLiked { get; set; }
    public Dictionary<string, int> ReactionCounts { get; set; } = new();
    public List<PostReactionDto> Reactions { get; set; } = new();
}

public class PostReactionDto
{
    public string Emoji { get; set; } = string.Empty;
    public UserDto User { get; set; } = null!;
}

public class CommentDto
{
    public Guid Id { get; set; }
    public string Text { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public UserDto Author { get; set; } = null!;
    public int LikeCount { get; set; }
    public bool IsLiked { get; set; }
}

public class PostFileDto
{
    public Guid Id { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public string DownloadUrl { get; set; } = string.Empty;
    public string PreviewUrl { get; set; } = string.Empty;
}

public class CreateCommentRequest
{
    [Required, MinLength(1), MaxLength(1000)]
    public string Text { get; set; } = string.Empty;
}

public class ArticleBlockRequest
{
    [Required, MaxLength(20)]
    public string Type { get; set; } = "text";
    [MaxLength(20000)]
    public string? Text { get; set; }
    public int? FileIndex { get; set; }
}

public class PostBlockDto
{
    public Guid Id { get; set; }
    public int SortOrder { get; set; }
    public string Type { get; set; } = string.Empty;
    public string? Text { get; set; }
    public PostFileDto? File { get; set; }
}