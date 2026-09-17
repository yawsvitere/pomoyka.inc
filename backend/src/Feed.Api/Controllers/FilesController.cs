using System.Security.Claims;
using Feed.Api.Data;
using Feed.Api.Hubs;
using Feed.Api.Models;
using Feed.Api.Models.Dto;
using Feed.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;
using SixLabors.ImageSharp;

namespace Feed.Api.Controllers;

[ApiController]
[Route("api/files")]
[Authorize]
public class FilesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IStorageService _storage;
    private readonly IHubContext<FeedHub> _feedHub;

    private const long MaxFileSizeBytes = 500L * 1024 * 1024;
    private const long MaxAvatarSizeBytes = 5L * 1024 * 1024;
    private const long MaxBannerSizeBytes = 10L * 1024 * 1024;
    private const long MaxPostFileSizeBytes = 500L * 1024 * 1024;
    private const string AvatarVideoPrefix = "avatar-video/";

    public FilesController(
        AppDbContext db,
        IStorageService storage,
        IHubContext<FeedHub> feedHub)
    {
        _db = db;
        _storage = storage;
        _feedHub = feedHub;
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
    public async Task<ActionResult<IEnumerable<PinterestMediaDto>>> GetPinterestMedia()
    {
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

        return Ok(media.OrderByDescending(x => x.UploadedAt));
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
        if (width is null && height is null && file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            using var image = await Image.LoadAsync(stream);
            width = image.Width;
            height = image.Height;
            stream.Position = 0;
        }
        var storageKey = BuildLibraryStorageKey(userId.Value, folderId, fileName);
        await _storage.UploadObjectAsync(storageKey, stream, file.ContentType);
        if (file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            await _storage.CreateImagePreviewAsync(storageKey, file.ContentType);
        else if (file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
            await _storage.CreateVideoPreviewAsync(storageKey, file.ContentType);
        var userFile = new UserFile { OwnerId = userId.Value, FolderId = folderId, FileName = fileName, StorageKey = storageKey, ContentType = file.ContentType, SizeBytes = file.Length, Width = width, Height = height, AccessLevel = folder?.AccessLevel ?? FileAccessLevel.Authenticated };
        _db.UserFiles.Add(userFile);
        await _db.SaveChangesAsync();
        return Ok(ToUserFileDto(userFile, folder));
    }

    [HttpDelete("folders/{id:guid}")]
    public async Task<IActionResult> DeleteFolder(Guid id)
    {
        var userId = GetUserId();
        var folder = await _db.FileFolders.Include(x => x.Files)
            .FirstOrDefaultAsync(x => x.Id == id && x.OwnerId == userId);
        if (folder == null) return NotFound();

        foreach (var file in folder.Files)
        {
            if (!IsContentAddressedKey(file.StorageKey))
            {
                await _storage.DeleteObjectAsync(file.StorageKey);
                if (file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                    await _storage.DeleteObjectAsync(_storage.GetPreviewObjectKey(file.StorageKey));
                else if (file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                    await _storage.DeleteObjectAsync(_storage.GetVideoPreviewObjectKey(file.StorageKey));
            }
        }

        _db.UserFiles.RemoveRange(folder.Files);
        _db.FileFolders.Remove(folder);
        await _db.SaveChangesAsync();
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
        return Ok(ToUserFileDto(file));
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
            var destinationKey = BuildLibraryStorageKey(userId!.Value, request.FolderId, file.FileName);
            await _storage.CopyObjectAsync(file.StorageKey, destinationKey);
            if (file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            {
                await _storage.CreateImagePreviewAsync(file.StorageKey, file.ContentType);
                await _storage.CopyObjectAsync(_storage.GetPreviewObjectKey(file.StorageKey), _storage.GetPreviewObjectKey(destinationKey));
            }
            else if (file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
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
        }

        return Ok(ToUserFileDto(file, targetFolder));
    }

    [HttpPatch("folders/{id:guid}/visibility")]
    public async Task<IActionResult> UpdateFolderVisibility(Guid id, UpdateFolderVisibilityRequest request)
    {
        var userId = GetUserId();
        var folder = await _db.FileFolders.Include(x => x.Files).FirstOrDefaultAsync(x => x.Id == id && x.OwnerId == userId);
        if (folder == null) return NotFound();
        folder.AccessLevel = request.AccessLevel;
        foreach (var file in folder.Files) file.AccessLevel = request.AccessLevel;
        await _db.SaveChangesAsync();
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
        return Ok(new FileFolderDto(folder.Id, folder.Name, folder.AccessLevel, folder.Files.Count, folder.CreatedAt, $"/files/gallery/{folder.Id}"));
    }

    [AllowAnonymous]
    [HttpGet("gallery/{folderId:guid}")]
    public async Task<ActionResult<object>> GetGallery(Guid folderId)
    {
        var folder = await _db.FileFolders.AsNoTracking().Include(x => x.Files).FirstOrDefaultAsync(x => x.Id == folderId);
        if (folder == null || !CanAccess(folder.AccessLevel, folder.OwnerId)) return NotFound();
        var images = folder.Files.Where(x => (x.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) || x.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)) && CanAccess(x.AccessLevel, x.OwnerId)).Select(x => new { x.Id, x.FileName, Url = _storage.GetPublicObjectUrl(x.StorageKey), PreviewUrl = x.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ? _storage.GetPublicObjectUrl(_storage.GetPreviewObjectKey(x.StorageKey)) : x.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase) ? _storage.GetPublicObjectUrl(_storage.GetVideoPreviewObjectKey(x.StorageKey)) : null, x.ContentType, x.Width, x.Height }).ToList();
        return Ok(new { folder.Name, images });
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
        if (!IsContentAddressedKey(file.StorageKey))
        {
            await _storage.DeleteObjectAsync(file.StorageKey);
            if (file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                await _storage.DeleteObjectAsync(_storage.GetPreviewObjectKey(file.StorageKey));
            else if (file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                await _storage.DeleteObjectAsync(_storage.GetVideoPreviewObjectKey(file.StorageKey));
        }
        _db.UserFiles.Remove(file);
        await _db.SaveChangesAsync();
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
                await _storage.DeleteObjectAsync(_storage.GetPreviewObjectKey(file.StorageKey));
            else if (file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                await _storage.DeleteObjectAsync(_storage.GetVideoPreviewObjectKey(file.StorageKey));
        }
        _db.PostFiles.Remove(file);
        await _db.SaveChangesAsync();

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
        await _storage.CreateImagePreviewAsync(storageKey, file.ContentType);
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

        var dto = new PostFileDto
        {
            Id = postFile.Id,
            FileName = postFile.FileName,
            ContentType = postFile.ContentType,
            SizeBytes = postFile.SizeBytes,
            DownloadUrl = $"{Request.Scheme}://{Request.Host}/api/files/post/{postFile.Id}/download",
            PreviewUrl = postFile.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                ? _storage.GetPublicObjectUrl(_storage.GetPreviewObjectKey(postFile.StorageKey))
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
        if (user.AvatarUrl != null)
            await _storage.DeleteObjectAsync(GetAvatarStorageKey(user.AvatarUrl));
        user.AvatarUrl = storageKey;
        await _db.SaveChangesAsync();
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

    [AllowAnonymous]
    [HttpGet("avatar/{userId:guid}")]
    public async Task<IActionResult> GetAvatar(Guid userId)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId);
        if (user?.AvatarUrl == null) return NotFound();
        var objectResponse = await _storage.GetObjectAsync(GetAvatarStorageKey(user.AvatarUrl));
        return File(objectResponse.ResponseStream, objectResponse.Headers.ContentType ?? GetAvatarContentType(user.AvatarUrl));
    }

    [AllowAnonymous]
    [HttpGet("banner/{userId:guid}")]
    public async Task<IActionResult> GetBanner(Guid userId)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId);
        if (user?.BannerUrl == null) return NotFound();
        var objectResponse = await _storage.GetObjectAsync(user.BannerUrl);
        return File(objectResponse.ResponseStream, objectResponse.Headers.ContentType ?? "image/jpeg");
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

    private static string BuildLibraryStorageKey(Guid userId, Guid? folderId, string fileName) =>
        $"library/{userId:D}/{(folderId.HasValue ? $"folders/{folderId.Value:D}" : "root")}/{Guid.NewGuid():N}_{fileName}";

    private bool CanAccess(FileAccessLevel accessLevel, Guid ownerId)
    {
        if (accessLevel == FileAccessLevel.Public) return true;
        if (accessLevel == FileAccessLevel.Authenticated) return User.Identity?.IsAuthenticated == true;
        return GetUserId() == ownerId;
    }

    private static string BuildDownloadUrl(Guid fileId) => $"/api/files/library/{fileId}/download";

    private static string BuildSha256DownloadUrl(string hash) => $"/api/files/sha256/{hash}/download";

    private UserFileDto ToUserFileDto(UserFile file, FileFolder? folder = null) =>
        new(file.Id, file.FileName, file.ContentType, file.SizeBytes, file.Width, file.Height, file.AccessLevel, file.FolderId, folder?.Name ?? file.Folder?.Name, file.UploadedAt, BuildDownloadUrl(file.Id), file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ? _storage.GetPublicObjectUrl(_storage.GetPreviewObjectKey(file.StorageKey)) : null);
}