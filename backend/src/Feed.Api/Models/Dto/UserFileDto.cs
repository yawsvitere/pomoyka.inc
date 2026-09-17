using Feed.Api.Models;

namespace Feed.Api.Models.Dto;

public record UserFileDto(Guid Id, string FileName, string ContentType, long SizeBytes, int? Width, int? Height, FileAccessLevel AccessLevel, Guid? FolderId, string? FolderName, DateTime UploadedAt, string DownloadUrl, string? PreviewUrl);
public record FileFolderDto(Guid Id, string Name, FileAccessLevel AccessLevel, int FileCount, DateTime CreatedAt, string GalleryUrl);

public class CreateFolderRequest
{
    public string Name { get; set; } = string.Empty;
    public FileAccessLevel AccessLevel { get; set; }
}

public class UpdateFileVisibilityRequest
{
    public FileAccessLevel AccessLevel { get; set; }
}

public class UpdateFolderVisibilityRequest
{
    public FileAccessLevel AccessLevel { get; set; }
}

public class RenameRequest
{
    public string Name { get; set; } = string.Empty;
}