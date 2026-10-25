using Amazon.S3;
using Feed.Api.Data;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.PixelFormats;
using Microsoft.EntityFrameworkCore;
using System.Net;

namespace Feed.Api.Services;

public sealed class OgImageStorageCache(IStorageService storage)
{
    public static string PostKey(Guid postId) => $"og-cache/postishki/{postId}.png";

    public static string PostWebpKey(Guid postId) => $"og-cache/postishki/{postId}.q90.webp";

    public static string GalleryKey(Guid folderId) => $"og-cache/galleries/{folderId}.png";

    public static string GalleryWebpKey(Guid folderId) => $"og-cache/galleries/{folderId}.q90.webp";

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

        using var decodedImage = Image.Load<Rgba32>(image);
        await using var webpContent = new MemoryStream();
        await decodedImage.SaveAsWebpAsync(
            webpContent,
            new WebpEncoder { Quality = 90 },
            cancellationToken);
        webpContent.Position = 0;
        await storage.UploadObjectAsync(GetWebpKey(key), webpContent, "image/webp");
    }

    public async Task InvalidateAsync(string key)
    {
        var webpKey = GetWebpKey(key);
        var previousWebpKey = key.EndsWith(".png", StringComparison.OrdinalIgnoreCase)
            ? $"{key[..^4]}.webp"
            : throw new ArgumentException("OG cache keys must use the .png extension.", nameof(key));
        await storage.DeleteObjectsAsync(new[] { key, webpKey, previousWebpKey });
    }

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

    private static string GetWebpKey(string pngKey) =>
        pngKey.EndsWith(".png", StringComparison.OrdinalIgnoreCase)
            ? $"{pngKey[..^4]}.q90.webp"
            : throw new ArgumentException("OG cache keys must use the .png extension.", nameof(pngKey));
}
