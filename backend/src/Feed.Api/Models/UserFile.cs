namespace Feed.Api.Models;

public class FileFolder
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OwnerId { get; set; }
    public AppUser? Owner { get; set; }
    public string Name { get; set; } = string.Empty;
    public FileAccessLevel AccessLevel { get; set; } = FileAccessLevel.Authenticated;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<UserFile> Files { get; set; } = new();
}

public class UserFile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OwnerId { get; set; }
    public AppUser? Owner { get; set; }
    public Guid? FolderId { get; set; }
    public FileFolder? Folder { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string StorageKey { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public FileAccessLevel AccessLevel { get; set; } = FileAccessLevel.Authenticated;
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
}