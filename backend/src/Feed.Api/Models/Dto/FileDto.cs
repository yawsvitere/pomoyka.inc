using System.ComponentModel.DataAnnotations;

namespace Feed.Api.Models.Dto;

public class PresignUploadRequest
{
    [Required]
    public Guid PostId { get; set; }

    [Required, MaxLength(255)]
    public string FileName { get; set; } = string.Empty;

    [Required, MaxLength(255)]
    public string ContentType { get; set; } = string.Empty;

    [Required]
    public long SizeBytes { get; set; }
}

public class PresignUploadResponse
{
    public Guid FileId { get; set; }
    public string UploadUrl { get; set; } = string.Empty;
}

public class MoveFileRequest
{
    public Guid? FolderId { get; set; }
}