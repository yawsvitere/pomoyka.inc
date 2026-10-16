using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using Feed.Api.Data;
using SixLabors.Fonts;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Drawing.Processing;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;
using System.Globalization;
using Feed.Api.Hubs;
using Feed.Api.Models;
using Feed.Api.Models.Dto;
using Feed.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

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
    private readonly ILogger<PostsController> _logger;

    public PostsController(
        AppDbContext db,
        IStorageService storage,
        ContentAddressedPreviewCleanupService contentAddressedPreviewCleanup,
        ImagePreviewBackgroundService imagePreviewBackgroundService,
        IHubContext<FeedHub> hub,
        PomoykaService pomoykaService,
        OgImageStorageCache ogImageCache,
        ILogger<PostsController> logger)
    {
        _db = db;
        _storage = storage;
        _contentAddressedPreviewCleanup = contentAddressedPreviewCleanup;
        _imagePreviewBackgroundService = imagePreviewBackgroundService;
        _hub = hub;
        _pomoykaService = pomoykaService;
        _ogImageCache = ogImageCache;
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

        static string Encode(string value) => HtmlEncoder.Default.Encode(value);

        var html = $"""
            <!doctype html>
            <html lang="ru">
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>{Encode($"Помойка.inc | {title}")}</title>
                <meta name="description" content="{Encode(description)}">
                <meta property="og:site_name" content="Помойка.inc">
                <meta property="og:type" content="article">
                <meta property="og:title" content="{Encode($"Помойка.inc | {title}")}">
                <meta property="og:description" content="{Encode(description)}">
                <meta property="og:url" content="{Encode(canonicalUrl)}">
                <meta property="og:image" content="{Encode(imageUrl)}">
                <meta property="og:image:width" content="1200">
                <meta property="og:image:height" content="630">
                <meta name="twitter:card" content="summary_large_image">
                <meta name="twitter:title" content="{Encode($"Помойка.inc | {title}")}">
                <meta name="twitter:description" content="{Encode(description)}">
                <meta name="twitter:image" content="{Encode(imageUrl)}">
              </head>
              <body><h1>{Encode(title)}</h1><p>{Encode(description)}</p></body>
            </html>
            """;

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
        return File(cover.ResponseStream, cover.Headers.ContentType ?? "application/octet-stream");
    }

    [AllowAnonymous]
    [HttpGet("og/{id:guid}.png")]
    public async Task<IActionResult> GetOgImage(Guid id)
    {
        var post = await QueryPost(id)
            .Where(p => p.IsPostishka)
            .FirstOrDefaultAsync();

        if (post == null ||
            (post.AccessLevel != PostAccessLevel.Public && GetUserId() == null))
            return NotFound();

        var cachedImage = await _ogImageCache.TryGetAsync(OgImageStorageCache.PostKey(id), HttpContext.RequestAborted);
        if (cachedImage != null)
        {
            Response.Headers.CacheControl = "no-cache";
            return File(cachedImage, "image/png");
        }

        const int width = 1200;
        const int height = 630;
        const int left = 64;
        const int bottomPadding = 56;
        const int avatarSize = 52;
        const float maxTextWidth = width - left * 2 - 80;

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
        var dateFont = boldFamily.CreateFont(24, FontStyle.Bold);
        var titleFont = boldFamily.CreateFont(68, FontStyle.Bold);
        var descriptionFont = boldFamily.CreateFont(30, FontStyle.Bold);
        var authorFont = boldFamily.CreateFont(28, FontStyle.Bold);
        var brandFont = boldFamily.CreateFont(30, FontStyle.Bold);
        var brandMarkFont = boldFamily.CreateFont(18, FontStyle.Bold);
        using var brandIcon = await Image.LoadAsync<Rgba32>(brandIconPath);
        brandIcon.Mutate(context => context.Resize(new Size(56, 56)));

        using var canvas = new Image<Rgba32>(width, height);
        canvas.Mutate(context => context.Fill(Color.FromRgb(24, 24, 24)));

        var backgroundKey = post.OgCoverStorageKey ?? ResolveOgBackgroundKey(post);
        if (backgroundKey != null)
        {
            using var background = await TryLoadImageAsync(backgroundKey);
            if (background != null)
            {
                background.Mutate(context => context.Resize(new ResizeOptions
                {
                    Size = new Size(width, height),
                    Mode = ResizeMode.Crop,
                    Position = AnchorPositionMode.Center
                }));
                canvas.Mutate(context => context.DrawImage(background, new Point(0, 0), 1f));
            }
        }

        ApplyOgOverlay(canvas);

        var postTitle = string.IsNullOrWhiteSpace(post.Title) ? "Без заголовка" : post.Title.Trim();
        var description = string.IsNullOrWhiteSpace(post.Description)
            ? "Новая публикация в коллекции постишек."
            : post.Description.Trim();
        var authorName = post.Author?.DisplayName ?? "Помойка.inc";
        var dateText = FormatRussianDate(post.CreatedAt);
        var nicknameColor = TryParseNicknameColor(post.Author?.NicknameColor);
        var titleLines = WrapTextByWidth(postTitle, titleFont, maxTextWidth, 2);
        var descriptionLines = WrapTextByWidth(description, descriptionFont, maxTextWidth, 2);

        // Вёрстка снизу вверх: автор -> описание -> заголовок -> дата.
        const int titleLineHeight = 76;
        const int descriptionLineHeight = 40;
        var avatarY = height - bottomPadding - avatarSize;
        var descriptionBottom = avatarY - 28;
        var descriptionTop = descriptionBottom - descriptionLines.Count * descriptionLineHeight;
        var titleBottom = descriptionTop - 10;
        var titleTop = titleBottom - titleLines.Count * titleLineHeight;
        var dateY = titleTop - 44;

        canvas.Mutate(context =>
        {
            DrawOgBrand(context, width, brandIcon, brandFont, brandMarkFont);

            // акцентная полоска в цвете ника + дата
            context.Fill(nicknameColor, new SixLabors.ImageSharp.Drawing.RectangularPolygon(left, dateY + 3, 6, 28));
            context.DrawText(dateText, dateFont, Color.FromRgba(255, 255, 255, 215), new PointF(left + 20, dateY));

            for (var index = 0; index < titleLines.Count; index++)
                context.DrawText(titleLines[index], titleFont, Color.White,
                    new PointF(left, titleTop + index * titleLineHeight));

            for (var index = 0; index < descriptionLines.Count; index++)
                context.DrawText(descriptionLines[index], descriptionFont, Color.FromRgba(255, 255, 255, 230),
                    new PointF(left, descriptionTop + index * descriptionLineHeight));
        });

        var avatarStorageKey = GetAvatarStorageKey(post.Author?.AvatarUrl);
        if (avatarStorageKey != null)
        {
            using var avatar = await TryLoadImageAsync(avatarStorageKey);
            if (avatar != null)
            {
                avatar.Mutate(context => context.Resize(new ResizeOptions
                {
                    Size = new Size(avatarSize, avatarSize),
                    Mode = ResizeMode.Crop,
                    Position = AnchorPositionMode.Center
                }));
                MakeCircular(avatar);
                canvas.Mutate(context => context.DrawImage(avatar, new Point(left, avatarY), 1f));
            }
        }

        var authorBounds = TextMeasurer.MeasureBounds(authorName, new TextOptions(authorFont));
        var authorY = avatarY + (avatarSize - authorBounds.Height) / 2 - authorBounds.Y;
        canvas.Mutate(context =>
        {
            context.DrawText(authorName, authorFont, nicknameColor, new PointF(left + avatarSize + 16, authorY));
        });

        await using var output = new MemoryStream();
        await canvas.SaveAsPngAsync(output);
        var imageBytes = output.ToArray();
        await _ogImageCache.StoreAsync(OgImageStorageCache.PostKey(id), imageBytes);
        Response.Headers.CacheControl = "no-cache";
        return File(imageBytes, "image/png");
    }

    private string? ResolveOgBackgroundKey(Post post)
    {
        var blockFile = post.Blocks?.FirstOrDefault(b => b.Type == "image" && b.File != null)?.File?.StorageKey;
        if (!string.IsNullOrWhiteSpace(blockFile))
            return blockFile;

        var file = post.Files?.FirstOrDefault(f => f.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase));
        if (file != null)
            return file.StorageKey;

        return null;
    }

    private async Task<Image<Rgba32>?> TryLoadImageAsync(string storageKey)
    {
        if (string.IsNullOrWhiteSpace(storageKey))
            return null;

        try
        {
            using var response = await _storage.GetObjectAsync(storageKey);
            return await Image.LoadAsync<Rgba32>(response.ResponseStream);
        }
        catch (Amazon.S3.AmazonS3Exception exception)
        {
            _logger.LogWarning(exception, "Could not load OG image asset {StorageKey}", storageKey);
            return null;
        }
        catch (UnknownImageFormatException exception)
        {
            _logger.LogWarning(exception, "OG image asset {StorageKey} has an unsupported image format", storageKey);
            return null;
        }
    }

    private static string? GetAvatarStorageKey(string? avatarUrl)
    {
        if (string.IsNullOrWhiteSpace(avatarUrl) ||
            avatarUrl.StartsWith("avatar-video/", StringComparison.Ordinal))
            return null;

        return avatarUrl;
    }

    private static string FormatRussianDate(DateTime date)
    {
        var day = date.Day.ToString(CultureInfo.InvariantCulture);
        var year = date.Year.ToString(CultureInfo.InvariantCulture);
        var month = date.Month switch
        {
            1 => "января",
            2 => "февраля",
            3 => "марта",
            4 => "апреля",
            5 => "мая",
            6 => "июня",
            7 => "июля",
            8 => "августа",
            9 => "сентября",
            10 => "октября",
            11 => "ноября",
            12 => "декабря",
            _ => throw new ArgumentOutOfRangeException(nameof(date), "Date has an invalid month.")
        };

        return $"{day} {month} {year}";
    }

    private static Color TryParseNicknameColor(string? color)
    {
        if (!string.IsNullOrWhiteSpace(color) &&
            Regex.IsMatch(color, "^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$") &&
            Color.TryParseHex(color, out var parsedColor))
            return parsedColor;

        return Color.FromRgb(139, 92, 246);
    }

    private static void DrawOgBrand(
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

    private static List<string> WrapTextByWidth(string value, Font font, float maxWidth, int maxLines)
    {
        float Measure(string text) => TextMeasurer.MeasureAdvance(text, new TextOptions(font)).Width;

        string Fit(string text)
        {
            if (Measure(text) <= maxWidth)
                return text;

            text = text.TrimEnd('…');
            while (text.Length > 1 && Measure(text + "…") > maxWidth)
                text = text[..^1];
            return text.TrimEnd() + "…";
        }

        var words = value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var lines = new List<string>();
        var current = string.Empty;
        var truncated = false;

        foreach (var word in words)
        {
            var candidate = current.Length == 0 ? word : $"{current} {word}";
            if (Measure(candidate) <= maxWidth)
            {
                current = candidate;
                continue;
            }

            if (current.Length > 0)
                lines.Add(current);

            if (lines.Count == maxLines)
            {
                truncated = true;
                current = string.Empty;
                break;
            }

            current = word;
        }

        if (!truncated && current.Length > 0)
            lines.Add(current);

        if (truncated && lines.Count > 0)
            lines[^1] += "…";

        return lines.Select(Fit).ToList();
    }

    /// <summary>
    /// Затемнение для читаемости текста: плавный градиент снизу вверх
    /// плюс дополнительное затемнение у левого края, где расположен текст.
    /// </summary>
    private static void ApplyOgOverlay(Image<Rgba32> image)
    {
        var width = image.Width;
        var height = image.Height;

        static float Smooth(float value)
        {
            value = Math.Clamp(value, 0f, 1f);
            return value * value * (3f - 2f * value);
        }

        image.ProcessPixelRows(accessor =>
        {
            for (var y = 0; y < height; y++)
            {
                var row = accessor.GetRowSpan(y);
                var vertical = Smooth((y - height * 0.20f) / (height * 0.80f));
                for (var x = 0; x < width; x++)
                {
                    var horizontal = 1f - Smooth(x / (width * 0.8f));
                    var darkness = Math.Min(0.94f, 0.10f + 0.78f * vertical + 0.20f * horizontal * vertical);
                    var opacity = 1f - darkness;
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

    private static void MakeCircular(Image<Rgba32> image)
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
            await _storage.CreateVideoPreviewAsync(storageKey, file.ContentType);
            var stored = new PostFile { PostId = post.Id, FileName = Path.GetFileName(file.FileName), StorageKey = storageKey, ContentType = file.ContentType, SizeBytes = file.Length };
            storedFiles.Add(stored);
            _db.PostFiles.Add(stored);
        }
        await _db.SaveChangesAsync();

        foreach (var image in storedFiles.Where(file =>
                     file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)))
            _imagePreviewBackgroundService.Enqueue(image.StorageKey, image.ContentType);

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
            await _storage.CreateVideoPreviewAsync(storageKey, file.ContentType);
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

        foreach (var image in uploadedFiles.Where(file =>
                     file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)))
            _imagePreviewBackgroundService.Enqueue(image.StorageKey, image.ContentType);

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

    private PostFileDto ToFileDto(PostFile file) => new()
    {
        Id = file.Id,
        FileName = file.FileName,
        ContentType = file.ContentType,
        SizeBytes = file.SizeBytes,
        DownloadUrl = $"{Request.Scheme}://{Request.Host}/api/files/post/{file.Id}/download",
        PreviewUrl = file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
            ? _storage.GetPublicObjectUrl(_storage.GetPreviewObjectKey(file.StorageKey))
            : file.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)
                ? _storage.GetPublicObjectUrl(_storage.GetVideoPreviewObjectKey(file.StorageKey))
            : string.Empty
    };

    private PostFileDto ToCommentFileDto(CommentFile file) => new()
    {
        Id = file.Id,
        FileName = file.FileName,
        ContentType = file.ContentType,
        SizeBytes = file.SizeBytes,
        DownloadUrl = $"{Request.Scheme}://{Request.Host}/api/files/comment/{file.Id}/download",
        PreviewUrl = _storage.GetPublicObjectUrl(_storage.GetPreviewObjectKey(file.StorageKey))
    };

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