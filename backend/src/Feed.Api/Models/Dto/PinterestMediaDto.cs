namespace Feed.Api.Models.Dto;

public record PinterestMediaDto(
    string Id,
    string FileName,
    string ContentType,
    int? Width,
    int? Height,
    DateTime UploadedAt,
    string DownloadUrl,
    string? PreviewUrl);