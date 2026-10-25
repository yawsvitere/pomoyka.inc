using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;
using Amazon.S3;
using Feed.Api.Models;
using SixLabors.Fonts;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Drawing.Processing;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace Feed.Api.Services;

public sealed class OgImageGenerator(
    IStorageService storage,
    ILogger<OgImageGenerator> logger)
{
    private const int Width = 1200;
    private const int Height = 630;
    private const string AvatarVideoPrefix = "avatar-video/";

    public static string CreateMetadataHtml(
        string title,
        string bodyTitle,
        string description,
        string canonicalUrl,
        string imageUrl,
        string type)
    {
        static string Encode(string value) => HtmlEncoder.Default.Encode(value);

        var encodedTitle = Encode(title);
        var encodedBodyTitle = Encode(bodyTitle);
        var encodedDescription = Encode(description);
        var encodedCanonicalUrl = Encode(canonicalUrl);
        var encodedImageUrl = Encode(imageUrl);
        return $"""
            <!doctype html>
            <html lang="ru">
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>{encodedTitle}</title>
                <meta name="description" content="{encodedDescription}">
                <meta property="og:site_name" content="Помойка.inc">
                <meta property="og:type" content="{Encode(type)}">
                <meta property="og:title" content="{encodedTitle}">
                <meta property="og:description" content="{encodedDescription}">
                <meta property="og:url" content="{encodedCanonicalUrl}">
                <meta property="og:image" content="{encodedImageUrl}">
                <meta property="og:image:width" content="{Width}">
                <meta property="og:image:height" content="{Height}">
                <meta name="twitter:card" content="summary_large_image">
                <meta name="twitter:title" content="{encodedTitle}">
                <meta name="twitter:description" content="{encodedDescription}">
                <meta name="twitter:image" content="{encodedImageUrl}">
              </head>
              <body><h1>{encodedBodyTitle}</h1><p>{encodedDescription}</p></body>
            </html>
            """;
    }

    public async Task<byte[]> GenerateGalleryAsync(
        FileFolder folder,
        CancellationToken cancellationToken)
    {
        const int left = 58;
        var assets = LoadAssets();
        var labelFont = assets.BoldFamily.CreateFont(27, FontStyle.Bold);
        var titleFont = assets.BoldFamily.CreateFont(58, FontStyle.Bold);
        var brandFont = assets.BoldFamily.CreateFont(30, FontStyle.Bold);
        var brandMarkFont = assets.BoldFamily.CreateFont(18, FontStyle.Bold);
        using var brandIcon = await LoadBrandIconAsync(assets.BrandIconPath, cancellationToken);

        using var canvas = CreateCanvas();

        var files = folder.Files
            .Where(file =>
                file.AccessLevel == FileAccessLevel.Public &&
                file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        Random.Shared.Shuffle(files);
        Array.Resize(ref files, Math.Min(files.Length, 9));

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
                var image = await TryLoadImageAsync(
                    storage.GetFeedPreviewObjectKey(file.StorageKey),
                    cancellationToken)
                    ?? await TryLoadImageAsync(file.StorageKey, cancellationToken);
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
        ApplyGalleryOverlay(canvas);

        var titleLines = WrapGalleryTitle(folder.Name.Trim(), titleFont, Width - left * 2);
        canvas.Mutate(context =>
        {
            DrawBrand(context, brandIcon, brandFont, brandMarkFont);
            for (var index = 0; index < titleLines.Count; index++)
                context.DrawText(titleLines[index], titleFont, Color.White,
                    new PointF(left, 492 + index * 66));
        });

        var ownerName = folder.Owner?.DisplayName ?? "Помойка.inc";
        var ownerNameColor = TryParseNicknameColor(folder.Owner?.NicknameColor);
        const int ownerAvatarSize = 48;
        var ownerAvatarKey = GetAvatarStorageKey(folder.Owner?.AvatarUrl);
        if (ownerAvatarKey != null)
        {
            using var ownerAvatar = await TryLoadImageAsync(ownerAvatarKey, cancellationToken);
            if (ownerAvatar != null)
            {
                ownerAvatar.Mutate(context => context.Resize(new ResizeOptions
                {
                    Size = new Size(ownerAvatarSize, ownerAvatarSize),
                    Mode = ResizeMode.Crop,
                    Position = AnchorPositionMode.Center
                }));
                MakeCircular(ownerAvatar);
                canvas.Mutate(context => context.DrawImage(ownerAvatar, new Point(left, 32), 1f));
            }
        }
        else if (TryGetAvatarVideoStorageKey(folder.Owner?.AvatarUrl) is { } ownerVideoKey)
        {
            var thumbnailKey = await storage.GetOrCreateAvatarVideoThumbnailAsync(
                ownerVideoKey,
                cancellationToken);
            using var ownerAvatar = await TryLoadImageAsync(thumbnailKey, cancellationToken);
            if (ownerAvatar != null)
            {
                ownerAvatar.Mutate(context => context.Resize(new ResizeOptions
                {
                    Size = new Size(ownerAvatarSize, ownerAvatarSize),
                    Mode = ResizeMode.Crop,
                    Position = AnchorPositionMode.Center
                }));
                MakeCircular(ownerAvatar);
                canvas.Mutate(context => context.DrawImage(ownerAvatar, new Point(left, 32), 1f));
            }
        }

        var ownerNameBounds = TextMeasurer.MeasureBounds(ownerName, new TextOptions(labelFont));
        var ownerNameY = 32 + (ownerAvatarSize - ownerNameBounds.Height) / 2 - ownerNameBounds.Y;
        canvas.Mutate(context => context.DrawText(
            ownerName,
            labelFont,
            ownerNameColor,
            new PointF(left + ownerAvatarSize + 14, ownerNameY)));

        return await EncodePngAsync(canvas, cancellationToken);
    }

    public async Task<byte[]> GeneratePostAsync(Post post, CancellationToken cancellationToken)
    {
        const int left = 64;
        const int bottomPadding = 56;
        const int avatarSize = 52;
        const float maxTextWidth = Width - left * 2 - 80;

        var assets = LoadAssets();
        var dateFont = assets.BoldFamily.CreateFont(24, FontStyle.Bold);
        var titleFont = assets.BoldFamily.CreateFont(68, FontStyle.Bold);
        var descriptionFont = assets.BoldFamily.CreateFont(30, FontStyle.Bold);
        var authorFont = assets.BoldFamily.CreateFont(28, FontStyle.Bold);
        var brandFont = assets.BoldFamily.CreateFont(30, FontStyle.Bold);
        var brandMarkFont = assets.BoldFamily.CreateFont(18, FontStyle.Bold);
        using var brandIcon = await LoadBrandIconAsync(assets.BrandIconPath, cancellationToken);

        using var canvas = CreateCanvas();
        var backgroundKey = post.OgCoverStorageKey ?? ResolveOgBackgroundKey(post);
        if (backgroundKey != null)
        {
            using var background = await TryLoadImageAsync(backgroundKey, cancellationToken);
            if (background != null)
            {
                background.Mutate(context => context.Resize(new ResizeOptions
                {
                    Size = new Size(Width, Height),
                    Mode = ResizeMode.Crop,
                    Position = AnchorPositionMode.Center
                }));
                canvas.Mutate(context => context.DrawImage(background, new Point(0, 0), 1f));
            }
        }

        ApplyPostOverlay(canvas);

        var postTitle = string.IsNullOrWhiteSpace(post.Title) ? "Без заголовка" : post.Title.Trim();
        var description = string.IsNullOrWhiteSpace(post.Description)
            ? "Новая публикация в коллекции постишек."
            : post.Description.Trim();
        var authorName = post.Author?.DisplayName ?? "Помойка.inc";
        var dateText = FormatRussianDate(post.CreatedAt);
        var nicknameColor = TryParseNicknameColor(post.Author?.NicknameColor);
        var titleLines = WrapTextByWidth(postTitle, titleFont, maxTextWidth, 2);
        var descriptionLines = WrapTextByWidth(description, descriptionFont, maxTextWidth, 2);

        const int titleLineHeight = 76;
        const int descriptionLineHeight = 40;
        var avatarY = Height - bottomPadding - avatarSize;
        var descriptionBottom = avatarY - 28;
        var descriptionTop = descriptionBottom - descriptionLines.Count * descriptionLineHeight;
        var titleBottom = descriptionTop - 10;
        var titleTop = titleBottom - titleLines.Count * titleLineHeight;
        var dateY = titleTop - 44;

        canvas.Mutate(context =>
        {
            DrawBrand(context, brandIcon, brandFont, brandMarkFont);
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
            using var avatar = await TryLoadImageAsync(avatarStorageKey, cancellationToken);
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
        else if (TryGetAvatarVideoStorageKey(post.Author?.AvatarUrl) is { } avatarVideoKey)
        {
            var thumbnailKey = await storage.GetOrCreateAvatarVideoThumbnailAsync(
                avatarVideoKey,
                cancellationToken);
            using var avatar = await TryLoadImageAsync(thumbnailKey, cancellationToken);
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
            context.DrawText(authorName, authorFont, nicknameColor, new PointF(left + avatarSize + 16, authorY)));

        return await EncodePngAsync(canvas, cancellationToken);
    }

    private static (FontCollection Fonts, FontFamily BoldFamily, string BrandIconPath) LoadAssets()
    {
        var fontsPath = Path.Combine(AppContext.BaseDirectory, "Assets", "Fonts");
        var boldFontPath = Path.Combine(fontsPath, "Geist-Bold.ttf");
        if (!File.Exists(boldFontPath))
            throw new InvalidOperationException($"OG font is missing. Add Geist-Bold.ttf to {fontsPath}.");

        var brandIconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "logo", "icon.png");
        if (!File.Exists(brandIconPath))
            throw new InvalidOperationException(
                $"OG logo is missing. Add icon.png to {Path.GetDirectoryName(brandIconPath)}.");

        var fonts = new FontCollection();
        return (fonts, fonts.Add(boldFontPath), brandIconPath);
    }

    private static async Task<Image<Rgba32>> LoadBrandIconAsync(
        string brandIconPath,
        CancellationToken cancellationToken)
    {
        var icon = await Image.LoadAsync<Rgba32>(brandIconPath, cancellationToken);
        icon.Mutate(context => context.Resize(new Size(56, 56)));
        return icon;
    }

    private static Image<Rgba32> CreateCanvas()
    {
        var canvas = new Image<Rgba32>(Width, Height);
        canvas.Mutate(context => context.Fill(Color.FromRgb(24, 24, 24)));
        return canvas;
    }

    private static async Task<byte[]> EncodePngAsync(
        Image<Rgba32> canvas,
        CancellationToken cancellationToken)
    {
        await using var stream = new MemoryStream();
        await canvas.SaveAsync(stream, new PngEncoder(), cancellationToken);
        return stream.ToArray();
    }

    private async Task<Image<Rgba32>?> TryLoadImageAsync(
        string storageKey,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(storageKey))
            return null;

        try
        {
            using var response = await storage.GetObjectAsync(storageKey, cancellationToken);
            return await Image.LoadAsync<Rgba32>(response.ResponseStream, cancellationToken);
        }
        catch (AmazonS3Exception exception)
        {
            logger.LogWarning(exception, "Could not load OG image asset {StorageKey}", storageKey);
            return null;
        }
        catch (UnknownImageFormatException exception)
        {
            logger.LogWarning(exception, "OG image asset {StorageKey} has an unsupported image format", storageKey);
            return null;
        }
    }

    private static string? ResolveOgBackgroundKey(Post post)
    {
        var blockFile = post.Blocks?.FirstOrDefault(block => block.Type == "image" && block.File != null)
            ?.File?.StorageKey;
        if (!string.IsNullOrWhiteSpace(blockFile))
            return blockFile;

        return post.Files?.FirstOrDefault(file =>
            file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))?.StorageKey;
    }

    private static string? GetAvatarStorageKey(string? avatarUrl) =>
        string.IsNullOrWhiteSpace(avatarUrl) ||
        avatarUrl.StartsWith(AvatarVideoPrefix, StringComparison.Ordinal)
            ? null
            : avatarUrl;

    private static string? TryGetAvatarVideoStorageKey(string? avatarUrl) =>
        avatarUrl?.StartsWith(AvatarVideoPrefix, StringComparison.Ordinal) == true
            ? avatarUrl[AvatarVideoPrefix.Length..]
            : null;

    private static Color TryParseNicknameColor(string? color)
    {
        if (!string.IsNullOrWhiteSpace(color) &&
            color[0] == '#' &&
            color.Length is 4 or 7 &&
            color[1..].All(Uri.IsHexDigit) &&
            Color.TryParseHex(color, out var parsedColor))
            return parsedColor;

        return Color.FromRgb(139, 92, 246);
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

    private static void DrawBrand(
        IImageProcessingContext context,
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
        var iconX = Width - rightPadding - (int)Math.Ceiling(contentWidth);
        var textX = iconX + iconSize + gap;
        var textY = top + (iconSize - brandFont.Size) / 2;

        context.DrawImage(icon, new Point(iconX, top), 1f);
        context.DrawText(brandName, brandFont, Color.White, new PointF(textX, textY));
        context.DrawText("®", markFont, Color.White,
            new PointF(textX + brandWidth + 2, textY - markFont.Size / 3));
    }

    private static string FormatRussianDate(DateTime date)
    {
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
        return $"{date.Day.ToString(CultureInfo.InvariantCulture)} {month} {date.Year.ToString(CultureInfo.InvariantCulture)}";
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

    private static void ApplyPostOverlay(Image<Rgba32> image)
    {
        static float Smooth(float value)
        {
            value = Math.Clamp(value, 0f, 1f);
            return value * value * (3f - 2f * value);
        }

        image.ProcessPixelRows(accessor =>
        {
            for (var y = 0; y < image.Height; y++)
            {
                var row = accessor.GetRowSpan(y);
                var vertical = Smooth((y - image.Height * 0.20f) / (image.Height * 0.80f));
                for (var x = 0; x < image.Width; x++)
                {
                    var horizontal = 1f - Smooth(x / (image.Width * 0.8f));
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

    private static void ApplyGalleryOverlay(Image<Rgba32> image)
    {
        image.ProcessPixelRows(accessor =>
        {
            for (var y = 0; y < image.Height; y++)
            {
                var row = accessor.GetRowSpan(y);
                var lowerGradient = Math.Clamp((y - image.Height * 0.42f) / (image.Height * 0.58f), 0f, 1f);
                var opacity = 1f - (0.30f + 0.62f * lowerGradient);
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
        int planeWidth,
        int planeHeight,
        float yawDegrees,
        float pitchDegrees,
        float distance,
        float focalLength,
        float scale,
        float centerX,
        float centerY)
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
            return new PointF(centerX + focalLength * rx / rz, centerY + focalLength * ry / rz);
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
        var matrix = new double[8, 9];
        for (var i = 0; i < 4; i++)
        {
            double x = destination[i].X, y = destination[i].Y;
            double u = source[i].X, v = source[i].Y;
            var row = i * 2;
            matrix[row, 0] = x; matrix[row, 1] = y; matrix[row, 2] = 1;
            matrix[row, 6] = -u * x; matrix[row, 7] = -u * y; matrix[row, 8] = u;
            matrix[row + 1, 3] = x; matrix[row + 1, 4] = y; matrix[row + 1, 5] = 1;
            matrix[row + 1, 6] = -v * x; matrix[row + 1, 7] = -v * y; matrix[row + 1, 8] = v;
        }

        for (var col = 0; col < 8; col++)
        {
            var pivot = col;
            for (var row = col + 1; row < 8; row++)
                if (Math.Abs(matrix[row, col]) > Math.Abs(matrix[pivot, col]))
                    pivot = row;
            if (pivot != col)
                for (var c = 0; c < 9; c++)
                    (matrix[col, c], matrix[pivot, c]) = (matrix[pivot, c], matrix[col, c]);

            var divisor = matrix[col, col];
            for (var c = col; c < 9; c++)
                matrix[col, c] /= divisor;
            for (var row = 0; row < 8; row++)
            {
                if (row == col) continue;
                var factor = matrix[row, col];
                if (factor == 0) continue;
                for (var c = col; c < 9; c++)
                    matrix[row, c] -= factor * matrix[col, c];
            }
        }

        var homography = new double[9];
        for (var i = 0; i < 8; i++)
            homography[i] = matrix[i, 8];
        homography[8] = 1;
        return homography;
    }

    private static void DrawGalleryPlane(Image<Rgba32> canvas, Image<Rgba32> plane, PointF[] quad)
    {
        var width = plane.Width;
        var height = plane.Height;
        var homography = SolveHomography(quad, new[]
        {
            new PointF(0, 0), new PointF(width, 0), new PointF(width, height), new PointF(0, height)
        });
        var pixels = new Rgba32[width * height];
        plane.CopyPixelDataTo(pixels);
        var minX = Math.Max(0, (int)Math.Floor(quad.Min(point => point.X)));
        var maxX = Math.Min(canvas.Width - 1, (int)Math.Ceiling(quad.Max(point => point.X)));
        var minY = Math.Max(0, (int)Math.Floor(quad.Min(point => point.Y)));
        var maxY = Math.Min(canvas.Height - 1, (int)Math.Ceiling(quad.Max(point => point.Y)));
        if (minX > maxX || minY > maxY)
            return;

        const int samples = 2;
        const float inverseSamples = 1f / (samples * samples);
        (float r, float g, float b, float a) Fetch(int x, int y)
        {
            if (x < 0 || y < 0 || x >= width || y >= height)
                return (0f, 0f, 0f, 0f);
            var pixel = pixels[y * width + x];
            var alpha = pixel.A / 255f;
            return (pixel.R / 255f * alpha, pixel.G / 255f * alpha, pixel.B / 255f * alpha, alpha);
        }

        canvas.ProcessPixelRows(accessor =>
        {
            for (var y = minY; y <= maxY; y++)
            {
                var row = accessor.GetRowSpan(y);
                for (var x = minX; x <= maxX; x++)
                {
                    float sr = 0, sg = 0, sb = 0, sa = 0;
                    for (var sy = 0; sy < samples; sy++)
                    {
                        for (var sx = 0; sx < samples; sx++)
                        {
                            var px = x + (sx + 0.5) / samples;
                            var py = y + (sy + 0.5) / samples;
                            var w = homography[6] * px + homography[7] * py + homography[8];
                            if (w <= 0)
                                continue;
                            var u = (homography[0] * px + homography[1] * py + homography[2]) / w - 0.5;
                            var v = (homography[3] * px + homography[4] * py + homography[5]) / w - 0.5;
                            if (u < -1 || v < -1 || u > width || v > height)
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

                    sr *= inverseSamples; sg *= inverseSamples; sb *= inverseSamples; sa *= inverseSamples;
                    if (sa <= 0)
                        continue;
                    var destination = row[x];
                    var inverseAlpha = 1f - sa;
                    row[x] = new Rgba32(
                        (byte)Math.Clamp(sr * 255f + destination.R * inverseAlpha + 0.5f, 0f, 255f),
                        (byte)Math.Clamp(sg * 255f + destination.G * inverseAlpha + 0.5f, 0f, 255f),
                        (byte)Math.Clamp(sb * 255f + destination.B * inverseAlpha + 0.5f, 0f, 255f),
                        255);
                }
            }
        });
    }
}
