using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Feed.Api.Data;
using Feed.Api.Hubs;
using Feed.Api.Models;
using Feed.Api.Models.Dto;
using Feed.Api.Services;
using SixLabors.ImageSharp;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;

namespace Feed.Api.Controllers;

[ApiController]
[Route("api/posts")]
[Authorize]
public class PostsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IStorageService _storage;
    private readonly ContentAddressedPreviewCleanupService _contentAddressedPreviewCleanup;
    private readonly ImagePreviewBackgroundService _imagePreviewBackgroundService;
    private readonly IHubContext<FeedHub> _hub;
    private readonly PomoykaService _pomoykaService;
    private readonly OgImageStorageCache _ogImageCache;
    private readonly OgImageGenerator _ogImageGenerator;
    private readonly ILogger<PostsController> _logger;

    public PostsController(
        AppDbContext db,
        IStorageService storage,
        ContentAddressedPreviewCleanupService contentAddressedPreviewCleanup,
        ImagePreviewBackgroundService imagePreviewBackgroundService,
        IHubContext<FeedHub> hub,
        PomoykaService pomoykaService,
        OgImageStorageCache ogImageCache,
        OgImageGenerator ogImageGenerator,
        ILogger<PostsController> logger)
    {
        _db = db;
        _storage = storage;
        _contentAddressedPreviewCleanup = contentAddressedPreviewCleanup;
        _imagePreviewBackgroundService = imagePreviewBackgroundService;
        _hub = hub;
        _pomoykaService = pomoykaService;
        _ogImageCache = ogImageCache;
        _ogImageGenerator = ogImageGenerator;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<List<PostDto>>> GetFeed(
        int page = 1,
        int pageSize = 20)
    {
        if (page < 1)
            page = 1;

        if (pageSize < 1)
            pageSize = 20;
        else
            pageSize = Math.Min(pageSize, 100);

        var pomoyka = await _pomoykaService.GetOrCreateTodaysPomoykaAsync();

        var posts = await _db.Posts
            .AsNoTracking()
            .Where(p => p.PomoykaId == pomoyka.Id && !p.IsPostishka)
            .Include(p => p.Author)
            .Include(p => p.Files)
            .Include(p => p.Blocks)
                .ThenInclude(b => b.File)
            .Include(p => p.Comments)
                .ThenInclude(c => c.Author)
            .Include(p => p.Comments)
                .ThenInclude(c => c.Files)
            .Include(p => p.Likes)
            .AsSplitQuery()
            .OrderByDescending(p => p.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var reactionAvatars = await GetReactionAvatars(posts);
        var result = posts.Select(post => ToDto(post, reactionAvatars)).ToList();

        return Ok(result);
    }

    [HttpGet("postishki")]
    public async Task<ActionResult<List<PostDto>>> GetPostishki(
        int page = 1,
        int pageSize = 20)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var posts = await _db.Posts
            .AsNoTracking()
            .Where(p => p.IsPostishka)
            .Include(p => p.Author)
            .Include(p => p.Files)
            .Include(p => p.Blocks).ThenInclude(b => b.File)
            .Include(p => p.Comments).ThenInclude(c => c.Author)
            .Include(p => p.Comments).ThenInclude(c => c.Files)
            .Include(p => p.Likes)
            .AsSplitQuery()
            .OrderByDescending(p => p.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var reactionAvatars = await GetReactionAvatars(posts);
        return Ok(posts.Select(post => ToDto(post, reactionAvatars)).ToList());
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<PostDto>> GetById(Guid id)
    {
        var post = await QueryPost(id).FirstOrDefaultAsync();
        if (post == null) return NotFound();
        var reactionAvatars = await GetReactionAvatars(new[] { post });
        return Ok(ToDto(post, reactionAvatars));
    }

    [HttpGet("slug/{slug}")]
    public async Task<ActionResult<PostDto>> GetBySlug(string slug)
    {
        var post = await QueryPostBySlug(slug)
            .FirstOrDefaultAsync(p => p.IsPostishka);
        if (post == null) return NotFound();
        var reactionAvatars = await GetReactionAvatars(new[] { post });
        return Ok(ToDto(post, reactionAvatars));
    }

    [AllowAnonymous]
    [HttpGet("public/{id:guid}")]
    public async Task<ActionResult<PostDto>> GetPublicById(Guid id)
    {
        var post = await QueryPost(id)
            .Where(p => p.IsPostishka && p.AccessLevel == PostAccessLevel.Public)
            .FirstOrDefaultAsync();
        if (post == null) return NotFound();
        var reactionAvatars = await GetReactionAvatars(new[] { post });
        return Ok(ToDto(post, reactionAvatars));
    }

    [AllowAnonymous]
    [HttpGet("public/slug/{slug}")]
    public async Task<ActionResult<PostDto>> GetPublicBySlug(string slug)
    {
        var post = await QueryPostBySlug(slug)
            .Where(p => p.IsPostishka && p.AccessLevel == PostAccessLevel.Public)
            .FirstOrDefaultAsync();
        if (post == null) return NotFound();
        var reactionAvatars = await GetReactionAvatars(new[] { post });
        return Ok(ToDto(post, reactionAvatars));
    }

    [AllowAnonymous]
    [HttpGet("public/metadata/{slug}")]
    public async Task<IActionResult> GetPublicMetadata(string slug)
    {
        var post = await _db.Posts
            .AsNoTracking()
            .Where(p => p.Slug == slug && p.IsPostishka && p.AccessLevel == PostAccessLevel.Public)
            .Include(p => p.Author)
            .FirstOrDefaultAsync();
        if (post == null)
            return NotFound();

        var title = string.IsNullOrWhiteSpace(post.Title) ? "Без заголовка" : post.Title.Trim();
        var description = string.IsNullOrWhiteSpace(post.Description)
            ? $"Постишка «{title}» от {post.Author?.DisplayName ?? "Помойка.inc"}."
            : post.Description.Trim();
        var origin = GetPublicOrigin();
        var canonicalUrl = $"{origin}/posts/public/{Uri.EscapeDataString(post.Slug ?? slug)}";
        var imageUrl = $"{origin}/og/{post.Id}.png";

        var pageTitle = $"Помойка.inc | {title}";
        var html = OgImageGenerator.CreateMetadataHtml(
            pageTitle,
            title,
            description,
            canonicalUrl,
            imageUrl,
            "article");
        return Content(html, "text/html; charset=utf-8");
    }

    [HttpGet("{id:guid}/cover")]
    public async Task<IActionResult> GetPostishkaCover(Guid id)
    {
        var coverStorageKey = await _db.Posts
            .AsNoTracking()
            .Where(post => post.Id == id && post.IsPostishka)
            .Select(post => post.OgCoverStorageKey)
            .FirstOrDefaultAsync();
        if (string.IsNullOrWhiteSpace(coverStorageKey))
            return NotFound();

        var cover = await _storage.GetObjectAsync(coverStorageKey);
        Response.Headers.CacheControl = "private, no-cache";
        return File(
            cover.ResponseStream,
            cover.Headers.ContentType ?? "application/octet-stream",
            lastModified: null,
            entityTag: new EntityTagHeaderValue($"\"{coverStorageKey}\""));
    }

    [AllowAnonymous]
    [HttpGet("og/{id:guid}.png")]
    public Task<IActionResult> GetOgImage(Guid id) => GetOgImageAsync(id, useWebp: false);

    [AllowAnonymous]
    [HttpGet("og/{id:guid}.webp")]
    public Task<IActionResult> GetOgImageWebp(Guid id) => GetOgImageAsync(id, useWebp: true);

    private async Task<IActionResult> GetOgImageAsync(Guid id, bool useWebp)
    {
        var post = await QueryPost(id)
            .Where(p => p.IsPostishka)
            .FirstOrDefaultAsync();

        if (post == null ||
            (post.AccessLevel != PostAccessLevel.Public && GetUserId() == null))
            return NotFound();

        var cacheControl = post.AccessLevel == PostAccessLevel.Public
            ? "public, max-age=3600"
            : "private, max-age=3600";
        var cacheKey = OgImageStorageCache.PostKey(id);
        var responseKey = useWebp ? OgImageStorageCache.PostWebpKey(id) : cacheKey;
        var cachedImage = await _ogImageCache.TryGetAsync(responseKey, HttpContext.RequestAborted);
        if (cachedImage != null)
        {
            Response.Headers.CacheControl = cacheControl;
            return File(cachedImage, useWebp ? "image/webp" : "image/png");
        }

        var imageBytes = await _ogImageCache.TryGetAsync(cacheKey, HttpContext.RequestAborted);
        if (imageBytes == null)
        {
            imageBytes = await _ogImageGenerator.GeneratePostAsync(post, HttpContext.RequestAborted);
            await _ogImageCache.StoreAsync(cacheKey, imageBytes, HttpContext.RequestAborted);
        }
        else if (useWebp)
        {
            await _ogImageCache.StoreAsync(cacheKey, imageBytes, HttpContext.RequestAborted);
        }

        if (useWebp)
        {
            var webpBytes = await _ogImageCache.TryGetAsync(responseKey, HttpContext.RequestAborted)
                ?? throw new InvalidOperationException("OG WebP cache was not created.");
            Response.Headers.CacheControl = cacheControl;
            return File(webpBytes, "image/webp");
        }

        Response.Headers.CacheControl = cacheControl;
        return File(imageBytes, "image/png");
    }

    [HttpPost("article")]
    [RequestSizeLimit(500L * 1024 * 1024)]
    public async Task<ActionResult<PostDto>> CreateArticle(
        [FromForm] string title,
        [FromForm] string? description,
        [FromForm] string text,
        [FromForm] PostAccessLevel accessLevel,
        [FromForm] List<IFormFile>? files,
        [FromForm] IFormFile? ogCover)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();
        if (string.IsNullOrWhiteSpace(title) || title.Length > 200) return BadRequest(new { message = "Заголовок обязателен" });
        if (description?.Length > 500) return BadRequest(new { message = "Описание должно быть не длиннее 500 символов" });

        if (string.IsNullOrWhiteSpace(text))
            return BadRequest(new { message = "постишка должна содержать текст" });
        if (ogCover != null && !await IsValidOgCoverAsync(ogCover))
            return BadRequest(new { message = "Обложка должна быть изображением размером до 10 МБ" });

        files ??= new List<IFormFile>();
        if (files.Any(file => file.Length == 0 || file.Length > 500L * 1024 * 1024))
            return BadRequest(new { message = "Файл должен быть размером до 500 МБ" });

        var pomoyka = await _pomoykaService.GetOrCreateTodaysPomoykaAsync();

        var post = new Post 
        { 
            PomoykaId = pomoyka.Id,
            AuthorId = userId.Value, 
            Title = title.Trim(), 
            Slug = await GetUniquePostishkaSlugAsync(title.Trim()),
            Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim(),
            Text = text,
            OgCoverStorageKey = ogCover == null ? null : await UploadOgCoverAsync(ogCover),
            IsPostishka = true,
            AccessLevel = accessLevel == PostAccessLevel.Public
                ? PostAccessLevel.Public
                : PostAccessLevel.Authenticated
        };
        _db.Posts.Add(post);
        await _db.SaveChangesAsync();

        var storedFiles = new List<PostFile>();
        foreach (var file in files)
        {
            await using var stream = file.OpenReadStream();
            var storageKey = await _storage.UploadDeduplicatedObjectAsync(stream, file.ContentType);
            var stored = new PostFile { PostId = post.Id, FileName = Path.GetFileName(file.FileName), StorageKey = storageKey, ContentType = file.ContentType, SizeBytes = file.Length };
            storedFiles.Add(stored);
            _db.PostFiles.Add(stored);
        }
        await _db.SaveChangesAsync();

        foreach (var file in storedFiles.Where(IsPreviewable))
            _imagePreviewBackgroundService.Enqueue(file.StorageKey, file.ContentType);

        var created = await QueryPost(post.Id).FirstAsync();
        var dto = ToDto(created);

        var notification = new Post
        {
            PomoykaId = pomoyka.Id,
            AuthorId = userId.Value,
            Text = $"{created.Author!.DisplayName} сделал постишку «{post.Title}»",
            RelatedPostId = post.Id
        };
        _db.Posts.Add(notification);
        await _db.SaveChangesAsync();

        var notificationDto = ToDto(await QueryPost(notification.Id).FirstAsync());
        await _hub.Clients.Group("feed-global").SendAsync("NewPost", notificationDto);
        return Ok(dto);
    }

    [HttpGet("by-user")]
    public async Task<ActionResult<List<PostDto>>> GetUserPosts([FromQuery] string displayName)
    {
        var posts = await _db.Posts
            .AsNoTracking()
            .Where(p => p.Author != null && p.Author.DisplayName == displayName && p.IsPostishka)
            .Include(p => p.Author)
            .Include(p => p.Files)
            .Include(p => p.Blocks)
                .ThenInclude(b => b.File)
            .Include(p => p.Comments)
                .ThenInclude(c => c.Author)
            .Include(p => p.Comments)
                .ThenInclude(c => c.Files)
            .Include(p => p.Likes)
            .AsSplitQuery()
            .OrderByDescending(p => p.CreatedAt)
            .ToListAsync();

        return Ok(posts.Select(post => ToDto(post)).ToList());
    }

    [HttpPost]
    public async Task<ActionResult<PostDto>> Create(
        [FromBody] CreatePostRequest request)
    {
        var userId = GetUserId();

        if (userId == null)
        {
            return Unauthorized(new
            {
                message = "User ID was not found in authentication claims."
            });
        }

        var pomoyka = await _pomoykaService.GetOrCreateTodaysPomoykaAsync();

        var post = new Post
        {
            PomoykaId = pomoyka.Id,
            AuthorId = userId.Value,
            Text = request.Text
        };

        _db.Posts.Add(post);

        await _db.SaveChangesAsync();

        var createdPost = await _db.Posts
            .AsNoTracking()
            .Include(p => p.Author)
            .Include(p => p.Files)
            .Include(p => p.Comments)
                .ThenInclude(c => c.Author)
            .FirstOrDefaultAsync(p => p.Id == post.Id);

        if (createdPost == null)
        {
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new { message = "Failed to load created post." });
        }

        var dto = ToDto(createdPost);

        await _hub.Clients
            .Group("feed-global")
            .SendAsync("NewPost", dto);

        return Ok(dto);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var userId = GetUserId();

        if (userId == null)
        {
            return Unauthorized();
        }

        var post = await _db.Posts
            .Include(p => p.Files)
            .Include(p => p.Comments)
                .ThenInclude(comment => comment.Files)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (post == null)
        {
            return NotFound();
        }

        if (post.AuthorId != userId.Value && !User.IsInRole("Admin"))
        {
            return Forbid();
        }

        foreach (var file in post.Files)
        {
            if (!file.StorageKey.StartsWith("sha256/", StringComparison.Ordinal))
                await _storage.DeleteObjectAsync(file.StorageKey);
        }

        var deletedFiles = post.Files
            .Select(file => (file.StorageKey, file.ContentType))
            .Concat(post.Comments.SelectMany(comment => comment.Files)
                .Select(file => (file.StorageKey, file.ContentType)))
            .ToArray();
        _db.Posts.Remove(post);

        await _db.SaveChangesAsync();
        await _contentAddressedPreviewCleanup.DeleteUnusedPreviewsAsync(deletedFiles);
        await _ogImageCache.InvalidateAsync(OgImageStorageCache.PostKey(id));

        await _hub.Clients
            .Group("feed-global")
            .SendAsync("PostDeleted", id);

        return NoContent();
    }

    [HttpPut("{id:guid}/article")]
    [RequestSizeLimit(500L * 1024 * 1024)]
    public async Task<ActionResult<PostDto>> UpdateArticle(
        Guid id,
        [FromForm] string title,
        [FromForm] string? description,
        [FromForm] string text,
        [FromForm] PostAccessLevel accessLevel,
        [FromForm] List<IFormFile>? files,
        [FromForm] IFormFile? ogCover,
        [FromForm] bool removeOgCover = false)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();
        if (string.IsNullOrWhiteSpace(title) || title.Length > 200)
            return BadRequest(new { message = "Заголовок обязателен" });
        if (description?.Length > 500)
            return BadRequest(new { message = "Описание должно быть не длиннее 500 символов" });
        if (string.IsNullOrWhiteSpace(text))
            return BadRequest(new { message = "Постишка должна содержать текст" });
        if (ogCover != null && !await IsValidOgCoverAsync(ogCover))
            return BadRequest(new { message = "Обложка должна быть изображением размером до 10 МБ" });

        var post = await _db.Posts
            .Include(p => p.Files)
            .FirstOrDefaultAsync(p => p.Id == id && p.IsPostishka);
        if (post == null) return NotFound();
        if (post.AuthorId != userId.Value && !User.IsInRole("Admin"))
            return Forbid();

        var keptFileIds = Regex.Matches(text, "data-file-id=[\\\"'](?<id>[0-9a-fA-F-]{36})[\\\"']")
            .Select(match => match.Groups["id"].Value)
            .Select(value => Guid.TryParse(value, out var fileId) ? (Guid?)fileId : null)
            .Where(fileId => fileId.HasValue)
            .Select(fileId => fileId!.Value)
            .ToHashSet();

        var deletedFiles = post.Files.Where(file => !keptFileIds.Contains(file.Id)).ToList();
        foreach (var file in deletedFiles)
        {
            if (!file.StorageKey.StartsWith("sha256/", StringComparison.Ordinal))
                await _storage.DeleteObjectAsync(file.StorageKey);
            _db.PostFiles.Remove(file);
        }

        files ??= new List<IFormFile>();
        if (files.Any(file => file.Length == 0 || file.Length > 500L * 1024 * 1024))
            return BadRequest(new { message = "Файл должен быть размером до 500 МБ" });

        var uploadedFiles = new List<PostFile>();
        foreach (var file in files)
        {
            await using var stream = file.OpenReadStream();
            var storageKey = await _storage.UploadDeduplicatedObjectAsync(stream, file.ContentType);
            var stored = new PostFile
            {
                PostId = post.Id,
                FileName = Path.GetFileName(file.FileName),
                StorageKey = storageKey,
                ContentType = file.ContentType,
                SizeBytes = file.Length
            };
            uploadedFiles.Add(stored);
            _db.PostFiles.Add(stored);
        }

        var updatedText = Regex.Replace(text, "data-file-index=[\\\"'](?<index>\\d+)[\\\"']", match =>
        {
            var index = int.Parse(match.Groups["index"].Value);
            return index < uploadedFiles.Count
                ? $"data-file-id=\"{uploadedFiles[index].Id}\""
                : match.Value;
        });

        post.Title = title.Trim();
        post.Slug = await GetUniquePostishkaSlugAsync(title.Trim(), post.Id);
        post.Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        post.Text = updatedText;
        if (ogCover != null)
            post.OgCoverStorageKey = await UploadOgCoverAsync(ogCover);
        else if (removeOgCover)
            post.OgCoverStorageKey = null;
        post.AccessLevel = accessLevel == PostAccessLevel.Public
            ? PostAccessLevel.Public
            : PostAccessLevel.Authenticated;
        await _db.SaveChangesAsync();
        await _contentAddressedPreviewCleanup.DeleteUnusedPreviewsAsync(
            deletedFiles.Select(file => (file.StorageKey, file.ContentType)));
        await _ogImageCache.InvalidateAsync(OgImageStorageCache.PostKey(post.Id));

        foreach (var file in uploadedFiles.Where(IsPreviewable))
            _imagePreviewBackgroundService.Enqueue(file.StorageKey, file.ContentType);

        var updated = await QueryPost(post.Id).FirstAsync();
        return Ok(ToDto(updated));
    }

    private Guid? GetUserId()
    {
        var value = User.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (Guid.TryParse(value, out var userId))
        {
            return userId;
        }

        return null;
    }

    private static async Task<bool> IsValidOgCoverAsync(IFormFile file)
    {
        if (file.Length == 0 ||
            file.Length > 10L * 1024 * 1024 ||
            !file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return false;

        try
        {
            await using var stream = file.OpenReadStream();
            var imageInfo = await Image.IdentifyAsync(stream);
            return imageInfo.Width <= 12_000 &&
                imageInfo.Height <= 12_000 &&
                (long)imageInfo.Width * imageInfo.Height <= 40_000_000;
        }
        catch (UnknownImageFormatException)
        {
            return false;
        }
        catch (InvalidImageContentException)
        {
            return false;
        }
    }

    private async Task<string> UploadOgCoverAsync(IFormFile file)
    {
        await using var stream = file.OpenReadStream();
        return await _storage.UploadDeduplicatedObjectAsync(stream, file.ContentType);
    }

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

    private async Task<string> GetUniquePostishkaSlugAsync(
        string title,
        Guid? excludedPostId = null)
    {
        var baseSlug = PostishkaSlug.FromTitle(title);
        var candidate = baseSlug;
        var suffix = 2;
        var existingPostishki = _db.Posts.Where(post => post.IsPostishka);
        if (excludedPostId.HasValue)
            existingPostishki = existingPostishki.Where(post => post.Id != excludedPostId.Value);

        while (await existingPostishki.AnyAsync(post => post.Slug == candidate))
        {
            candidate = $"{baseSlug}-{suffix++}";
        }

        return candidate;
    }

    private async Task<Dictionary<Guid, string?>> GetReactionAvatars(IEnumerable<Post> posts)
    {
        var userIds = posts
            .SelectMany(post =>
                ReadReactions(post.ReactionData)
                    .Concat(post.Comments.SelectMany(comment => ReadReactions(comment.ReactionData))))
            .Select(reaction => reaction.UserId)
            .Distinct()
            .ToList();

        return await _db.Users
            .Where(user => userIds.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, user => user.AvatarUrl);
    }

    private PostDto ToDto(Post post, IReadOnlyDictionary<Guid, string?>? reactionAvatars = null)
    {
        return new PostDto
        {
            Id = post.Id,
            Text = post.Text,
            Title = post.Title,
            Description = post.Description,
            HasOgCover = !string.IsNullOrWhiteSpace(post.OgCoverStorageKey),
            Slug = post.Slug,
            IsArticle = !string.IsNullOrWhiteSpace(post.Title),
            IsPostishka = post.IsPostishka,
            AccessLevel = post.AccessLevel,
            RelatedPostId = post.RelatedPostId,
            CreatedAt = post.CreatedAt,

            Blocks = post.Blocks.OrderBy(b => b.SortOrder).Select(b => new PostBlockDto
            {
                Id = b.Id,
                SortOrder = b.SortOrder,
                Type = b.Type,
                Text = b.Text,
                File = b.File == null ? null : ToFileDto(b.File)
            }).ToList(),

            Author = new UserDto
            {
                Id = post.Author!.Id,
                Email = post.Author.Email ?? string.Empty,
                DisplayName = post.Author.DisplayName,
                NicknameColor = string.IsNullOrWhiteSpace(post.Author.NicknameColor) ? "#4f46e5" : post.Author.NicknameColor,
                AvatarUrl = post.Author.AvatarUrl == null ? null : $"/api/files/avatar/{post.Author.Id}?v={Uri.EscapeDataString(post.Author.AvatarUrl)}"
            },

            Files = post.Files
                .Select(ToFileDto)
                .ToList(),

            Comments = post.Comments
                .OrderBy(c => c.CreatedAt)
                .Select(c => new CommentDto
                {
                    Id = c.Id,
                    Text = c.Text,
                    CreatedAt = c.CreatedAt,
                    Author = new UserDto
                    {
                        Id = c.Author!.Id,
                        Email = c.Author.Email ?? string.Empty,
                        DisplayName = c.Author.DisplayName,
                        NicknameColor = string.IsNullOrWhiteSpace(c.Author.NicknameColor) ? "#4f46e5" : c.Author.NicknameColor,
                        AvatarUrl = c.Author.AvatarUrl == null ? null : $"/api/files/avatar/{c.Author.Id}?v={Uri.EscapeDataString(c.Author.AvatarUrl)}"
                    },
                    Files = c.Files.Select(ToCommentFileDto).ToList(),
                    ReactionCounts = ReadReactions(c.ReactionData)
                        .GroupBy(reaction => reaction.Emoji)
                        .ToDictionary(group => group.Key, group => group.Count()),
                    Reactions = ReadReactions(c.ReactionData)
                        .Select(reaction => ToCommentReactionDto(reaction, reactionAvatars))
                        .ToList()
                })
                .ToList(),
            LikeCount = post.Likes.Count,
                IsLiked = post.Likes.Any(l => l.UserId == GetUserId()),
                ReactionCounts = ReadReactions(post.ReactionData)
                .GroupBy(r => r.Emoji)
                .ToDictionary(group => group.Key, group => group.Count()),
            Reactions = ReadReactions(post.ReactionData).Select(r => new PostReactionDto
            {
                Emoji = r.Emoji,
                User = new UserDto
                {
                    Id = r.UserId,
                    Email = string.Empty,
                    DisplayName = r.DisplayName,
                    NicknameColor = "#4f46e5",
                    AvatarUrl = reactionAvatars != null && reactionAvatars.TryGetValue(r.UserId, out var avatarUrl) && avatarUrl != null
                        ? $"/api/files/avatar/{r.UserId}?v={Uri.EscapeDataString(avatarUrl)}"
                        : null
                }
            }).ToList()
        };
    }

    private static List<PostReactionEntry> ReadReactions(string? data)
    {
        try { return JsonSerializer.Deserialize<List<PostReactionEntry>>(data ?? "[]") ?? new(); }
        catch (JsonException) { return new(); }
    }

    private static bool IsPreviewable(PostFile file) =>
        file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ||
        file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase);

    private static PostReactionDto ToCommentReactionDto(
        PostReactionEntry reaction,
        IReadOnlyDictionary<Guid, string?>? reactionAvatars) => new()
    {
        Emoji = reaction.Emoji,
        User = new UserDto
        {
            Id = reaction.UserId,
            Email = string.Empty,
            DisplayName = reaction.DisplayName,
            NicknameColor = string.IsNullOrWhiteSpace(reaction.NicknameColor) ? "#4f46e5" : reaction.NicknameColor,
            AvatarUrl = reactionAvatars != null &&
                reactionAvatars.TryGetValue(reaction.UserId, out var avatarUrl) &&
                avatarUrl != null
                    ? $"/api/files/avatar/{reaction.UserId}?v={Uri.EscapeDataString(avatarUrl)}"
                    : null
        }
    };

    private PostFileDto ToFileDto(PostFile file)
    {
        var isImage = file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase);
        return new PostFileDto
        {
            Id = file.Id,
            FileName = file.FileName,
            ContentType = file.ContentType,
            SizeBytes = file.SizeBytes,
            DownloadUrl = isImage
                ? _storage.GetPublicObjectUrl(file.StorageKey)
                : $"{Request.Scheme}://{Request.Host}/api/files/post/{file.Id}/download",
            PreviewUrl = isImage
                ? _storage.GetPublicObjectUrl(_storage.GetFeedPreviewObjectKey(file.StorageKey))
                : file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)
                    ? _storage.GetPublicObjectUrl(_storage.GetVideoPreviewObjectKey(file.StorageKey))
                    : string.Empty
        };
    }

    private PostFileDto ToCommentFileDto(CommentFile file)
    {
        var isImage = file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase);
        return new PostFileDto
        {
            Id = file.Id,
            FileName = file.FileName,
            ContentType = file.ContentType,
            SizeBytes = file.SizeBytes,
            DownloadUrl = isImage
                ? _storage.GetPublicObjectUrl(file.StorageKey)
                : $"{Request.Scheme}://{Request.Host}/api/files/comment/{file.Id}/download",
            PreviewUrl = isImage
                ? _storage.GetPublicObjectUrl(_storage.GetPreviewObjectKey(file.StorageKey))
                : string.Empty
        };
    }

    private IQueryable<Post> QueryPost(Guid id) => _db.Posts
        .AsNoTracking()
        .Where(p => p.Id == id)
        .Include(p => p.Author)
        .Include(p => p.Files)
        .Include(p => p.Blocks).ThenInclude(b => b.File)
        .Include(p => p.Comments).ThenInclude(c => c.Author)
        .Include(p => p.Comments).ThenInclude(c => c.Files)
        .Include(p => p.Likes)
        .AsSplitQuery();

    private IQueryable<Post> QueryPostBySlug(string slug) => _db.Posts
        .AsNoTracking()
        .Where(p => p.Slug == slug)
        .Include(p => p.Author)
        .Include(p => p.Files)
        .Include(p => p.Blocks).ThenInclude(b => b.File)
        .Include(p => p.Comments).ThenInclude(c => c.Author)
        .Include(p => p.Comments).ThenInclude(c => c.Files)
        .Include(p => p.Likes)
        .AsSplitQuery();
}
