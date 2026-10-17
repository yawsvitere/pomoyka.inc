using Feed.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Feed.Api.Services;

public sealed class ContentAddressedPreviewCleanupService(
    AppDbContext db,
    IStorageService storage,
    ImagePreviewBackgroundService imagePreviewBackgroundService)
{
    public async Task DeleteUnusedPreviewsAsync(
        IEnumerable<(string StorageKey, string ContentType)> files)
    {
        var candidates = files
            .Where(file => file.StorageKey.StartsWith("sha256/", StringComparison.Ordinal))
            .GroupBy(file => file.StorageKey, StringComparer.Ordinal)
            .Select(group => new
            {
                StorageKey = group.Key,
                ContentTypes = group.Select(file => file.ContentType)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray()
            })
            .ToArray();
        if (candidates.Length == 0)
            return;

        var keys = candidates.Select(file => file.StorageKey).ToArray();
        var referencedKeys = new HashSet<string>(StringComparer.Ordinal);

        await AddReferencedKeysAsync(
            db.UserFiles.AsNoTracking().Where(file => keys.Contains(file.StorageKey))
                .Select(file => file.StorageKey),
            referencedKeys);
        await AddReferencedKeysAsync(
            db.PostFiles.AsNoTracking().Where(file => keys.Contains(file.StorageKey))
                .Select(file => file.StorageKey),
            referencedKeys);
        await AddReferencedKeysAsync(
            db.CommentFiles.AsNoTracking().Where(file => keys.Contains(file.StorageKey))
                .Select(file => file.StorageKey),
            referencedKeys);
        await AddReferencedKeysAsync(
            db.ArchivedPostFiles.AsNoTracking().Where(file => keys.Contains(file.StorageKey))
                .Select(file => file.StorageKey),
            referencedKeys);
        await AddReferencedKeysAsync(
            db.Posts.AsNoTracking()
                .Where(post => post.OgCoverStorageKey != null && keys.Contains(post.OgCoverStorageKey))
                .Select(post => post.OgCoverStorageKey!),
            referencedKeys);
        await AddReferencedKeysAsync(
            db.Users.AsNoTracking()
                .Where(user => user.BannerUrl != null && keys.Contains(user.BannerUrl))
                .Select(user => user.BannerUrl!),
            referencedKeys);
        await AddReferencedKeysAsync(
            db.InviteCodes.AsNoTracking()
                .Where(invite => invite.ImageUrl != null && keys.Contains(invite.ImageUrl))
                .Select(invite => invite.ImageUrl!),
            referencedKeys);

        var avatarKeys = keys.Concat(keys.Select(key => $"avatar-video/{key}")).ToArray();
        var avatarReferences = await db.Users.AsNoTracking()
            .Where(user => user.AvatarUrl != null && avatarKeys.Contains(user.AvatarUrl))
            .Select(user => user.AvatarUrl!)
            .ToListAsync();
        foreach (var avatarKey in avatarReferences)
            referencedKeys.Add(avatarKey.StartsWith("avatar-video/", StringComparison.Ordinal)
                ? avatarKey["avatar-video/".Length..]
                : avatarKey);

        var unusedFiles = candidates
            .Where(file => !referencedKeys.Contains(file.StorageKey))
            .ToArray();
        var objectsToDelete = unusedFiles
            .SelectMany(file => file.ContentTypes
                .Where(contentType =>
                    contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ||
                    contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                .SelectMany(contentType => contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                    ? storage.GetImagePreviewObjectKeys(file.StorageKey)
                    : new[] { storage.GetVideoPreviewObjectKey(file.StorageKey) })
                .Prepend(file.StorageKey))
            .ToArray();

        await storage.DeleteObjectsAsync(objectsToDelete);
        foreach (var file in unusedFiles)
            imagePreviewBackgroundService.Forget(file.StorageKey);
    }

    private static async Task AddReferencedKeysAsync(
        IQueryable<string> query,
        HashSet<string> referencedKeys)
    {
        foreach (var key in await query.ToListAsync())
            referencedKeys.Add(key);
    }
}
