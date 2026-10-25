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
using Microsoft.AspNetCore.RateLimiting;
using Amazon.S3;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using System.Text;

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
    private readonly OgImageGenerator _ogImageGenerator;
    private readonly AvatarImageOptimizer _avatarImageOptimizer;
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
        OgImageStorageCache ogImageCache,
        OgImageGenerator ogImageGenerator,
        AvatarImageOptimizer avatarImageOptimizer)
    {
        _db = db;
        _storage = storage;
        _contentAddressedPreviewCleanup = contentAddressedPreviewCleanup;
        _imagePreviewBackgroundService = imagePreviewBackgroundService;
        _feedHub = feedHub;
        _logger = logger;
        _ogImageCache = ogImageCache;
        _ogImageGenerator = ogImageGenerator;
        _avatarImageOptimizer = avatarImageOptimizer;
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
    [EnableRateLimiting("catalog-api")]
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
            .Include(x => x.Owner)
            .Where(x => visibleAccessLevels.Contains(x.AccessLevel))
            .OrderByDescending(x => x.UploadedAt)
            .ToListAsync();
        var postFiles = await _db.PostFiles.AsNoTracking()
            .Include(x => x.Post)
                .ThenInclude(x => x!.Author)
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

        var files = userFiles
            .Select(x => ToUserFileDto(x) with { Author = ToFileAuthorDto(x.Owner) })
            .ToList();
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
                : null,
            ToFileAuthorDto(x.Post?.Author))));

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
    [EnableRateLimiting("pinterest-api")]
    public async Task<ActionResult<PinterestMediaPageDto>> GetPinterestMedia(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] int seed = 0,
        [FromQuery] Guid? authorId = null,
        [FromQuery] DateOnly? fromDate = null,
        [FromQuery] DateOnly? toDate = null,
        [FromQuery] string? mediaType = null)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 50);
        var normalizedMediaType = mediaType?.Trim().ToLowerInvariant();
        if (normalizedMediaType is not (null or "" or "image" or "video"))
            return BadRequest(new { message = "Неизвестный тип контента" });
        if (fromDate.HasValue && toDate.HasValue && fromDate > toDate)
            return BadRequest(new { message = "Начальная дата не может быть позже конечной" });

        var visibleAccessLevels = new[] { FileAccessLevel.Public, FileAccessLevel.Authenticated };
        var userFilesQuery = _db.UserFiles.AsNoTracking()
            .Include(x => x.Owner)
            .Where(x => visibleAccessLevels.Contains(x.AccessLevel) &&
                (x.ContentType.StartsWith("image/") || x.ContentType.StartsWith("video/")))
            .AsQueryable();
        if (fromDate.HasValue)
        {
            var from = fromDate.Value.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            userFilesQuery = userFilesQuery.Where(x => x.UploadedAt >= from);
        }
        if (toDate.HasValue && toDate.Value < DateOnly.MaxValue)
        {
            var toExclusive = toDate.Value.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            userFilesQuery = userFilesQuery.Where(x => x.UploadedAt < toExclusive);
        }
        if (normalizedMediaType == "image")
            userFilesQuery = userFilesQuery.Where(x => x.ContentType.StartsWith("image/"));
        else if (normalizedMediaType == "video")
            userFilesQuery = userFilesQuery.Where(x => x.ContentType.StartsWith("video/"));

        var userFiles = await userFilesQuery
            .OrderByDescending(x => x.UploadedAt)
            .ToListAsync();
        var postFilesQuery = _db.PostFiles.AsNoTracking()
            .Include(x => x.Post)
                .ThenInclude(x => x!.Author)
            .Where(x => x.Post != null &&
                (x.Post.AccessLevel == PostAccessLevel.Public ||
                 x.Post.AccessLevel == PostAccessLevel.Authenticated) &&
                (x.ContentType.StartsWith("image/") || x.ContentType.StartsWith("video/")))
            .AsQueryable();
        if (fromDate.HasValue)
        {
            var from = fromDate.Value.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            postFilesQuery = postFilesQuery.Where(x => x.UploadedAt >= from);
        }
        if (toDate.HasValue && toDate.Value < DateOnly.MaxValue)
        {
            var toExclusive = toDate.Value.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            postFilesQuery = postFilesQuery.Where(x => x.UploadedAt < toExclusive);
        }
        if (normalizedMediaType == "image")
            postFilesQuery = postFilesQuery.Where(x => x.ContentType.StartsWith("image/"));
        else if (normalizedMediaType == "video")
            postFilesQuery = postFilesQuery.Where(x => x.ContentType.StartsWith("video/"));

        var postFiles = await postFilesQuery
            .OrderByDescending(x => x.UploadedAt)
            .ToListAsync();
        var authors = userFiles
            .Where(x => x.Owner != null)
            .Select(x => new PinterestAuthorDto(
                x.OwnerId,
                x.Owner!.DisplayName,
                x.Owner.NicknameColor,
                ToFileAuthorDto(x.Owner)!.AvatarUrl))
            .Concat(postFiles
                .Where(x => x.Post?.Author != null)
                .Select(x => new PinterestAuthorDto(
                    x.Post!.AuthorId,
                    x.Post.Author!.DisplayName,
                    x.Post.Author.NicknameColor,
                    ToFileAuthorDto(x.Post.Author)!.AvatarUrl)))
            .DistinctBy(x => x.Id)
            .OrderBy(x => x.DisplayName)
            .ToList();
        var media = userFiles
            .Where(x => !authorId.HasValue || x.OwnerId == authorId.Value)
            .Select(x => new PinterestMediaDto(
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
                    : null,
            x.OwnerId,
            ToFileAuthorDto(x.Owner))).ToList();
        media.AddRange(postFiles
            .Where(x => !authorId.HasValue || x.Post!.AuthorId == authorId.Value)
            .Select(x => new PinterestMediaDto(
                x.Id.ToString(),
                x.FileName,
                x.ContentType,
                null,
                null,
                x.UploadedAt,
                _storage.GetPublicObjectUrl(x.StorageKey),
                x.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                    ? _storage.GetPublicObjectUrl(_storage.GetFeedPreviewObjectKey(x.StorageKey))
                    : _storage.GetPublicObjectUrl(_storage.GetVideoPreviewObjectKey(x.StorageKey)),
                x.Post!.AuthorId,
                ToFileAuthorDto(x.Post.Author))));
        var librarySha256Keys = userFiles
            .Select(x => x.StorageKey)
            .Concat(postFiles.Select(x => x.StorageKey))
            .Where(x => x.StartsWith("sha256/", StringComparison.Ordinal))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var keys = authorId.HasValue
            ? []
            : await _storage.ListObjectKeysAsync("sha256/");
        foreach (var key in keys)
        {
            if (librarySha256Keys.Contains(key)) continue;
            var metadata = await _storage.GetObjectMetadataAsync(key);
            var contentType = metadata.Headers.ContentType ?? string.Empty;
            if (!contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) &&
                !contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                continue;
            if (normalizedMediaType == "image" &&
                !contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                continue;
            if (normalizedMediaType == "video" &&
                !contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                continue;
            if (authorId.HasValue) continue;
            if (fromDate.HasValue &&
                metadata.LastModified < fromDate.Value.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc))
                continue;
            if (toDate.HasValue && toDate.Value < DateOnly.MaxValue &&
                metadata.LastModified >= toDate.Value.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc))
                continue;

            if (contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                _imagePreviewBackgroundService.Enqueue(key, contentType);

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
            (long)orderedMedia.Count > (long)page * pageSize,
            authors));
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

    [HttpPost("library/batch-presign")]
    public async Task<ActionResult<LibraryBatchPresignResponse>> PresignLibraryBatch(
        LibraryBatchPresignRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();
        if (request.Files.Count is < 1 or > 300 || request.Files.Any(file =>
                file.SizeBytes is < 1 or > MaxFileSizeBytes ||
                string.IsNullOrWhiteSpace(file.FileName) ||
                string.IsNullOrWhiteSpace(file.ContentType)))
            return BadRequest(new { message = "Можно подготовить от 1 до 300 файлов размером до 500 МБ" });

        var folder = await GetOwnedFolderAsync(request.FolderId, userId.Value);
        if (request.FolderId.HasValue && folder == null)
            return NotFound(new { message = "Папка не найдена" });

        var requestedBytes = request.Files.Sum(file => file.SizeBytes);
        var quota = await GetAvailableQuotaAsync(userId.Value);
        if (requestedBytes > quota.AvailableBytes)
            return BadRequest(new { message = $"Лимит хранилища превышен. Доступно {FormatBytes(quota.AvailableBytes)}." });

        var uploads = request.Files.Select((file, index) =>
        {
            var storageKey = BuildLibraryStorageKey(userId.Value, request.FolderId, Path.GetFileName(file.FileName));
            return new LibraryPresignedUpload(index, storageKey,
                _storage.GetPresignedUploadUrl(storageKey, file.ContentType));
        }).ToList();
        return Ok(new LibraryBatchPresignResponse(uploads));
    }

    [HttpPost("library/batch-complete")]
    public async Task<ActionResult<List<UserFileDto>>> CompleteLibraryBatch(
        CompleteLibraryBatchUploadRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();
        if (request.Files.Count is < 1 or > 300 || request.Files.Any(file =>
                file.SizeBytes is < 1 or > MaxFileSizeBytes ||
                string.IsNullOrWhiteSpace(file.FileName) ||
                string.IsNullOrWhiteSpace(file.ContentType) ||
                !IsOwnedLibraryStorageKey(file.StorageKey, userId.Value, request.FolderId)))
            return BadRequest(new { message = "Некорректный пакет загрузки" });

        if (request.Files.Select(file => file.StorageKey).Distinct(StringComparer.Ordinal).Count() != request.Files.Count)
            return BadRequest(new { message = "В пакете есть повторяющиеся файлы" });

        var folder = await GetOwnedFolderAsync(request.FolderId, userId.Value);
        if (request.FolderId.HasValue && folder == null)
            return NotFound(new { message = "Папка не найдена" });

        var actualSizes = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var file in request.Files)
        {
            try
            {
                var metadata = await _storage.GetObjectMetadataAsync(file.StorageKey);
                if (!string.Equals(metadata.Headers.ContentType, file.ContentType, StringComparison.OrdinalIgnoreCase))
                    return BadRequest(new { message = $"Тип файла {file.FileName} не совпадает с загрузкой" });
                actualSizes[file.StorageKey] = metadata.Headers.ContentLength;
            }
            catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.NotFound)
            {
                return BadRequest(new { message = $"Файл {file.FileName} не был загружен" });
            }
        }

        var quota = await GetAvailableQuotaAsync(userId.Value);
        var totalBytes = actualSizes.Values.Sum();
        if (totalBytes > quota.AvailableBytes)
            return BadRequest(new { message = $"Лимит хранилища превышен. Доступно {FormatBytes(quota.AvailableBytes)}." });

        var createdFiles = request.Files.Select(file => new UserFile
        {
            OwnerId = userId.Value,
            FolderId = request.FolderId,
            FileName = Path.GetFileName(file.FileName),
            StorageKey = file.StorageKey,
            ContentType = file.ContentType,
            SizeBytes = actualSizes[file.StorageKey],
            Width = file.Width,
            Height = file.Height,
            AccessLevel = folder?.AccessLevel ?? FileAccessLevel.Authenticated
        }).ToList();
        _db.UserFiles.AddRange(createdFiles);
        await _db.SaveChangesAsync();
        if (request.FolderId.HasValue)
            await _ogImageCache.InvalidateAsync(OgImageStorageCache.GalleryKey(request.FolderId.Value));
        foreach (var file in createdFiles.Where(file =>
                     file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ||
                     file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)))
            _imagePreviewBackgroundService.Enqueue(file.StorageKey, file.ContentType);

        return Ok(createdFiles.Select(file => ToUserFileDto(file, folder)).ToList());
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
            if (file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ||
                file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
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
        var folder = await _db.FileFolders.AsNoTracking()
            .Include(x => x.Files)
                .ThenInclude(x => x.Owner)
            .FirstOrDefaultAsync(x => x.Id == folderId);
        if (folder == null || !CanAccess(folder.AccessLevel, folder.OwnerId)) return NotFound();
        var images = folder.Files
            .Where(x => (x.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) || x.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)) && CanAccess(x.AccessLevel, x.OwnerId))
            .OrderBy(x => x.UploadedAt)
            .Select(x => new { x.Id, x.FileName, Url = _storage.GetPublicObjectUrl(x.StorageKey), PreviewUrl = x.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ? _storage.GetPublicObjectUrl(_storage.GetPreviewObjectKey(x.StorageKey)) : x.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase) ? _storage.GetPublicObjectUrl(_storage.GetVideoPreviewObjectKey(x.StorageKey)) : null, x.ContentType, x.Width, x.Height, OwnerId = (Guid?)x.OwnerId, Author = ToFileAuthorDto(x.Owner) })
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

        var pageTitle = $"{title} — Помойка.inc";
        var html = OgImageGenerator.CreateMetadataHtml(
            pageTitle,
            title,
            description,
            canonicalUrl,
            imageUrl,
            "website");
        return Content(html, "text/html; charset=utf-8");
    }

    [HttpGet("link-preview")]
    [EnableRateLimiting("expensive-api")]
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
    public Task<IActionResult> GetGalleryOgImage(Guid folderId) =>
        GetGalleryOgImageAsync(folderId, useWebp: false);

    [AllowAnonymous]
    [HttpGet("gallery/og/{folderId:guid}.webp")]
    public Task<IActionResult> GetGalleryOgImageWebp(Guid folderId) =>
        GetGalleryOgImageAsync(folderId, useWebp: true);

    private async Task<IActionResult> GetGalleryOgImageAsync(Guid folderId, bool useWebp)
    {
        const string cacheControl = "public, max-age=3600";
        var isPublicGallery = await _db.FileFolders.AsNoTracking()
            .AnyAsync(x => x.Id == folderId && x.AccessLevel == FileAccessLevel.Public);
        if (!isPublicGallery)
            return NotFound();

        var cacheKey = OgImageStorageCache.GalleryKey(folderId);
        var responseKey = useWebp ? OgImageStorageCache.GalleryWebpKey(folderId) : cacheKey;
        var cachedImage = await _ogImageCache.TryGetAsync(responseKey, HttpContext.RequestAborted);
        if (cachedImage != null)
        {
            Response.Headers.CacheControl = cacheControl;
            return File(cachedImage, useWebp ? "image/webp" : "image/png");
        }

        var imageBytes = await _ogImageCache.TryGetAsync(cacheKey, HttpContext.RequestAborted);
        if (imageBytes == null)
        {
            var folder = await _db.FileFolders.AsNoTracking()
                .Include(x => x.Files)
                .Include(x => x.Owner)
                .FirstOrDefaultAsync(x => x.Id == folderId && x.AccessLevel == FileAccessLevel.Public);
            if (folder == null)
                return NotFound();

            imageBytes = await _ogImageGenerator.GenerateGalleryAsync(folder, HttpContext.RequestAborted);
            await _ogImageCache.StoreAsync(cacheKey, imageBytes, HttpContext.RequestAborted);
        }
        else if (useWebp)
        {
            await _ogImageCache.StoreAsync(cacheKey, imageBytes, HttpContext.RequestAborted);
        }

        if (useWebp)
        {
            var webpBytes = await _ogImageCache.TryGetAsync(responseKey, HttpContext.RequestAborted)
                ?? throw new InvalidOperationException("Gallery OG WebP cache was not created.");
            Response.Headers.CacheControl = cacheControl;
            return File(webpBytes, "image/webp");
        }

        Response.Headers.CacheControl = cacheControl;
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
    [EnableRateLimiting("expensive-api")]
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
        Response.Headers.CacheControl = "private, no-cache";
        return File(
            objectResponse.ResponseStream,
            objectResponse.Headers.ContentType ?? file.ContentType,
            file.FileName,
            file.UploadedAt,
            new EntityTagHeaderValue($"\"{file.Id:N}\""),
            enableRangeProcessing: true);
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
        Response.Headers.CacheControl = "private, no-cache";
        return File(
            objectResponse.ResponseStream,
            objectResponse.Headers.ContentType ?? file.ContentType,
            file.FileName,
            file.UploadedAt,
            new EntityTagHeaderValue($"\"{file.Id:N}\""),
            enableRangeProcessing: true);
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
        var file = await _db.UserFiles.FirstOrDefaultAsync(x => x.Id == id);
        if (file == null || (file.OwnerId != userId && !User.IsInRole("Admin")))
            return NotFound();
        var folderId = file.FolderId;
        if (!IsContentAddressedKey(file.StorageKey))
        {
            await _storage.DeleteObjectAsync(file.StorageKey);
            if (file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                await _storage.DeleteObjectsAsync(_storage.GetImagePreviewObjectKeys(file.StorageKey));
            else if (file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                await _storage.DeleteObjectsAsync(_storage.GetVideoPreviewObjectKeys(file.StorageKey));
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
                await _storage.DeleteObjectsAsync(_storage.GetVideoPreviewObjectKeys(file.StorageKey));
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
        if (postFile.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ||
            postFile.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
            _imagePreviewBackgroundService.Enqueue(storageKey, postFile.ContentType);

        var isImage = postFile.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase);
        var dto = new PostFileDto
        {
            Id = postFile.Id,
            FileName = postFile.FileName,
            ContentType = postFile.ContentType,
            SizeBytes = postFile.SizeBytes,
            DownloadUrl = isImage
                ? _storage.GetPublicObjectUrl(postFile.StorageKey)
                : $"{Request.Scheme}://{Request.Host}/api/files/post/{postFile.Id}/download",
            PreviewUrl = isImage
                ? _storage.GetPublicObjectUrl(_storage.GetFeedPreviewObjectKey(postFile.StorageKey))
                : postFile.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)
                    ? _storage.GetPublicObjectUrl(_storage.GetVideoPreviewObjectKey(postFile.StorageKey))
                    : string.Empty
        };

        await _feedHub.Clients.Group("feed-global").SendAsync("PostFileAdded", postId, dto);

        return Ok(dto);
    }

    [HttpPost("avatar")]
    [EnableRateLimiting("expensive-api")]
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
        {
            await using var optimizedImage = await _avatarImageOptimizer.OptimizeAsync(stream);
            storageKey = await _storage.UploadDeduplicatedObjectAsync(optimizedImage, "image/webp");
        }
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
    [EnableRateLimiting("expensive-api")]
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
    [EnableRateLimiting("expensive-api")]
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
            Response.Headers.CacheControl = "public, max-age=31536000, immutable";
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
        avatarUrl.StartsWith(AvatarVideoPrefix, StringComparison.Ordinal) ? "video/mp4" : "image/webp";

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

    private static string BuildLibraryStorageKey(Guid userId, Guid? folderId, string fileName) =>
        $"library/{userId:D}/{(folderId.HasValue ? $"folders/{folderId.Value:D}" : "root")}/{Guid.NewGuid():N}_{fileName}";

    private static bool IsOwnedLibraryStorageKey(string storageKey, Guid userId, Guid? folderId)
    {
        var prefix = $"library/{userId:D}/{(folderId.HasValue ? $"folders/{folderId.Value:D}" : "root")}/";
        return storageKey.StartsWith(prefix, StringComparison.Ordinal) &&
            storageKey.Length > prefix.Length &&
            !storageKey[prefix.Length..].Contains('/', StringComparison.Ordinal);
    }

    private async Task<FileFolder?> GetOwnedFolderAsync(Guid? folderId, Guid userId) =>
        folderId.HasValue
            ? await _db.FileFolders.FirstOrDefaultAsync(folder => folder.Id == folderId && folder.OwnerId == userId)
            : null;

    private async Task<(long AvailableBytes, long QuotaBytes, long UsedBytes)> GetAvailableQuotaAsync(Guid userId)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(item => item.Id == userId)
            ?? throw new InvalidOperationException("User not found");
        var settings = await _db.StorageSettings.AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == StorageSettings.SingletonId);
        var quotaBytes = user.StorageQuotaBytes ?? settings?.DefaultUserQuotaBytes ?? new StorageSettings().DefaultUserQuotaBytes;
        var usedBytes = await _db.UserFiles.AsNoTracking()
            .Where(file => file.OwnerId == userId)
            .SumAsync(file => (long?)file.SizeBytes) ?? 0;
        return (Math.Max(0, quotaBytes - usedBytes), quotaBytes, usedBytes);
    }

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
                foreach (var previewKey in _storage.GetVideoPreviewObjectKeys(file.StorageKey))
                    yield return previewKey;
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
            ((file.ContentType ?? string.Empty).StartsWith("image/", StringComparison.OrdinalIgnoreCase) ||
             (file.ContentType ?? string.Empty).StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                ? _storage.GetPublicObjectUrl(_storage.GetIconPreviewObjectKey(file.StorageKey))
                : null);

    private static FileAuthorDto? ToFileAuthorDto(AppUser? user) =>
        user == null
            ? null
            : new FileAuthorDto(
                user.DisplayName,
                user.NicknameColor,
                user.AvatarUrl == null
                    ? null
                    : $"/api/files/avatar/{user.Id}?v={Uri.EscapeDataString(user.AvatarUrl)}");
}
