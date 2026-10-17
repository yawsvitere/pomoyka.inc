using System.Security.Claims;
using Feed.Api.Data;
using Feed.Api.Hubs;
using Feed.Api.Models;
using Feed.Api.Models.Dto;
using Feed.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;
using Amazon.S3;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using System.Text;
using System.Text.Encodings.Web;
using SixLabors.Fonts;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;
using SixLabors.ImageSharp.Drawing.Processing;

namespace Feed.Api.Controllers;

[ApiController]
[Route("api/files")]
[Authorize]
public class FilesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IStorageService _storage;
    private readonly ContentAddressedPreviewCleanupService _contentAddressedPreviewCleanup;
    private readonly ImagePreviewBackgroundService _imagePreviewBackgroundService;
    private readonly IHubContext<FeedHub> _feedHub;
    private readonly ILogger<FilesController> _logger;
    private readonly OgImageStorageCache _ogImageCache;
    private readonly string _sevenZipExecutable;

    private const long MaxFileSizeBytes = 500L * 1024 * 1024;
    private const long MaxAvatarSizeBytes = 5L * 1024 * 1024;
    private const long MaxBannerSizeBytes = 10L * 1024 * 1024;
    private const long MaxPostFileSizeBytes = 500L * 1024 * 1024;
    private const string AvatarVideoPrefix = "avatar-video/";

    [ActivatorUtilitiesConstructor]
    public FilesController(
        AppDbContext db,
        IStorageService storage,
        ContentAddressedPreviewCleanupService contentAddressedPreviewCleanup,
        ImagePreviewBackgroundService imagePreviewBackgroundService,
        IHubContext<FeedHub> feedHub,
        ILogger<FilesController> logger,
        IConfiguration configuration,
        OgImageStorageCache ogImageCache)
    {
        _db = db;
        _storage = storage;
        _contentAddressedPreviewCleanup = contentAddressedPreviewCleanup;
        _imagePreviewBackgroundService = imagePreviewBackgroundService;
        _feedHub = feedHub;
        _logger = logger;
        _ogImageCache = ogImageCache;
        _sevenZipExecutable = configuration["SevenZip:ExecutablePath"] ?? "7z";
    }

    [HttpPost("presign-upload")]
    public async Task<ActionResult<PresignUploadResponse>> PresignUpload(PresignUploadRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        if (request.SizeBytes > MaxFileSizeBytes)
            return BadRequest(new { message = $"Файл слишком большой. Максимум {MaxFileSizeBytes / 1024 / 1024} МБ" });

        var post = await _db.Posts.FirstOrDefaultAsync(p => p.Id == request.PostId);
        if (post == null) return NotFound(new { message = "Пост не найден" });
        if (post.AuthorId != userId) return Forbid();

        var storageKey = $"{post.Id}/{Guid.NewGuid()}_{request.FileName}";

        var file = new PostFile
        {
            PostId = post.Id,
            FileName = request.FileName,
            StorageKey = storageKey,
            ContentType = request.ContentType,
            SizeBytes = request.SizeBytes
        };

        _db.PostFiles.Add(file);
        await _db.SaveChangesAsync();
        if (post.IsPostishka)
            await _ogImageCache.InvalidateAsync(OgImageStorageCache.PostKey(post.Id));

        var uploadUrl = _storage.GetPresignedUploadUrl(storageKey, request.ContentType);

        return Ok(new PresignUploadResponse
        {
            FileId = file.Id,
            UploadUrl = uploadUrl
        });
    }

    [HttpGet("library")]
    public async Task<ActionResult<object>> GetLibrary()
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();
        var folders = await _db.FileFolders.AsNoTracking().Where(x => x.OwnerId == userId).OrderBy(x => x.Name)
            .Select(x => new FileFolderDto(x.Id, x.Name, x.AccessLevel, x.Files.Count, x.CreatedAt, $"/files/gallery/{x.Id}")).ToListAsync();
        var libraryFiles = await _db.UserFiles.AsNoTracking().Include(x => x.Folder).Where(x => x.OwnerId == userId)
            .OrderByDescending(x => x.UploadedAt).ToListAsync();
        var files = libraryFiles.Select(x => ToUserFileDto(x)).ToList();
        return Ok(new { folders, files });
    }

    [HttpGet("common")]
    public async Task<ActionResult<object>> GetCommonLibrary()
    {
        var visibleAccessLevels = new[] { FileAccessLevel.Public, FileAccessLevel.Authenticated };
        var folders = await _db.FileFolders.AsNoTracking()
            .Where(x => visibleAccessLevels.Contains(x.AccessLevel))
            .OrderBy(x => x.Name)
            .Select(x => new FileFolderDto(
                x.Id,
                x.Name,
                x.AccessLevel,
                x.Files.Count(file => visibleAccessLevels.Contains(file.AccessLevel)),
                x.CreatedAt,
                $"/files/gallery/{x.Id}"))
            .ToListAsync();

        var userFiles = await _db.UserFiles.AsNoTracking()
            .Include(x => x.Folder)
            .Where(x => visibleAccessLevels.Contains(x.AccessLevel))
            .OrderByDescending(x => x.UploadedAt)
            .ToListAsync();
        var postFiles = await _db.PostFiles.AsNoTracking()
            .Include(x => x.Post)
            .Where(x => x.Post != null)
            .OrderByDescending(x => x.UploadedAt)
            .ToListAsync();
        var shitpostFolderId = Guid.Empty;
        folders.Insert(0, new FileFolderDto(
            shitpostFolderId,
            "shitpost",
            FileAccessLevel.Authenticated,
            postFiles.Count,
            postFiles.Count > 0 ? postFiles.Min(x => x.UploadedAt) : DateTime.UtcNow,
            string.Empty));

        var files = userFiles.Select(x => ToUserFileDto(x)).ToList();
        files.AddRange(postFiles.Select(x => new UserFileDto(
            x.Id,
            x.FileName,
            x.ContentType,
            x.SizeBytes,
            null,
            null,
            x.Post?.AccessLevel == PostAccessLevel.Public
                ? FileAccessLevel.Public
                : FileAccessLevel.Authenticated,
            shitpostFolderId,
            "shitpost",
            x.UploadedAt,
            $"{Request.Scheme}://{Request.Host}/api/files/post/{x.Id}/download",
            (x.ContentType ?? string.Empty).StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                ? GetPreviewUrl(x.StorageKey, isVideo: false)
                : (x.ContentType ?? string.Empty).StartsWith("video/", StringComparison.OrdinalIgnoreCase)
                    ? GetPreviewUrl(x.StorageKey, isVideo: true)
                    : null,
            (x.ContentType ?? string.Empty).StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                ? _storage.GetPublicObjectUrl(_storage.GetIconPreviewObjectKey(x.StorageKey))
                : null)));

        return Ok(new { folders, files });
    }

    [HttpGet("quota")]
    public async Task<ActionResult<object>> GetQuota()
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId.Value);
        if (user == null) return NotFound();

        var settings = await _db.StorageSettings.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == StorageSettings.SingletonId);
        var quotaBytes = user.StorageQuotaBytes ?? (settings?.DefaultUserQuotaBytes ?? new StorageSettings().DefaultUserQuotaBytes);
        var usedBytes = await _db.UserFiles.AsNoTracking()
            .Where(x => x.OwnerId == userId.Value)
            .SumAsync(x => (long?)x.SizeBytes) ?? 0;

        return Ok(new { usedBytes, quotaBytes });
    }

    [HttpGet("profile/{displayName}/library")]
    public async Task<ActionResult<object>> GetProfileLibrary(string displayName)
    {
        var visibleAccessLevels = new[] { FileAccessLevel.Public, FileAccessLevel.Authenticated };
        var folders = await _db.FileFolders.AsNoTracking()
            .Where(x => x.Owner != null && x.Owner.DisplayName == displayName && visibleAccessLevels.Contains(x.AccessLevel))
            .OrderBy(x => x.Name)
            .Select(x => new FileFolderDto(
                x.Id,
                x.Name,
                x.AccessLevel,
                x.Files.Count(file => visibleAccessLevels.Contains(file.AccessLevel)),
                x.CreatedAt,
                $"/files/gallery/{x.Id}"))
            .ToListAsync();
        var files = await _db.UserFiles.AsNoTracking()
            .Include(x => x.Folder)
            .Where(x => x.Owner != null && x.Owner.DisplayName == displayName &&
                visibleAccessLevels.Contains(x.AccessLevel))
            .OrderByDescending(x => x.UploadedAt)
            .ToListAsync();
        return Ok(new { folders, files = files.Select(x => ToUserFileDto(x)).ToList() });
    }

    [HttpGet("pinterest")]
    public async Task<ActionResult<PinterestMediaPageDto>> GetPinterestMedia(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] int seed = 0)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 50);
        var visibleAccessLevels = new[] { FileAccessLevel.Public, FileAccessLevel.Authenticated };
        var userFiles = await _db.UserFiles.AsNoTracking()
            .Where(x => visibleAccessLevels.Contains(x.AccessLevel) &&
                (x.ContentType.StartsWith("image/") || x.ContentType.StartsWith("video/")))
            .OrderByDescending(x => x.UploadedAt)
            .ToListAsync();
        var media = userFiles.Select(x => new PinterestMediaDto(
            x.Id.ToString(),
            x.FileName,
            x.ContentType,
            x.Width,
            x.Height,
            x.UploadedAt,
            _storage.GetPublicObjectUrl(x.StorageKey),
            x.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                ? _storage.GetPublicObjectUrl(_storage.GetPreviewObjectKey(x.StorageKey))
                : x.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)
                    ? _storage.GetPublicObjectUrl(_storage.GetVideoPreviewObjectKey(x.StorageKey))
                    : null)).ToList();
        var librarySha256Keys = userFiles
            .Select(x => x.StorageKey)
            .Where(x => x.StartsWith("sha256/", StringComparison.Ordinal))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var keys = await _storage.ListObjectKeysAsync("sha256/");
        foreach (var key in keys)
        {
            if (librarySha256Keys.Contains(key)) continue;
            var metadata = await _storage.GetObjectMetadataAsync(key);
            var contentType = metadata.Headers.ContentType ?? string.Empty;
            if (!contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) &&
                !contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                continue;

            if (contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                await _storage.CreateVideoPreviewAsync(key, contentType);

            var hash = key["sha256/".Length..];
            media.Add(new PinterestMediaDto(
                hash,
                hash,
                contentType,
                null,
                null,
                metadata.LastModified,
                _storage.GetPublicObjectUrl(key),
                contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                    ? _storage.GetPublicObjectUrl(_storage.GetPreviewObjectKey(key))
                    : contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)
                        ? _storage.GetPublicObjectUrl(_storage.GetVideoPreviewObjectKey(key))
                    : null));
        }

        var orderedMedia = media
            .OrderBy(x => GetPinterestShuffleKey(x.Id, seed))
            .ThenBy(x => x.Id, StringComparer.Ordinal)
            .ToList();
        var offset = (long)(page - 1) * pageSize;
        List<PinterestMediaDto> items = offset >= orderedMedia.Count
            ? []
            : orderedMedia.Skip((int)offset).Take(pageSize).ToList();
        return Ok(new PinterestMediaPageDto(
            items,
            (long)orderedMedia.Count > (long)page * pageSize));
    }

    private static ulong GetPinterestShuffleKey(string id, int seed)
    {
        const ulong offsetBasis = 14695981039346656037;
        const ulong prime = 1099511628211;
        var hash = offsetBasis;

        foreach (var character in $"{seed}:{id}")
        {
            hash ^= character;
            hash = unchecked(hash * prime);
        }

        return hash;
    }

    [HttpPost("folders")]
    public async Task<ActionResult<FileFolderDto>> CreateFolder(CreateFolderRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();
        var name = request.Name.Trim();
        if (name.Length is < 1 or > 120) return BadRequest(new { message = "Название папки должно быть от 1 до 120 символов" });
        if (await _db.FileFolders.AnyAsync(x => x.OwnerId == userId && x.Name == name)) return Conflict(new { message = "Такая папка уже существует" });
        var folder = new FileFolder { OwnerId = userId.Value, Name = name, AccessLevel = request.AccessLevel };
        _db.FileFolders.Add(folder);
        await _db.SaveChangesAsync();
        return Ok(new FileFolderDto(folder.Id, folder.Name, folder.AccessLevel, 0, folder.CreatedAt, $"/files/gallery/{folder.Id}"));
    }

    [HttpPost("library/upload")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxFileSizeBytes)]
    public async Task<ActionResult<UserFileDto>> UploadLibraryFile(IFormFile file, [FromForm] Guid? folderId, [FromForm] int? width, [FromForm] int? height)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();
        if (file.Length == 0 || file.Length > MaxFileSizeBytes) return BadRequest(new { message = "Файл должен быть размером до 500 МБ" });

        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId.Value);
        if (user == null) return NotFound();

        var effectiveQuota = user.StorageQuotaBytes ?? (await _db.StorageSettings.AsNoTracking().FirstOrDefaultAsync(x => x.Id == StorageSettings.SingletonId) ?? new StorageSettings()).DefaultUserQuotaBytes;
        var usedBytes = await _db.UserFiles.AsNoTracking().Where(x => x.OwnerId == userId.Value).SumAsync(x => (long?)x.SizeBytes) ?? 0;
        if (usedBytes + file.Length > effectiveQuota)
        {
            var availableBytes = Math.Max(0, effectiveQuota - usedBytes);
            return BadRequest(new
            {
                message = $"Лимит хранилища превышен. Доступно {FormatBytes(availableBytes)} из {FormatBytes(effectiveQuota)}.",
                availableBytes,
                quotaBytes = effectiveQuota,
                usedBytes
            });
        }

        FileFolder? folder = null;
        if (folderId.HasValue)
        {
            folder = await _db.FileFolders.FirstOrDefaultAsync(x => x.Id == folderId && x.OwnerId == userId);
            if (folder == null) return NotFound(new { message = "Папка не найдена" });
        }
        var fileName = Path.GetFileName(file.FileName);
        await using var stream = file.OpenReadStream();
        var storageKey = BuildLibraryStorageKey(userId.Value, folderId, fileName);
        await _storage.UploadObjectAsync(storageKey, stream, file.ContentType);
        var userFile = new UserFile { OwnerId = userId.Value, FolderId = folderId, FileName = fileName, StorageKey = storageKey, ContentType = file.ContentType, SizeBytes = file.Length, Width = width, Height = height, AccessLevel = folder?.AccessLevel ?? FileAccessLevel.Authenticated };
        _db.UserFiles.Add(userFile);
        await _db.SaveChangesAsync();
        if (folderId.HasValue)
            await _ogImageCache.InvalidateAsync(OgImageStorageCache.GalleryKey(folderId.Value));
        if (file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ||
            file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
            _imagePreviewBackgroundService.Enqueue(storageKey, file.ContentType);
        return Ok(ToUserFileDto(userFile, folder));
    }

    [HttpDelete("folders/{id:guid}")]
    public async Task<IActionResult> DeleteFolder(Guid id)
    {
        var userId = GetUserId();
        var folder = await _db.FileFolders
            .FirstOrDefaultAsync(x => x.Id == id && x.OwnerId == userId);
        if (folder == null) return NotFound();

        var files = await _db.UserFiles.AsNoTracking().Where(file => file.FolderId == id)
            .Select(file => new FileStorageObject(file.StorageKey, file.ContentType, null)).ToListAsync();
        await _storage.DeleteObjectsAsync(GetDeletableObjectKeys(files));
        await _db.UserFiles.Where(file => file.FolderId == id).ExecuteDeleteAsync();
        await _contentAddressedPreviewCleanup.DeleteUnusedPreviewsAsync(
            files.Select(file => (file.StorageKey, file.ContentType)));
        await _db.FileFolders.Where(item => item.Id == id).ExecuteDeleteAsync();
        await _ogImageCache.InvalidateAsync(OgImageStorageCache.GalleryKey(id));
        return NoContent();
    }

    [HttpPatch("library/{id:guid}/visibility")]
    public async Task<ActionResult<UserFileDto>> UpdateVisibility(Guid id, UpdateFileVisibilityRequest request)
    {
        var userId = GetUserId();
        var file = await _db.UserFiles.Include(x => x.Folder).FirstOrDefaultAsync(x => x.Id == id && x.OwnerId == userId);
        if (file == null) return NotFound();
        file.AccessLevel = request.AccessLevel;
        await _db.SaveChangesAsync();
        if (file.FolderId.HasValue)
            await _ogImageCache.InvalidateAsync(OgImageStorageCache.GalleryKey(file.FolderId.Value));
        return Ok(ToUserFileDto(file));
    }

    [HttpPatch("library/visibility")]
    public async Task<IActionResult> UpdateVisibilityBulk(BulkFileVisibilityRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();
        var ids = request.FileIds.Distinct().ToArray();
        if (ids.Length == 0) return NoContent();

        var folderIds = await _db.UserFiles.AsNoTracking()
            .Where(file => file.OwnerId == userId && ids.Contains(file.Id) && file.FolderId != null)
            .Select(file => file.FolderId!.Value).Distinct().ToListAsync();
        await _db.UserFiles.Where(file => file.OwnerId == userId && ids.Contains(file.Id))
            .ExecuteUpdateAsync(setters => setters.SetProperty(file => file.AccessLevel, request.AccessLevel));
        foreach (var folderId in folderIds)
            await _ogImageCache.InvalidateAsync(OgImageStorageCache.GalleryKey(folderId));
        return NoContent();
    }

    [HttpDelete("library")]
    public async Task<IActionResult> DeleteLibraryFiles(BulkDeleteFilesRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();
        var ids = request.FileIds.Distinct().ToArray();
        if (ids.Length == 0) return NoContent();

        var files = await _db.UserFiles.AsNoTracking()
            .Where(file => file.OwnerId == userId && ids.Contains(file.Id))
            .Select(file => new FileStorageObject(file.StorageKey, file.ContentType, file.FolderId))
            .ToListAsync();
        await _storage.DeleteObjectsAsync(GetDeletableObjectKeys(files));
        await _db.UserFiles.Where(file => file.OwnerId == userId && ids.Contains(file.Id))
            .ExecuteDeleteAsync();
        await _contentAddressedPreviewCleanup.DeleteUnusedPreviewsAsync(
            files.Select(file => (file.StorageKey, file.ContentType)));
        foreach (var folderId in files.Where(file => file.FolderId.HasValue).Select(file => file.FolderId!.Value).Distinct())
            await _ogImageCache.InvalidateAsync(OgImageStorageCache.GalleryKey(folderId));
        return NoContent();
    }

    [HttpPatch("library/{id:guid}/name")]
    public async Task<ActionResult<UserFileDto>> RenameLibraryFile(Guid id, RenameRequest request)
    {
        var userId = GetUserId();
        var file = await _db.UserFiles.Include(x => x.Folder)
            .FirstOrDefaultAsync(x => x.Id == id && x.OwnerId == userId);
        if (file == null) return NotFound();

        var name = Path.GetFileName(request.Name.Trim());
        if (name.Length is < 1 or > 255)
            return BadRequest(new { message = "Имя файла должно быть от 1 до 255 символов" });

        file.FileName = name;
        await _db.SaveChangesAsync();
        return Ok(ToUserFileDto(file));
    }

    [HttpPatch("library/{id:guid}/folder")]
    public async Task<ActionResult<UserFileDto>> MoveLibraryFile(Guid id, MoveFileRequest request)
    {
        var userId = GetUserId();
        var file = await _db.UserFiles.Include(x => x.Folder)
            .FirstOrDefaultAsync(x => x.Id == id && x.OwnerId == userId);
        if (file == null) return NotFound();

        FileFolder? targetFolder = null;
        if (request.FolderId.HasValue)
        {
            targetFolder = await _db.FileFolders.FirstOrDefaultAsync(x =>
                x.Id == request.FolderId && x.OwnerId == userId);
            if (targetFolder == null) return NotFound(new { message = "Папка не найдена" });
        }

        if (file.FolderId != request.FolderId)
        {
            var sourceFolderId = file.FolderId;
            var sourceStorageKey = file.StorageKey;
            var destinationKey = BuildLibraryStorageKey(userId!.Value, request.FolderId, file.FileName);
            await _storage.CopyObjectAsync(file.StorageKey, destinationKey);
            if (file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
            {
                await _storage.CreateVideoPreviewAsync(file.StorageKey, file.ContentType);
                await _storage.CopyObjectAsync(_storage.GetVideoPreviewObjectKey(file.StorageKey), _storage.GetVideoPreviewObjectKey(destinationKey));
            }
            if (!IsContentAddressedKey(file.StorageKey))
                await _storage.DeleteObjectAsync(file.StorageKey);

            file.StorageKey = destinationKey;
            file.FolderId = request.FolderId;
            file.Folder = targetFolder;
            file.AccessLevel = targetFolder?.AccessLevel ?? FileAccessLevel.Private;
            await _db.SaveChangesAsync();
            await _contentAddressedPreviewCleanup.DeleteUnusedPreviewsAsync(
                new[] { (sourceStorageKey, file.ContentType) });
            if (sourceFolderId.HasValue)
                await _ogImageCache.InvalidateAsync(OgImageStorageCache.GalleryKey(sourceFolderId.Value));
            if (request.FolderId.HasValue)
                await _ogImageCache.InvalidateAsync(OgImageStorageCache.GalleryKey(request.FolderId.Value));
            if (file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                _imagePreviewBackgroundService.Enqueue(destinationKey, file.ContentType);
        }

        return Ok(ToUserFileDto(file, targetFolder));
    }

    [HttpPatch("folders/{id:guid}/visibility")]
    public async Task<IActionResult> UpdateFolderVisibility(Guid id, UpdateFolderVisibilityRequest request)
    {
        var userId = GetUserId();
        var folder = await _db.FileFolders.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id && x.OwnerId == userId);
        if (folder == null) return NotFound();
        await _db.FileFolders.Where(item => item.Id == id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.AccessLevel, request.AccessLevel));
        await _db.UserFiles.Where(file => file.FolderId == id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(file => file.AccessLevel, request.AccessLevel));
        await _ogImageCache.InvalidateAsync(OgImageStorageCache.GalleryKey(id));
        return NoContent();
    }

    [HttpPatch("folders/{id:guid}/name")]
    public async Task<ActionResult<FileFolderDto>> RenameFolder(Guid id, RenameRequest request)
    {
        var userId = GetUserId();
        var folder = await _db.FileFolders.Include(x => x.Files)
            .FirstOrDefaultAsync(x => x.Id == id && x.OwnerId == userId);
        if (folder == null) return NotFound();

        var name = request.Name.Trim();
        if (name.Length is < 1 or > 120)
            return BadRequest(new { message = "Название папки должно быть от 1 до 120 символов" });
        if (await _db.FileFolders.AnyAsync(x => x.OwnerId == userId && x.Id != id && x.Name == name))
            return Conflict(new { message = "Такая папка уже существует" });

        folder.Name = name;
        await _db.SaveChangesAsync();
        await _ogImageCache.InvalidateAsync(OgImageStorageCache.GalleryKey(id));
        return Ok(new FileFolderDto(folder.Id, folder.Name, folder.AccessLevel, folder.Files.Count, folder.CreatedAt, $"/files/gallery/{folder.Id}"));
    }

    [AllowAnonymous]
    [HttpGet("gallery/{folderId:guid}")]
    public async Task<ActionResult<object>> GetGallery(Guid folderId)
    {
        var folder = await _db.FileFolders.AsNoTracking().Include(x => x.Files).FirstOrDefaultAsync(x => x.Id == folderId);
        if (folder == null || !CanAccess(folder.AccessLevel, folder.OwnerId)) return NotFound();
        var images = folder.Files
            .Where(x => (x.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) || x.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)) && CanAccess(x.AccessLevel, x.OwnerId))
            .OrderBy(x => x.UploadedAt)
            .Select(x => new { x.Id, x.FileName, Url = _storage.GetPublicObjectUrl(x.StorageKey), PreviewUrl = x.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ? _storage.GetPublicObjectUrl(_storage.GetPreviewObjectKey(x.StorageKey)) : x.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase) ? _storage.GetPublicObjectUrl(_storage.GetVideoPreviewObjectKey(x.StorageKey)) : null, x.ContentType, x.Width, x.Height })
            .ToList();
        return Ok(new { folder.Name, folder.AccessLevel, images });
    }

    [AllowAnonymous]
    [HttpGet("gallery/metadata/{folderId:guid}")]
    public async Task<IActionResult> GetGalleryMetadata(Guid folderId)
    {
        var folder = await _db.FileFolders.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == folderId && x.AccessLevel == FileAccessLevel.Public);
        if (folder == null)
            return NotFound();

        var title = $"Коллекция «{folder.Name.Trim()}»";
        var description = $"Фото из коллекции «{folder.Name.Trim()}» на Помойка.inc.";
        var origin = GetPublicOrigin();
        var canonicalUrl = $"{origin}/files/gallery/{folder.Id}";
        var imageUrl = $"{origin}/gallery-og/{folder.Id}.png";

        static string Encode(string value) => HtmlEncoder.Default.Encode(value);

        var html = $"""
            <!doctype html>
            <html lang="ru">
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>{Encode($"{title} — Помойка.inc")}</title>
                <meta name="description" content="{Encode(description)}">
                <meta property="og:site_name" content="Помойка.inc">
                <meta property="og:type" content="website">
                <meta property="og:title" content="{Encode($"{title} — Помойка.inc")}">
                <meta property="og:description" content="{Encode(description)}">
                <meta property="og:url" content="{Encode(canonicalUrl)}">
                <meta property="og:image" content="{Encode(imageUrl)}">
                <meta property="og:image:width" content="1200">
                <meta property="og:image:height" content="630">
                <meta name="twitter:card" content="summary_large_image">
                <meta name="twitter:title" content="{Encode($"{title} — Помойка.inc")}">
                <meta name="twitter:description" content="{Encode(description)}">
                <meta name="twitter:image" content="{Encode(imageUrl)}">
              </head>
              <body><h1>{Encode(title)}</h1><p>{Encode(description)}</p></body>
            </html>
            """;

        return Content(html, "text/html; charset=utf-8");
    }

    [HttpGet("link-preview")]
    public async Task<ActionResult<object>> GetLinkPreview(
        [FromQuery] string url,
        CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var target) ||
            !IsHttpUrl(target) ||
            target.UserInfo.Length > 0)
            return BadRequest(new { message = "Укажите корректную ссылку" });

        try
        {
            for (var redirectCount = 0; redirectCount <= 3; redirectCount++)
            {
                var addresses = await GetPublicAddressesAsync(target, cancellationToken);
                if (addresses.Length == 0)
                    return BadRequest(new { message = "Ссылка ведёт на недоступный адрес" });

                using var handler = new SocketsHttpHandler
                {
                    AllowAutoRedirect = false,
                    ConnectTimeout = TimeSpan.FromSeconds(4),
                    AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
                    ConnectCallback = async (context, token) =>
                    {
                        Exception? lastException = null;
                        foreach (var address in addresses)
                        {
                            var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
                            try
                            {
                                await socket.ConnectAsync(
                                    new IPEndPoint(address, context.DnsEndPoint.Port),
                                    token);
                                return new NetworkStream(socket, ownsSocket: true);
                            }
                            catch (Exception exception) when (
                                exception is SocketException or OperationCanceledException)
                            {
                                socket.Dispose();
                                lastException = exception;
                                if (exception is OperationCanceledException)
                                    throw;
                            }
                        }

                        throw new HttpRequestException("Could not connect to the preview host", lastException);
                    },
                };
                using var client = new HttpClient(handler)
                {
                    Timeout = TimeSpan.FromSeconds(8),
                };
                using var request = new HttpRequestMessage(HttpMethod.Get, target);
                request.Headers.UserAgent.ParseAdd("PomoykaLinkPreview/1.0");
                using var response = await client.SendAsync(
                    request,
                    HttpCompletionOption.ResponseHeadersRead,
                    cancellationToken);

                if ((int)response.StatusCode is >= 300 and < 400 &&
                    response.Headers.Location is { } location)
                {
                    var nextTarget = location.IsAbsoluteUri
                        ? location
                        : new Uri(target, location);
                    if (redirectCount == 3 ||
                        !IsHttpUrl(nextTarget) ||
                        nextTarget.UserInfo.Length > 0)
                        return BadRequest(new { message = "Ссылка перенаправляет на недопустимый адрес" });
                    target = nextTarget;
                    continue;
                }

                return await BuildLinkPreviewResponseAsync(response, target, cancellationToken);
            }
            return BadRequest(new { message = "Ссылка перенаправляет слишком много раз" });
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return BadRequest(new { message = "Превью ссылки не удалось загрузить вовремя" });
        }
        catch (HttpRequestException)
        {
            return BadRequest(new { message = "Не удалось загрузить превью ссылки" });
        }
        catch (SocketException)
        {
            return BadRequest(new { message = "Не удалось найти адрес сайта" });
        }
    }

    private async Task<ActionResult<object>> BuildLinkPreviewResponseAsync(
        HttpResponseMessage response,
        Uri target,
        CancellationToken cancellationToken)
    {
        if (!response.IsSuccessStatusCode ||
            response.Content.Headers.ContentType?.MediaType is not ("text/html" or "application/xhtml+xml"))
            return BadRequest(new { message = "Не удалось получить превью этой ссылки" });

        if (response.Content.Headers.ContentLength is > 1_048_576)
            return BadRequest(new { message = "Страница слишком большая для превью" });

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        while (true)
        {
            var read = await stream.ReadAsync(chunk, cancellationToken);
            if (read == 0)
                break;
            if (buffer.Length + read > 1_048_576)
                return BadRequest(new { message = "Страница слишком большая для превью" });
            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
        }

        var html = Encoding.UTF8.GetString(buffer.ToArray());
        var title = GetMetaContent(html, "og:title") ??
            Regex.Match(html, @"<title\b[^>]*>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline)
                .Groups[1].Value;
        var description = GetMetaContent(html, "og:description") ??
            GetMetaContent(html, "description") ?? "";
        var image = GetMetaContent(html, "og:image");
        string? imageUrl = null;
        if (!string.IsNullOrWhiteSpace(image) &&
            Uri.TryCreate(target, image, out var resolvedImage) &&
            IsHttpUrl(resolvedImage) &&
            resolvedImage.UserInfo.Length == 0 &&
            (await GetPublicAddressesAsync(resolvedImage, cancellationToken)).Length > 0)
            imageUrl = resolvedImage.AbsoluteUri;

        return Ok(new
        {
            url = target.AbsoluteUri,
            title = CleanPreviewText(title, 200),
            description = CleanPreviewText(description, 500),
            imageUrl,
            siteName = target.Host,
        });
    }

    [AllowAnonymous]
    [HttpGet("gallery/og/{folderId:guid}.png")]
    public async Task<IActionResult> GetGalleryOgImage(Guid folderId)
    {
        var isPublicGallery = await _db.FileFolders.AsNoTracking()
            .AnyAsync(x => x.Id == folderId && x.AccessLevel == FileAccessLevel.Public);
        if (!isPublicGallery)
            return NotFound();

        var cacheKey = OgImageStorageCache.GalleryKey(folderId);
        var cachedImage = await _ogImageCache.TryGetAsync(cacheKey, HttpContext.RequestAborted);
        if (cachedImage != null)
        {
            Response.Headers.CacheControl = "no-cache";
            return File(cachedImage, "image/png");
        }

        var folder = await _db.FileFolders.AsNoTracking()
            .Include(x => x.Files)
            .Include(x => x.Owner)
            .FirstOrDefaultAsync(x => x.Id == folderId && x.AccessLevel == FileAccessLevel.Public);
        if (folder == null)
            return NotFound();

        const int width = 1200;
        const int height = 630;
        const int left = 58;

        var fontsPath = Path.Combine(AppContext.BaseDirectory, "Assets", "Fonts");
        var boldFontPath = Path.Combine(fontsPath, "Geist-Bold.ttf");
        if (!System.IO.File.Exists(boldFontPath))
            throw new InvalidOperationException(
                $"OG font is missing. Add Geist-Bold.ttf to {fontsPath}.");
        var brandIconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "logo", "icon.png");
        if (!System.IO.File.Exists(brandIconPath))
            throw new InvalidOperationException(
                $"OG logo is missing. Add icon.png to {Path.GetDirectoryName(brandIconPath)}.");

        var fonts = new FontCollection();
        var boldFamily = fonts.Add(boldFontPath);
        var labelFont = boldFamily.CreateFont(27, FontStyle.Bold);
        var titleFont = boldFamily.CreateFont(58, FontStyle.Bold);
        var brandFont = boldFamily.CreateFont(30, FontStyle.Bold);
        var brandMarkFont = boldFamily.CreateFont(18, FontStyle.Bold);
        using var brandIcon = await Image.LoadAsync<Rgba32>(brandIconPath);
        brandIcon.Mutate(context => context.Resize(new Size(56, 56)));

        using var canvas = new Image<Rgba32>(width, height);
        canvas.Mutate(context => context.Fill(Color.FromRgb(24, 24, 24)));

        var files = folder.Files
            .Where(file =>
                file.AccessLevel == FileAccessLevel.Public &&
                file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        Random.Shared.Shuffle(files);
        Array.Resize(ref files, Math.Min(files.Length, 9));

        // Плитки сначала склеиваются на ровной плоской "стене" (сетка 3x3 без зазоров),
        // а потом вся стена целиком проецируется в перспективу одним преобразованием.
        const int columns = 3;
        const int rows = 3;
        const int slots = columns * rows;
        const int tileWidth = 320;
        const int tileHeight = 260;
        const int tileGap = 0;
        const int planeWidth = columns * tileWidth + (columns - 1) * tileGap;
        const int planeHeight = rows * tileHeight + (rows - 1) * tileGap;

        using var plane = new Image<Rgba32>(planeWidth, planeHeight);

        var tiles = new List<Image<Rgba32>>();
        try
        {
            foreach (var file in files)
            {
                var image = await TryLoadGalleryImageAsync(
                    _storage.GetFeedPreviewObjectKey(file.StorageKey),
                    HttpContext.RequestAborted)
                    ?? await TryLoadGalleryImageAsync(file.StorageKey, HttpContext.RequestAborted);
                if (image == null)
                    continue;

                tiles.Add(image);
                image.Mutate(context => context.Resize(new ResizeOptions
                {
                    Size = new Size(tileWidth, tileHeight),
                    Mode = ResizeMode.Crop,
                    Position = AnchorPositionMode.Center
                }));
            }

            if (tiles.Count > 0)
            {
                for (var slot = 0; slot < slots; slot++)
                {
                    var x = slot % columns * (tileWidth + tileGap);
                    var y = slot / columns * (tileHeight + tileGap);
                    var tile = tiles[slot % tiles.Count];
                    plane.Mutate(context => context.DrawImage(tile, new Point(x, y), 1f));
                }
            }
        }
        finally
        {
            foreach (var tile in tiles)
                tile.Dispose();
        }

        var quad = ProjectGalleryPlane(
            planeWidth, planeHeight,
            yawDegrees: -35f, pitchDegrees: -15f,
            distance: 1900f, focalLength: 2250f, scale: 1.3f,
            centerX: 720f, centerY: 270f);
        DrawGalleryPlane(canvas, plane, quad);

        ApplyGalleryOgOverlay(canvas);
        var titleLines = WrapGalleryTitle(folder.Name.Trim(), titleFont, width - left * 2);
        canvas.Mutate(context =>
        {
            DrawGalleryOgBrand(context, width, brandIcon, brandFont, brandMarkFont);
            for (var index = 0; index < titleLines.Count; index++)
                context.DrawText(titleLines[index], titleFont, Color.White,
                    new PointF(left, 492 + index * 66));
        });

        var ownerName = folder.Owner?.DisplayName ?? "Помойка.inc";
        var ownerNameColor = TryParseGalleryNicknameColor(folder.Owner?.NicknameColor);
        const int ownerAvatarSize = 48;
        var ownerAvatarKey = GetGalleryAvatarStorageKey(folder.Owner?.AvatarUrl);
        if (ownerAvatarKey != null)
        {
            using var ownerAvatar = await TryLoadGalleryImageAsync(
                ownerAvatarKey,
                HttpContext.RequestAborted);
            if (ownerAvatar != null)
            {
                ownerAvatar.Mutate(context => context.Resize(new ResizeOptions
                {
                    Size = new Size(ownerAvatarSize, ownerAvatarSize),
                    Mode = ResizeMode.Crop,
                    Position = AnchorPositionMode.Center
                }));
                MakeGalleryAvatarCircular(ownerAvatar);
                canvas.Mutate(context => context.DrawImage(
                    ownerAvatar,
                    new Point(left, 32),
                    1f));
            }
        }

        var ownerNameBounds = TextMeasurer.MeasureBounds(ownerName, new TextOptions(labelFont));
        var ownerNameY = 32 + (ownerAvatarSize - ownerNameBounds.Height) / 2 - ownerNameBounds.Y;
        canvas.Mutate(context => context.DrawText(
            ownerName,
            labelFont,
            ownerNameColor,
            new PointF(left + ownerAvatarSize + 14, ownerNameY)));

        var stream = new MemoryStream();
        await canvas.SaveAsync(stream, new PngEncoder(), HttpContext.RequestAborted);
        var imageBytes = stream.ToArray();
        await _ogImageCache.StoreAsync(cacheKey, imageBytes);
        Response.Headers.CacheControl = "no-cache";
        return File(imageBytes, "image/png");
    }

    [AllowAnonymous]
    [HttpGet("library/{id:guid}/download")]
    public async Task<IActionResult> DownloadLibraryFile(Guid id)
    {
        var file = await _db.UserFiles.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        if (file == null || !CanAccess(file.AccessLevel, file.OwnerId)) return NotFound();

        var objectResponse = await _storage.GetObjectAsync(file.StorageKey);
        Response.Headers.CacheControl = "private, max-age=31536000, immutable";
        return File(
            objectResponse.ResponseStream,
            objectResponse.Headers.ContentType ?? file.ContentType,
            file.FileName,
            file.UploadedAt,
            new EntityTagHeaderValue($"\"{file.Id:N}\""),
            enableRangeProcessing: true);
    }

    [HttpPost("library/download-archive")]
    public async Task<IActionResult> DownloadLibraryArchive(
        [FromBody] DownloadFilesArchiveRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();

        var requestedFileIds = request.FileIds ?? new List<Guid>();
        if (request.FolderId.HasValue && requestedFileIds.Count > 0)
            return BadRequest(new { message = "Укажите файлы или папку, но не оба варианта" });

        UserFile[] orderedFiles;
        string? archiveRootName = null;
        if (request.FolderId is Guid folderId)
        {
            var folder = await _db.FileFolders.AsNoTracking()
                .FirstOrDefaultAsync(
                    item => item.Id == folderId,
                    HttpContext.RequestAborted);
            if (folder == null || !CanAccess(folder.AccessLevel, folder.OwnerId))
                return NotFound();

            archiveRootName = GetUniqueArchiveEntryName(
                folder.Name,
                new HashSet<string>(StringComparer.OrdinalIgnoreCase));
            var folderFiles = await _db.UserFiles.AsNoTracking()
                .Where(file => file.FolderId == folderId)
                .OrderBy(file => file.FileName)
                .ToArrayAsync(HttpContext.RequestAborted);
            orderedFiles = folderFiles
                .Where(file => CanAccess(file.AccessLevel, file.OwnerId))
                .ToArray();
        }
        else
        {
            var fileIds = requestedFileIds.Distinct().ToArray();
            if (fileIds.Length == 0)
                return BadRequest(new { message = "Выберите файлы или папку для скачивания" });

            var files = await _db.UserFiles.AsNoTracking()
                .Where(file => fileIds.Contains(file.Id))
                .ToListAsync(HttpContext.RequestAborted);
            if (files.Count != fileIds.Length ||
                files.Any(file => !CanAccess(file.AccessLevel, file.OwnerId)))
                return NotFound();

            var filesById = files.ToDictionary(file => file.Id);
            orderedFiles = fileIds.Select(id => filesById[id]).ToArray();
        }

        var temporaryDirectory = Path.Combine(
            Path.GetTempPath(),
            "feed-api-archives",
            Guid.NewGuid().ToString("N"));
        var keepTemporaryDirectory = false;

        try
        {
            Directory.CreateDirectory(temporaryDirectory);
            var archiveContentDirectory = archiveRootName == null
                ? temporaryDirectory
                : Path.Combine(temporaryDirectory, archiveRootName);
            Directory.CreateDirectory(archiveContentDirectory);

            var entryNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var archiveFilePaths = new List<string>(orderedFiles.Length);
            foreach (var file in orderedFiles)
            {
                var entryName = GetUniqueArchiveEntryName(file.FileName, entryNames);
                archiveFilePaths.Add(Path.Combine(archiveContentDirectory, entryName));

                var objectResponse = await _storage.GetObjectAsync(
                    file.StorageKey,
                    HttpContext.RequestAborted);
                using (objectResponse)
                await using (var output = new FileStream(
                    Path.Combine(archiveContentDirectory, entryName),
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None,
                    81920,
                    FileOptions.Asynchronous | FileOptions.SequentialScan))
                {
                    await objectResponse.ResponseStream.CopyToAsync(
                        output,
                        HttpContext.RequestAborted);
                }
            }

            var archivePath = Path.Combine(temporaryDirectory, "files.7z");
            var startInfo = new ProcessStartInfo
            {
                FileName = _sevenZipExecutable,
                WorkingDirectory = Path.GetTempPath(),
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            startInfo.ArgumentList.Add("a");
            startInfo.ArgumentList.Add("-t7z");
            startInfo.ArgumentList.Add("-mx=5");
            startInfo.ArgumentList.Add(archivePath);
            startInfo.ArgumentList.Add("--");
            if (archiveRootName != null)
                startInfo.ArgumentList.Add(archiveContentDirectory);
            else
                foreach (var filePath in archiveFilePaths)
                    startInfo.ArgumentList.Add(filePath);

            using var process = Process.Start(startInfo)
                ?? throw new InvalidOperationException("Не удалось запустить 7-Zip");
            string standardError;
            try
            {
                var standardOutputTask = process.StandardOutput.BaseStream.CopyToAsync(
                    Stream.Null,
                    HttpContext.RequestAborted);
                var standardErrorTask = process.StandardError.ReadToEndAsync(
                    HttpContext.RequestAborted);
                await process.WaitForExitAsync(HttpContext.RequestAborted);
                await standardOutputTask;
                standardError = await standardErrorTask;
            }
            catch
            {
                if (!process.HasExited)
                {
                    try
                    {
                        process.Kill(entireProcessTree: true);
                    }
                    catch (InvalidOperationException)
                    {
                    }
                }

                throw;
            }

            if (process.ExitCode != 0)
            {
                _logger.LogError(
                    "7-Zip failed to create a user file archive (exit code {ExitCode}): {Error}",
                    process.ExitCode,
                    standardError);
                return StatusCode(500, new { message = "Не удалось создать архив" });
            }

            var archiveStream = new FileStream(
                archivePath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                81920,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            Response.OnCompleted(() =>
            {
                TryDeleteArchiveDirectory(temporaryDirectory);
                return Task.CompletedTask;
            });
            keepTemporaryDirectory = true;
            return File(
                archiveStream,
                "application/x-7z-compressed",
                $"{archiveRootName ?? "files"}-{DateTime.UtcNow:yyyyMMdd-HHmmss}.7z");
        }
        catch (OperationCanceledException) when (HttpContext.RequestAborted.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Failed to create a 7-Zip archive for user {UserId}", userId);
            return StatusCode(500, new { message = "Не удалось создать архив" });
        }
        finally
        {
            if (!keepTemporaryDirectory)
                TryDeleteArchiveDirectory(temporaryDirectory);
        }
    }

    private static string GetUniqueArchiveEntryName(
        string fileName,
        HashSet<string> existingNames)
    {
        var leafName = Path.GetFileName(fileName.Replace('\\', '/'));
        var invalidCharacters = Path.GetInvalidFileNameChars()
            .Concat("<>:\"/\\|?*")
            .ToHashSet();
        var safeName = new string(leafName
            .Select(character => invalidCharacters.Contains(character) ? '_' : character)
            .ToArray())
            .Trim()
            .TrimEnd('.');
        if (string.IsNullOrWhiteSpace(safeName) || safeName is "." or "..")
            safeName = "file";

        var name = safeName;
        var extension = Path.GetExtension(safeName);
        var nameWithoutExtension = Path.GetFileNameWithoutExtension(safeName);
        for (var suffix = 2; !existingNames.Add(name); suffix++)
            name = $"{nameWithoutExtension} ({suffix}){extension}";

        return name;
    }

    private void TryDeleteArchiveDirectory(string directory)
    {
        try
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, recursive: true);
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException)
        {
            _logger.LogWarning(
                exception,
                "Failed to clean up temporary archive directory {Directory}",
                directory);
        }
    }

    [HttpGet("sha256/{hash}/download")]
    public async Task<IActionResult> DownloadSha256File(string hash)
    {
        if (hash.Length != 64 || !hash.All(Uri.IsHexDigit)) return NotFound();

        var normalizedHash = hash.ToLowerInvariant();

        Response.Headers.CacheControl = "private, max-age=31536000, immutable";
        Response.Headers.ETag = $"\"{normalizedHash}\"";

        var objectResponse = await _storage.GetObjectAsync($"sha256/{normalizedHash}");
        return File(
            objectResponse.ResponseStream,
            objectResponse.Headers.ContentType ?? "application/octet-stream",
            enableRangeProcessing: true);
    }

    [HttpGet("post/{id:guid}/download")]
    [AllowAnonymous]
    public async Task<IActionResult> DownloadPostFile(Guid id)
    {
        var file = await _db.PostFiles
            .AsNoTracking()
            .Include(x => x.Post)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (file == null) return NotFound();
        if (User.Identity?.IsAuthenticated != true &&
            (file.Post?.IsPostishka != true || file.Post.AccessLevel != PostAccessLevel.Public))
            return NotFound();

        var objectResponse = await _storage.GetObjectAsync(file.StorageKey);
        return File(objectResponse.ResponseStream, objectResponse.Headers.ContentType ?? file.ContentType, file.FileName);
    }

    [HttpGet("comment/{id:guid}/download")]
    [AllowAnonymous]
    public async Task<IActionResult> DownloadCommentFile(Guid id)
    {
        var file = await _db.CommentFiles
            .AsNoTracking()
            .Include(x => x.Comment)
                .ThenInclude(x => x!.Post)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (file?.Comment?.Post == null) return NotFound();
        if (User.Identity?.IsAuthenticated != true &&
            (!file.Comment.Post.IsPostishka ||
             file.Comment.Post.AccessLevel != PostAccessLevel.Public))
            return NotFound();

        var objectResponse = await _storage.GetObjectAsync(file.StorageKey);
        return File(
            objectResponse.ResponseStream,
            objectResponse.Headers.ContentType ?? file.ContentType,
            file.FileName);
    }

    [HttpGet("archive/{id:guid}/download")]
    public async Task<IActionResult> DownloadArchivedFile(Guid id)
    {
        var file = await _db.ArchivedPostFiles.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        if (file == null) return NotFound();

        var objectResponse = await _storage.GetObjectAsync(file.StorageKey);
        return File(objectResponse.ResponseStream, objectResponse.Headers.ContentType ?? file.ContentType, file.FileName);
    }

    [HttpDelete("library/{id:guid}")]
    public async Task<IActionResult> DeleteLibraryFile(Guid id)
    {
        var userId = GetUserId();
        var file = await _db.UserFiles.FirstOrDefaultAsync(x => x.Id == id && x.OwnerId == userId);
        if (file == null) return NotFound();
        var folderId = file.FolderId;
        if (!IsContentAddressedKey(file.StorageKey))
        {
            await _storage.DeleteObjectAsync(file.StorageKey);
            if (file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                await _storage.DeleteObjectsAsync(_storage.GetImagePreviewObjectKeys(file.StorageKey));
            else if (file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                await _storage.DeleteObjectAsync(_storage.GetVideoPreviewObjectKey(file.StorageKey));
        }
        _db.UserFiles.Remove(file);
        await _db.SaveChangesAsync();
        await _contentAddressedPreviewCleanup.DeleteUnusedPreviewsAsync(
            new[] { (file.StorageKey, file.ContentType) });
        if (folderId.HasValue)
            await _ogImageCache.InvalidateAsync(OgImageStorageCache.GalleryKey(folderId.Value));
        return NoContent();
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var userId = GetUserId();
        var file = await _db.PostFiles.Include(f => f.Post).FirstOrDefaultAsync(f => f.Id == id);
        if (file == null) return NotFound();
        if (file.Post!.AuthorId != userId) return Forbid();

        if (!IsContentAddressedKey(file.StorageKey))
        {
            await _storage.DeleteObjectAsync(file.StorageKey);
            if (file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                await _storage.DeleteObjectsAsync(_storage.GetImagePreviewObjectKeys(file.StorageKey));
            else if (file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                await _storage.DeleteObjectAsync(_storage.GetVideoPreviewObjectKey(file.StorageKey));
        }
        _db.PostFiles.Remove(file);
        await _db.SaveChangesAsync();
        await _contentAddressedPreviewCleanup.DeleteUnusedPreviewsAsync(
            new[] { (file.StorageKey, file.ContentType) });
        if (file.Post!.IsPostishka)
            await _ogImageCache.InvalidateAsync(OgImageStorageCache.PostKey(file.PostId));

        return NoContent();
    }

    [HttpPost("post/{postId:guid}")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxPostFileSizeBytes)]
    public async Task<ActionResult<PostFileDto>> UploadPostFile(Guid postId, IFormFile file)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();
        if (file.Length == 0 || file.Length > MaxPostFileSizeBytes)
            return BadRequest(new { message = "Файл должен быть размером до 500 МБ" });
        if (!IsAllowedFile(file))
            return BadRequest(new { message = "Разрешены изображения, музыка, видео и архивы" });

        var post = await _db.Posts.FirstOrDefaultAsync(p => p.Id == postId);
        if (post == null) return NotFound(new { message = "Пост не найден" });
        if (post.AuthorId != userId) return Forbid();

        await using var stream = file.OpenReadStream();
        var storageKey = await _storage.UploadDeduplicatedObjectAsync(stream, file.ContentType);
        await _storage.CreateVideoPreviewAsync(storageKey, file.ContentType);

        var postFile = new PostFile
        {
            PostId = postId,
            FileName = Path.GetFileName(file.FileName),
            StorageKey = storageKey,
            ContentType = file.ContentType,
            SizeBytes = file.Length
        };
        _db.PostFiles.Add(postFile);
        await _db.SaveChangesAsync();
        if (post.IsPostishka)
            await _ogImageCache.InvalidateAsync(OgImageStorageCache.PostKey(postId));
        if (postFile.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            _imagePreviewBackgroundService.Enqueue(storageKey, postFile.ContentType);

        var dto = new PostFileDto
        {
            Id = postFile.Id,
            FileName = postFile.FileName,
            ContentType = postFile.ContentType,
            SizeBytes = postFile.SizeBytes,
            DownloadUrl = $"{Request.Scheme}://{Request.Host}/api/files/post/{postFile.Id}/download",
            PreviewUrl = postFile.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                ? _storage.GetPublicObjectUrl(_storage.GetFeedPreviewObjectKey(postFile.StorageKey))
                : postFile.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)
                    ? _storage.GetPublicObjectUrl(_storage.GetVideoPreviewObjectKey(postFile.StorageKey))
                : string.Empty
        };

        await _feedHub.Clients.Group("feed-global").SendAsync("PostFileAdded", postId, dto);

        return Ok(dto);
    }

    [HttpPost("avatar")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxAvatarSizeBytes)]
    public async Task<ActionResult<string>> UploadAvatar(
        IFormFile file,
        [FromForm] int? cropX = null,
        [FromForm] int? cropY = null,
        [FromForm] int? cropWidth = null,
        [FromForm] int? cropHeight = null)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();
        if (file.Length == 0 || file.Length > MaxAvatarSizeBytes)
            return BadRequest(new { message = "Аватар должен быть размером до 5 МБ" });

        string storageKey;
        await using var stream = file.OpenReadStream();
        if (file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
            storageKey = await _storage.CreateAvatarVideoAsync(stream, cropX, cropY, cropWidth, cropHeight);
        else if (file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            storageKey = await _storage.UploadDeduplicatedObjectAsync(stream, file.ContentType);
        else
            return BadRequest(new { message = "Можно загружать только изображения и видео" });

        var user = await _db.Users.FirstAsync(x => x.Id == userId.Value);
        if (user.AvatarUrl != null && !IsContentAddressedKey(GetAvatarStorageKey(user.AvatarUrl)))
            await _storage.DeleteObjectAsync(GetAvatarStorageKey(user.AvatarUrl));
        user.AvatarUrl = storageKey;
        await _db.SaveChangesAsync();
        await _ogImageCache.InvalidateUserAsync(_db, user.Id);
        var avatarUrl = $"/api/files/avatar/{userId.Value}?v={Uri.EscapeDataString(storageKey)}";
        await _feedHub.Clients.Group("feed-global")
            .SendAsync("UserAvatarChanged", userId.Value, avatarUrl);
        return Ok(avatarUrl);
    }

    [HttpPost("banner")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxBannerSizeBytes)]
    public async Task<ActionResult<string>> UploadBanner(IFormFile file)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();
        if (file.Length == 0 || file.Length > MaxBannerSizeBytes)
            return BadRequest(new { message = "Баннер должен быть размером до 10 МБ" });
        if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "Можно загружать только изображения" });

        await using var stream = file.OpenReadStream();
        var storageKey = await _storage.UploadDeduplicatedObjectAsync(stream, file.ContentType);
        var user = await _db.Users.FirstAsync(x => x.Id == userId.Value);
        if (user.BannerUrl != null && !IsContentAddressedKey(user.BannerUrl))
            await _storage.DeleteObjectAsync(user.BannerUrl);
        user.BannerUrl = storageKey;
        await _db.SaveChangesAsync();
        return Ok($"/api/files/banner/{userId.Value}");
    }

    [HttpPost("invite-image")]
    [Consumes("multipart/form-data")]
    public async Task<ActionResult<string>> UploadInviteImage([FromForm] Guid inviteId, IFormFile file)
    {
        var adminId = GetUserId();
        if (adminId == null) return Unauthorized();
        if (file.Length == 0 || file.Length > MaxBannerSizeBytes)
            return BadRequest(new { message = "Изображение инвайта должно быть до 10 МБ" });
        if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "Можно загружать только изображения" });

        var invite = await _db.InviteCodes.FirstOrDefaultAsync(x => x.Id == inviteId);
        if (invite == null)
            return NotFound(new { message = "Инвайт-код не найден" });

        await using var stream = file.OpenReadStream();
        var storageKey = await _storage.UploadDeduplicatedObjectAsync(stream, file.ContentType);
        if (!string.IsNullOrWhiteSpace(invite.ImageUrl) && !IsContentAddressedKey(invite.ImageUrl))
            await _storage.DeleteObjectAsync(invite.ImageUrl);

        invite.ImageUrl = storageKey;
        await _db.SaveChangesAsync();
        return Ok($"/api/files/invite/{invite.Id}/image");
    }

    [AllowAnonymous]
    [HttpGet("invite/{inviteId:guid}/image")]
    public async Task<IActionResult> GetInviteImage(Guid inviteId)
    {
        var invite = await _db.InviteCodes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == inviteId);
        if (invite?.ImageUrl == null) return NotFound();
        var objectResponse = await _storage.GetObjectAsync(invite.ImageUrl);
        return File(objectResponse.ResponseStream, objectResponse.Headers.ContentType ?? "image/jpeg");
    }

    [AllowAnonymous]
    [HttpGet("avatar/{userId:guid}")]
    public async Task<IActionResult> GetAvatar(Guid userId)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId);
        if (user?.AvatarUrl == null) return NotFound();
        try
        {
            var objectResponse = await _storage.GetObjectAsync(GetAvatarStorageKey(user.AvatarUrl));
            return File(objectResponse.ResponseStream, objectResponse.Headers.ContentType ?? GetAvatarContentType(user.AvatarUrl));
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return NotFound();
        }
    }

    [AllowAnonymous]
    [HttpGet("banner/{userId:guid}")]
    public async Task<IActionResult> GetBanner(Guid userId)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId);
        if (user?.BannerUrl == null) return NotFound();
        try
        {
            var objectResponse = await _storage.GetObjectAsync(user.BannerUrl);
            return File(objectResponse.ResponseStream, objectResponse.Headers.ContentType ?? "image/jpeg");
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return NotFound();
        }
    }

    private Guid? GetUserId()
    {
        var sub = User.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(sub, out var id) ? id : null;
    }

    private static bool IsAllowedFile(IFormFile file)
    {
        var contentType = file.ContentType.ToLowerInvariant();
        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        return contentType.StartsWith("image/") || contentType.StartsWith("audio/") || contentType.StartsWith("video/") ||
            new[] { ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2" }.Contains(extension);
    }

    private static bool IsContentAddressedKey(string storageKey) =>
        storageKey.StartsWith("sha256/", StringComparison.Ordinal);

    private static string FormatBytes(long value)
    {
        if (value < 1024) return $"{value} Б";
        if (value < 1024 * 1024) return $"{value / 1024.0:0.##} КБ";
        if (value < 1024 * 1024 * 1024) return $"{value / (1024.0 * 1024):0.##} МБ";
        return $"{value / (1024.0 * 1024 * 1024):0.##} ГБ";
    }

    private static string GetAvatarStorageKey(string avatarUrl) =>
        avatarUrl.StartsWith(AvatarVideoPrefix, StringComparison.Ordinal)
            ? avatarUrl[AvatarVideoPrefix.Length..]
            : avatarUrl;

    private static string GetAvatarContentType(string avatarUrl) =>
        avatarUrl.StartsWith(AvatarVideoPrefix, StringComparison.Ordinal) ? "video/mp4" : "image/jpeg";

    private string GetPublicOrigin()
    {
        var forwardedProto = Request.Headers["X-Forwarded-Proto"].FirstOrDefault()
            ?.Split(',')[0].Trim();
        var forwardedHost = Request.Headers["X-Forwarded-Host"].FirstOrDefault()
            ?.Split(',')[0].Trim();
        var scheme = forwardedProto is "http" or "https" ? forwardedProto : Request.Scheme;
        var host = string.IsNullOrWhiteSpace(forwardedHost) ? Request.Host.Value : forwardedHost;
        return $"{scheme}://{host}";
    }

    private static bool IsHttpUrl(Uri uri) =>
        uri.Scheme is "http" or "https" &&
        !string.IsNullOrWhiteSpace(uri.Host);

    private static async Task<IPAddress[]> GetPublicAddressesAsync(
        Uri uri,
        CancellationToken cancellationToken)
    {
        IPAddress[] addresses;
        if (IPAddress.TryParse(uri.Host, out var literalAddress))
        {
            addresses = [literalAddress];
        }
        else
        {
            addresses = await Dns.GetHostAddressesAsync(uri.DnsSafeHost, cancellationToken);
        }

        return addresses.Length > 0 && addresses.All(IsPublicAddress)
            ? addresses
            : [];
    }

    private static bool IsPublicAddress(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6)
            return IsPublicAddress(address.MapToIPv4());
        if (IPAddress.IsLoopback(address) ||
            address.Equals(IPAddress.Any) ||
            address.Equals(IPAddress.IPv6Any) ||
            address.IsIPv6LinkLocal ||
            address.IsIPv6SiteLocal ||
            address.IsIPv6Multicast)
            return false;

        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetworkV6)
            return (bytes[0] & 0xE0) == 0x20 &&
                !(bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] == 0x0D && bytes[3] == 0xB8);

        if (address.AddressFamily != AddressFamily.InterNetwork)
            return false;

        var first = bytes[0];
        var second = bytes[1];
        var third = bytes[2];
        return first != 0 &&
            first != 10 &&
            first != 127 &&
            !(first == 100 && second is >= 64 and <= 127) &&
            !(first == 169 && second == 254) &&
            !(first == 172 && second is >= 16 and <= 31) &&
            !(first == 192 && second == 0 && third == 0) &&
            !(first == 192 && second == 88 && third == 99) &&
            !(first == 192 && second == 168) &&
            !(first == 198 && second is 18 or 19) &&
            !(first == 198 && second == 51 && third == 100) &&
            !(first == 203 && second == 0 && third == 113) &&
            first < 224;
    }

    private static string? GetMetaContent(string html, string key)
    {
        foreach (Match tag in Regex.Matches(html, @"<meta\b[^>]*>", RegexOptions.IgnoreCase))
        {
            var attributes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (Match attribute in Regex.Matches(
                         tag.Value,
                         @"([a-z_:][a-z0-9_:.-]*)\s*=\s*(?:""([^""]*)""|'([^']*)'|([^\s>]+))",
                         RegexOptions.IgnoreCase))
            {
                attributes[attribute.Groups[1].Value] =
                    attribute.Groups[2].Success
                        ? attribute.Groups[2].Value
                        : attribute.Groups[3].Success
                            ? attribute.Groups[3].Value
                            : attribute.Groups[4].Value;
            }

            if ((attributes.GetValueOrDefault("property") ?? attributes.GetValueOrDefault("name"))
                ?.Equals(key, StringComparison.OrdinalIgnoreCase) == true &&
                attributes.TryGetValue("content", out var content))
                return WebUtility.HtmlDecode(content);
        }

        return null;
    }

    private static string CleanPreviewText(string? value, int maxLength)
    {
        var clean = Regex.Replace(WebUtility.HtmlDecode(value ?? ""), @"<[^>]*>", "")
            .Replace('\r', ' ')
            .Replace('\n', ' ')
            .Trim();
        return clean.Length <= maxLength ? clean : clean[..maxLength];
    }

    private async Task<Image<Rgba32>?> TryLoadGalleryImageAsync(
        string storageKey,
        CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _storage.GetObjectAsync(storageKey);
            return await Image.LoadAsync<Rgba32>(response.ResponseStream, cancellationToken);
        }
        catch (AmazonS3Exception exception)
        {
            _logger.LogWarning(exception, "Could not load gallery OG image asset {StorageKey}", storageKey);
            return null;
        }
        catch (UnknownImageFormatException exception)
        {
            _logger.LogWarning(exception, "Gallery OG image asset {StorageKey} has an unsupported image format", storageKey);
            return null;
        }
    }

    private static string? GetGalleryAvatarStorageKey(string? avatarUrl)
    {
        if (string.IsNullOrWhiteSpace(avatarUrl) ||
            avatarUrl.StartsWith(AvatarVideoPrefix, StringComparison.Ordinal))
            return null;

        return avatarUrl;
    }

    private static Color TryParseGalleryNicknameColor(string? color)
    {
        if (!string.IsNullOrWhiteSpace(color) &&
            color[0] == '#' &&
            color.Length is 4 or 7 &&
            color[1..].All(Uri.IsHexDigit) &&
            Color.TryParseHex(color, out var parsedColor))
            return parsedColor;

        return Color.FromRgb(139, 92, 246);
    }

    private static void MakeGalleryAvatarCircular(Image<Rgba32> image)
    {
        var center = (image.Width - 1) / 2f;
        var radiusSquared = center * center;
        for (var y = 0; y < image.Height; y++)
        {
            for (var x = 0; x < image.Width; x++)
            {
                var deltaX = x - center;
                var deltaY = y - center;
                if (deltaX * deltaX + deltaY * deltaY > radiusSquared)
                    image[x, y] = new Rgba32(0, 0, 0, 0);
            }
        }
    }

    private static List<string> WrapGalleryTitle(string title, Font font, float maxWidth)
    {
        float Measure(string text) => TextMeasurer.MeasureAdvance(text, new TextOptions(font)).Width;

        var lines = new List<string>();
        var current = string.Empty;
        var truncated = false;
        foreach (var word in title.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = current.Length == 0 ? word : $"{current} {word}";
            if (Measure(candidate) <= maxWidth)
            {
                current = candidate;
                continue;
            }

            if (current.Length > 0)
                lines.Add(current);
            if (lines.Count == 2)
            {
                truncated = true;
                break;
            }
            current = word;
        }

        if (current.Length > 0 && lines.Count < 2)
            lines.Add(current);
        else if (current.Length > 0)
            truncated = true;
        if (lines.Count == 0)
            return new List<string> { "Без названия" };

        if (truncated || Measure(lines[^1]) > maxWidth)
        {
            var last = lines[^1];
            while (last.Length > 1 && Measure(last + "…") > maxWidth)
                last = last[..^1];
            lines[^1] = last.TrimEnd() + "…";
        }

        return lines;
    }

    private static PointF[] ProjectGalleryPlane(
        int planeWidth, int planeHeight,
        float yawDegrees, float pitchDegrees,
        float distance, float focalLength, float scale,
        float centerX, float centerY)
    {
        var yaw = yawDegrees * MathF.PI / 180f;
        var pitch = pitchDegrees * MathF.PI / 180f;
        var cosYaw = MathF.Cos(yaw);
        var sinYaw = MathF.Sin(yaw);
        var cosPitch = MathF.Cos(pitch);
        var sinPitch = MathF.Sin(pitch);

        PointF Project(float u, float v)
        {
            var x = (u - planeWidth / 2f) * scale;
            var y = (v - planeHeight / 2f) * scale;

            var rx = x * cosYaw;
            var rz = -x * sinYaw;
            var ry = y * cosPitch - rz * sinPitch;
            rz = y * sinPitch + rz * cosPitch;
            rz += distance;

            return new PointF(
                centerX + focalLength * rx / rz,
                centerY + focalLength * ry / rz);
        }

        return new[]
        {
            Project(0, 0),
            Project(planeWidth, 0),
            Project(planeWidth, planeHeight),
            Project(0, planeHeight)
        };
    }

    private static double[] SolveHomography(PointF[] destination, PointF[] source)
    {
        var m = new double[8, 9];
        for (var i = 0; i < 4; i++)
        {
            double x = destination[i].X, y = destination[i].Y;
            double u = source[i].X, v = source[i].Y;
            var r0 = i * 2;
            var r1 = r0 + 1;

            m[r0, 0] = x; m[r0, 1] = y; m[r0, 2] = 1;
            m[r0, 6] = -u * x; m[r0, 7] = -u * y; m[r0, 8] = u;

            m[r1, 3] = x; m[r1, 4] = y; m[r1, 5] = 1;
            m[r1, 6] = -v * x; m[r1, 7] = -v * y; m[r1, 8] = v;
        }

        for (var col = 0; col < 8; col++)
        {
            var pivot = col;
            for (var r = col + 1; r < 8; r++)
                if (Math.Abs(m[r, col]) > Math.Abs(m[pivot, col]))
                    pivot = r;

            if (pivot != col)
                for (var c = 0; c < 9; c++)
                    (m[col, c], m[pivot, c]) = (m[pivot, c], m[col, c]);

            var divisor = m[col, col];
            for (var c = col; c < 9; c++)
                m[col, c] /= divisor;

            for (var r = 0; r < 8; r++)
            {
                if (r == col) continue;
                var factor = m[r, col];
                if (factor == 0) continue;
                for (var c = col; c < 9; c++)
                    m[r, c] -= factor * m[col, c];
            }
        }

        var h = new double[9];
        for (var i = 0; i < 8; i++)
            h[i] = m[i, 8];
        h[8] = 1;
        return h;
    }

    private static void DrawGalleryPlane(Image<Rgba32> canvas, Image<Rgba32> plane, PointF[] quad)
    {
        var pw = plane.Width;
        var ph = plane.Height;
        var h = SolveHomography(quad, new[]
        {
            new PointF(0, 0), new PointF(pw, 0), new PointF(pw, ph), new PointF(0, ph)
        });

        var pixels = new Rgba32[pw * ph];
        plane.CopyPixelDataTo(pixels);

        var minX = Math.Max(0, (int)Math.Floor(quad.Min(point => point.X)));
        var maxX = Math.Min(canvas.Width - 1, (int)Math.Ceiling(quad.Max(point => point.X)));
        var minY = Math.Max(0, (int)Math.Floor(quad.Min(point => point.Y)));
        var maxY = Math.Min(canvas.Height - 1, (int)Math.Ceiling(quad.Max(point => point.Y)));
        if (minX > maxX || minY > maxY)
            return;

        const int samples = 2;
        const float invSamples = 1f / (samples * samples);


        (float r, float g, float b, float a) Fetch(int x, int y)
        {
            if (x < 0 || y < 0 || x >= pw || y >= ph)
                return (0f, 0f, 0f, 0f);
            var p = pixels[y * pw + x];
            var a = p.A / 255f;
            return (p.R / 255f * a, p.G / 255f * a, p.B / 255f * a, a);
        }

        canvas.ProcessPixelRows(accessor =>
        {
            for (var y = minY; y <= maxY; y++)
            {
                var row = accessor.GetRowSpan(y);
                for (var x = minX; x <= maxX; x++)
                {
                    float sr = 0f, sg = 0f, sb = 0f, sa = 0f;
                    for (var sy = 0; sy < samples; sy++)
                    {
                        for (var sx = 0; sx < samples; sx++)
                        {
                            var px = x + (sx + 0.5) / samples;
                            var py = y + (sy + 0.5) / samples;
                            var w = h[6] * px + h[7] * py + h[8];
                            if (w <= 0)
                                continue;
                            var u = (h[0] * px + h[1] * py + h[2]) / w - 0.5;
                            var v = (h[3] * px + h[4] * py + h[5]) / w - 0.5;
                            if (u < -1 || v < -1 || u > pw || v > ph)
                                continue;

                            var x0 = (int)Math.Floor(u);
                            var y0 = (int)Math.Floor(v);
                            var fx = (float)(u - x0);
                            var fy = (float)(v - y0);

                            var c00 = Fetch(x0, y0);
                            var c10 = Fetch(x0 + 1, y0);
                            var c01 = Fetch(x0, y0 + 1);
                            var c11 = Fetch(x0 + 1, y0 + 1);
                            var w00 = (1 - fx) * (1 - fy);
                            var w10 = fx * (1 - fy);
                            var w01 = (1 - fx) * fy;
                            var w11 = fx * fy;

                            sr += c00.r * w00 + c10.r * w10 + c01.r * w01 + c11.r * w11;
                            sg += c00.g * w00 + c10.g * w10 + c01.g * w01 + c11.g * w11;
                            sb += c00.b * w00 + c10.b * w10 + c01.b * w01 + c11.b * w11;
                            sa += c00.a * w00 + c10.a * w10 + c01.a * w01 + c11.a * w11;
                        }
                    }

                    sr *= invSamples; sg *= invSamples; sb *= invSamples; sa *= invSamples;
                    if (sa <= 0f)
                        continue;

                    var dst = row[x];
                    var inv = 1f - sa;
                    row[x] = new Rgba32(
                        (byte)Math.Clamp(sr * 255f + dst.R * inv + 0.5f, 0f, 255f),
                        (byte)Math.Clamp(sg * 255f + dst.G * inv + 0.5f, 0f, 255f),
                        (byte)Math.Clamp(sb * 255f + dst.B * inv + 0.5f, 0f, 255f),
                        255);
                }
            }
        });
    }

    private static void ApplyGalleryOgOverlay(Image<Rgba32> image)
    {
        image.ProcessPixelRows(accessor =>
        {
            for (var y = 0; y < image.Height; y++)
            {
                var row = accessor.GetRowSpan(y);
                var lowerGradient = Math.Clamp((y - image.Height * 0.42f) / (image.Height * 0.58f), 0f, 1f);
                var darkness = 0.30f + 0.62f * lowerGradient;
                var opacity = 1f - darkness;
                for (var x = 0; x < image.Width; x++)
                {
                    var pixel = row[x];
                    row[x] = new Rgba32(
                        (byte)(pixel.R * opacity),
                        (byte)(pixel.G * opacity),
                        (byte)(pixel.B * opacity),
                        pixel.A);
                }
            }
        });
    }

    private static void DrawGalleryOgBrand(
        IImageProcessingContext context,
        int canvasWidth,
        Image<Rgba32> icon,
        Font brandFont,
        Font markFont)
    {
        const int iconSize = 56;
        const int gap = 14;
        const int rightPadding = 40;
        const int top = 32;

        const string brandName = "помойка.inc";
        var brandWidth = TextMeasurer.MeasureAdvance(brandName, new TextOptions(brandFont)).Width;
        var markWidth = TextMeasurer.MeasureAdvance("®", new TextOptions(markFont)).Width;
        var contentWidth = iconSize + gap + brandWidth + 2 + markWidth;
        var iconX = canvasWidth - rightPadding - (int)Math.Ceiling(contentWidth);
        var iconY = top;
        var textX = iconX + iconSize + gap;
        var textY = iconY + (iconSize - brandFont.Size) / 2;

        context.DrawImage(icon, new Point(iconX, iconY), 1f);
        context.DrawText(brandName, brandFont, Color.White, new PointF(textX, textY));
        context.DrawText("®", markFont, Color.White,
            new PointF(textX + brandWidth + 2, textY - markFont.Size / 3));
    }

    private static string BuildLibraryStorageKey(Guid userId, Guid? folderId, string fileName) =>
        $"library/{userId:D}/{(folderId.HasValue ? $"folders/{folderId.Value:D}" : "root")}/{Guid.NewGuid():N}_{fileName}";

    private IEnumerable<string> GetDeletableObjectKeys(IEnumerable<FileStorageObject> files)
    {
        foreach (var file in files)
        {
            if (IsContentAddressedKey(file.StorageKey)) continue;
            yield return file.StorageKey;
            if (file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                foreach (var previewKey in _storage.GetImagePreviewObjectKeys(file.StorageKey))
                    yield return previewKey;
            else if (file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                yield return _storage.GetVideoPreviewObjectKey(file.StorageKey);
        }
    }

    private sealed record FileStorageObject(string StorageKey, string ContentType, Guid? FolderId = null);

    private bool CanAccess(FileAccessLevel accessLevel, Guid ownerId)
    {
        if (accessLevel == FileAccessLevel.Public) return true;
        if (accessLevel == FileAccessLevel.Authenticated) return User.Identity?.IsAuthenticated == true;
        return GetUserId() == ownerId;
    }

    private static string BuildDownloadUrl(Guid fileId) => $"/api/files/library/{fileId}/download";

    private static string BuildSha256DownloadUrl(string hash) => $"/api/files/sha256/{hash}/download";

    private string? GetPreviewUrl(string? storageKey, bool isVideo)
    {
        if (string.IsNullOrWhiteSpace(storageKey)) return null;
        var previewKey = isVideo
            ? _storage.GetVideoPreviewObjectKey(storageKey)
            : _storage.GetPreviewObjectKey(storageKey);
        return _storage.GetPublicObjectUrl(previewKey);
    }

    private UserFileDto ToUserFileDto(UserFile file, FileFolder? folder = null) =>
        new(
            file.Id,
            file.FileName ?? string.Empty,
            file.ContentType ?? string.Empty,
            file.SizeBytes,
            file.Width,
            file.Height,
            file.AccessLevel,
            file.FolderId,
            folder?.Name ?? file.Folder?.Name,
            file.UploadedAt,
            BuildDownloadUrl(file.Id),
            (file.ContentType ?? string.Empty).StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                ? GetPreviewUrl(file.StorageKey, isVideo: false)
                : null,
            (file.ContentType ?? string.Empty).StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                ? _storage.GetPublicObjectUrl(_storage.GetIconPreviewObjectKey(file.StorageKey))
                : null);
}
