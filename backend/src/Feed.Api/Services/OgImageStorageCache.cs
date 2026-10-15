using Amazon.S3;
using Feed.Api.Data;
using Microsoft.EntityFrameworkCore;
using System.Net;

namespace Feed.Api.Services;

public sealed class OgImageStorageCache(IStorageService storage)
{
    public static string PostKey(Guid postId) => $"og-cache/postishki/{postId}.png";

    public static string GalleryKey(Guid folderId) => $"og-cache/galleries/{folderId}.png";

    public async Task<byte[]?> TryGetAsync(string key, CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await storage.GetObjectAsync(key, cancellationToken);
            await using var content = new MemoryStream();
            await response.ResponseStream.CopyToAsync(content, cancellationToken);
            return content.ToArray();
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task StoreAsync(
        string key,
        byte[] image,
        CancellationToken cancellationToken = default)
    {
        await using var content = new MemoryStream(image, writable: false);
        await storage.UploadObjectAsync(key, content, "image/png");
    }

    public Task InvalidateAsync(string key) => storage.DeleteObjectAsync(key);

    public async Task InvalidateUserAsync(AppDbContext db, Guid userId)
    {
        var postIds = await db.Posts.AsNoTracking()
            .Where(post => post.AuthorId == userId && post.IsPostishka)
            .Select(post => post.Id)
            .ToListAsync();
        foreach (var postId in postIds)
            await InvalidateAsync(PostKey(postId));

        var folderIds = await db.FileFolders.AsNoTracking()
            .Where(folder => folder.OwnerId == userId)
            .Select(folder => folder.Id)
            .ToListAsync();
        foreach (var folderId in folderIds)
            await InvalidateAsync(GalleryKey(folderId));
    }
}
