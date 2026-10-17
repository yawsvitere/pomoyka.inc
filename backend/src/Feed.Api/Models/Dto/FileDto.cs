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

public class DownloadFilesArchiveRequest
{
    public List<Guid>? FileIds { get; set; }
    public Guid? FolderId { get; set; }
}

public class LibraryBatchPresignRequest
{
    public Guid? FolderId { get; set; }
    [Required, MinLength(1), MaxLength(300)]
    public List<LibraryUploadItemRequest> Files { get; set; } = [];
}

public class LibraryUploadItemRequest
{
    [Required, MaxLength(255)]
    public string FileName { get; set; } = string.Empty;
    [Required, MaxLength(255)]
    public string ContentType { get; set; } = string.Empty;
    [Range(1, 500L * 1024 * 1024)]
    public long SizeBytes { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
}

public record LibraryBatchPresignResponse(List<LibraryPresignedUpload> Files);

public record LibraryPresignedUpload(int Index, string StorageKey, string UploadUrl);

public class CompleteLibraryBatchUploadRequest
{
    public Guid? FolderId { get; set; }
    [Required, MinLength(1), MaxLength(300)]
    public List<CompleteLibraryUploadItem> Files { get; set; } = [];
}

public class CompleteLibraryUploadItem : LibraryUploadItemRequest
{
    [Required, MaxLength(500)]
    public string StorageKey { get; set; } = string.Empty;
}
