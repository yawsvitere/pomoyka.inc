using Amazon.S3;
using Amazon.S3.Model;
using System.Security.Cryptography;
using SixLabors.ImageSharp;
using System.Diagnostics;

namespace Feed.Api.Services;

public interface IStorageService
{
    string GetPresignedUploadUrl(string objectKey, string contentType, TimeSpan? expiry = null);

    string GetPresignedDownloadUrl(string objectKey, TimeSpan? expiry = null);
    string GetPublicObjectUrl(string objectKey);

    Task DeleteObjectAsync(string objectKey);
    Task DeleteObjectsAsync(IEnumerable<string> objectKeys);
    Task CopyObjectAsync(string sourceKey, string destinationKey);
    Task UploadObjectAsync(string objectKey, Stream content, string contentType);
    Task<ImagePreviewResult?> CreateImagePreviewAsync(string sourceKey, string contentType);
    Task<string?> CreateVideoPreviewAsync(string sourceKey, string contentType);
    Task<string> CreateAvatarVideoAsync(Stream content, int? cropX = null, int? cropY = null, int? cropWidth = null, int? cropHeight = null);
    Task<string> UploadDeduplicatedObjectAsync(Stream content, string contentType);
    string GetIconPreviewObjectKey(string objectKey);
    string GetPreviewObjectKey(string objectKey);
    string GetFeedPreviewObjectKey(string objectKey);
    IEnumerable<string> GetImagePreviewObjectKeys(string objectKey);
    string GetVideoPreviewObjectKey(string objectKey);
    IEnumerable<string> GetVideoPreviewObjectKeys(string objectKey);
    Task<GetObjectResponse> GetObjectAsync(
        string objectKey,
        CancellationToken cancellationToken = default);
    Task<GetObjectMetadataResponse> GetObjectMetadataAsync(string objectKey);
    Task<IReadOnlyList<string>> ListObjectKeysAsync(string prefix);
}

public sealed record ImagePreviewResult(string PreviewKey, int Width, int Height);

public class StorageService : IStorageService
{
    private readonly IAmazonS3 _s3;
    private readonly IAmazonS3 _publicS3;
    private readonly HttpClient _httpClient;
    private readonly string _bucket;
    private readonly string _publicEndpoint;
    private readonly bool _publicUseSsl;
    private readonly string _imgproxyEndpoint;
    private readonly string _imgproxySourceEndpoint;
    private readonly long _maxImagePixels;
    private readonly long _maxPreviewBytes;
    private readonly TimeSpan _videoPreviewTimeout;

    public StorageService(IAmazonS3 s3, IHttpClientFactory httpClientFactory, IConfiguration config)
    {
        _s3 = s3;
        _httpClient = httpClientFactory.CreateClient();
        _bucket = config["Minio:Bucket"] ?? "feed-files";
        _imgproxyEndpoint = config["Imgproxy:Endpoint"] ?? "http://localhost:8081";
        _imgproxySourceEndpoint =
            $"http{(config.GetValue<bool>("Minio:UseSSL") ? "s" : "")}://{config["Minio:Endpoint"] ?? "localhost:9000"}";
        _maxImagePixels = Math.Clamp(config.GetValue<long?>("PreviewWorker:MaxImagePixels") ?? 80_000_000, 1_000_000, 500_000_000);
        _maxPreviewBytes = Math.Clamp(config.GetValue<long?>("PreviewWorker:MaxPreviewBytes") ?? 20L * 1024 * 1024, 1L * 1024 * 1024, 100L * 1024 * 1024);
        _videoPreviewTimeout = TimeSpan.FromSeconds(Math.Clamp(
            config.GetValue<int?>("PreviewWorker:VideoTimeoutSeconds") ?? 90, 10, 600));

        _publicEndpoint = config["Minio:PublicEndpoint"] ?? config["Minio:Endpoint"] ?? "localhost:9000";
        _publicUseSsl = config.GetValue<bool?>("Minio:PublicUseSSL") ??
            config.GetValue<bool>("Minio:UseSSL");
        _publicS3 = string.IsNullOrWhiteSpace(_publicEndpoint)
            ? _s3
            : new AmazonS3Client(
                new Amazon.Runtime.BasicAWSCredentials(
                    config["Minio:AccessKey"], config["Minio:SecretKey"]),
                new AmazonS3Config
                {
                    ServiceURL = $"{(_publicUseSsl ? "https" : "http")}://{_publicEndpoint}",
                    ForcePathStyle = true
                });
    }

    public string GetPresignedUploadUrl(string objectKey, string contentType, TimeSpan? expiry = null)
    {
        var request = new GetPreSignedUrlRequest
        {
            BucketName = _bucket,
            Key = objectKey,
            Verb = HttpVerb.PUT,
            Expires = DateTime.UtcNow.Add(expiry ?? TimeSpan.FromMinutes(15)),
            ContentType = contentType
        };
        return _publicS3.GetPreSignedURL(request);
    }

    public string GetPresignedDownloadUrl(string objectKey, TimeSpan? expiry = null)
    {
        var request = new GetPreSignedUrlRequest
        {
            BucketName = _bucket,
            Key = objectKey,
            Verb = HttpVerb.GET,
            Expires = DateTime.UtcNow.Add(expiry ?? TimeSpan.FromHours(1))
        };
        return _publicS3.GetPreSignedURL(request);
    }

    public string GetPublicObjectUrl(string objectKey) =>
        $"{(_publicUseSsl ? "https" : "http")}://{_publicEndpoint}/{_bucket}/{string.Join('/', objectKey.Split('/').Select(Uri.EscapeDataString))}";

    public async Task DeleteObjectAsync(string objectKey)
    {
        await _s3.DeleteObjectAsync(_bucket, objectKey);
    }

    public async Task DeleteObjectsAsync(IEnumerable<string> objectKeys)
    {
        foreach (var batch in objectKeys.Distinct(StringComparer.Ordinal).Chunk(1000))
        {
            if (batch.Length == 0) continue;
            var response = await _s3.DeleteObjectsAsync(new DeleteObjectsRequest
            {
                BucketName = _bucket,
                Objects = batch.Select(key => new KeyVersion { Key = key }).ToList(),
                Quiet = true
            });
            if (response.DeleteErrors.Count > 0)
                throw new InvalidOperationException(
                    $"Не удалось удалить {response.DeleteErrors.Count} объектов из хранилища.");
        }
    }

    public async Task CopyObjectAsync(string sourceKey, string destinationKey)
    {
        await _s3.CopyObjectAsync(new CopyObjectRequest
        {
            SourceBucket = _bucket,
            SourceKey = sourceKey,
            DestinationBucket = _bucket,
            DestinationKey = destinationKey
        });
    }

    public async Task UploadObjectAsync(string objectKey, Stream content, string contentType)
    {
        await _s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = _bucket,
            Key = objectKey,
            InputStream = content,
            ContentType = contentType,
            Headers = { CacheControl = "public, max-age=31536000, immutable" }
        });
    }

    public string GetIconPreviewObjectKey(string objectKey) =>
        $"previews/30x30/{objectKey}.webp";

    public string GetPreviewObjectKey(string objectKey) =>
        $"previews/360/{objectKey}.webp";

    public string GetFeedPreviewObjectKey(string objectKey) =>
        $"previews/865/{objectKey}.webp";

    public IEnumerable<string> GetImagePreviewObjectKeys(string objectKey) =>
        new[]
        {
            GetIconPreviewObjectKey(objectKey),
            GetPreviewObjectKey(objectKey),
            GetFeedPreviewObjectKey(objectKey)
        };

    public string GetVideoPreviewObjectKey(string objectKey) => $"previews/{objectKey}.mp4";

    public IEnumerable<string> GetVideoPreviewObjectKeys(string objectKey) =>
        new[] { GetIconPreviewObjectKey(objectKey), GetVideoPreviewObjectKey(objectKey) };

    public async Task<ImagePreviewResult?> CreateImagePreviewAsync(string sourceKey, string contentType)
    {
        if (!contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return null;

        int originalWidth;
        int originalHeight;
        using (var source = await _s3.GetObjectAsync(_bucket, sourceKey))
        {
            var imageInfo = await Image.IdentifyAsync(source.ResponseStream)
                ?? throw new InvalidOperationException($"Could not identify image {sourceKey}.");
            originalWidth = imageInfo.Width;
            originalHeight = imageInfo.Height;
            if ((long)originalWidth * originalHeight > _maxImagePixels)
                throw new InvalidOperationException($"Image {sourceKey} exceeds the preview pixel limit.");
        }

        var escapedKey = string.Join("/", sourceKey.Split('/').Select(Uri.EscapeDataString));
        var sourceUrl = Uri.EscapeDataString(
            $"{_imgproxySourceEndpoint}/{Uri.EscapeDataString(_bucket)}/{escapedKey}");
        var previewVariants = new[]
        {
            (Key: GetIconPreviewObjectKey(sourceKey), Resize: "fill:30:30"),
            (Key: GetPreviewObjectKey(sourceKey), Resize: "fit:360:0"),
            (Key: GetFeedPreviewObjectKey(sourceKey), Resize: "fit:865:0")
        };
        foreach (var (previewKey, resize) in previewVariants)
        {
            try
            {
                await _s3.GetObjectMetadataAsync(_bucket, previewKey);
                continue;
            }
            catch (AmazonS3Exception exception) when (
                exception.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
            }

            var imgproxyUrl =
                $"{_imgproxyEndpoint.TrimEnd('/')}/insecure/rs:{resize}/q:82/plain/{sourceUrl}@webp";
            using var response = await _httpClient.GetAsync(
                imgproxyUrl,
                HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();
            var contentLength = response.Content.Headers.ContentLength;
            if (contentLength.HasValue && contentLength.Value > _maxPreviewBytes)
                throw new InvalidOperationException($"Preview for {sourceKey} exceeds the size limit.");

            await using var preview = new MemoryStream();
            await using var previewStream = await response.Content.ReadAsStreamAsync();
            await CopyToWithLimitAsync(previewStream, preview, _maxPreviewBytes);
            preview.Position = 0;
            await UploadObjectAsync(previewKey, preview, "image/webp");
        }

        var feedPreviewKey = GetPreviewObjectKey(sourceKey);
        return new ImagePreviewResult(feedPreviewKey, originalWidth, originalHeight);
    }

    public async Task<string?> CreateVideoPreviewAsync(string sourceKey, string contentType)
    {
        if (!contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
            return null;

        var previewKey = GetVideoPreviewObjectKey(sourceKey);
        var iconPreviewKey = GetIconPreviewObjectKey(sourceKey);
        var hasVideoPreview = false;
        var hasIconPreview = false;
        try
        {
            await _s3.GetObjectMetadataAsync(_bucket, previewKey);
            hasVideoPreview = true;
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
        }

        try
        {
            await _s3.GetObjectMetadataAsync(_bucket, iconPreviewKey);
            hasIconPreview = true;
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
        }

        if (hasVideoPreview && hasIconPreview)
            return previewKey;

        var tempDirectory = Directory.CreateTempSubdirectory("feed-video-preview-");
        try
        {
            var inputPath = Path.Combine(tempDirectory.FullName, "source");
            var outputPath = Path.Combine(tempDirectory.FullName, "preview.mp4");
            var iconOutputPath = Path.Combine(tempDirectory.FullName, "preview.webp");
            using (var source = await _s3.GetObjectAsync(_bucket, sourceKey))
            await using (var input = File.Create(inputPath))
            {
                await source.ResponseStream.CopyToAsync(input);
            }

            if (!hasVideoPreview)
            {
                await RunFfmpegAsync(outputPath,
                    "-y", "-i", inputPath, "-t", "8", "-map", "0:v:0",
                    "-vf", "scale=440:-2", "-an", "-c:v", "libx264", "-preset", "veryfast",
                    "-crf", "28", "-profile:v", "main", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", outputPath);
                await using var preview = File.OpenRead(outputPath);
                await UploadObjectAsync(previewKey, preview, "video/mp4");
            }

            if (!hasIconPreview)
            {
                await RunFfmpegAsync(iconOutputPath,
                    "-y", "-i", inputPath, "-map", "0:v:0", "-frames:v", "1",
                    "-vf", "scale=30:30:force_original_aspect_ratio=increase,crop=30:30",
                    "-c:v", "libwebp", "-quality", "82", "-f", "webp", iconOutputPath);
                await using var iconPreview = File.OpenRead(iconOutputPath);
                await UploadObjectAsync(iconPreviewKey, iconPreview, "image/webp");
            }

            return previewKey;
        }
        finally
        {
            tempDirectory.Delete(true);
        }
    }

    private async Task RunFfmpegAsync(string outputPath, params string[] arguments)
    {
        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "ffmpeg",
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };
        foreach (var argument in arguments)
            process.StartInfo.ArgumentList.Add(argument);

        process.Start();
        var errorTask = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(_videoPreviewTimeout);
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync();
            throw new TimeoutException($"ffmpeg exceeded the {_videoPreviewTimeout.TotalSeconds}-second preview limit.");
        }

        var error = await errorTask;
        if (process.ExitCode != 0 || !File.Exists(outputPath))
            throw new InvalidOperationException($"ffmpeg не смог создать превью видео: {error}");
    }

    private static async Task CopyToWithLimitAsync(Stream source, Stream destination, long maxBytes)
    {
        var buffer = new byte[81920];
        long copied = 0;
        int read;
        while ((read = await source.ReadAsync(buffer)) > 0)
        {
            copied += read;
            if (copied > maxBytes)
                throw new InvalidOperationException("Preview exceeds the size limit.");
            await destination.WriteAsync(buffer.AsMemory(0, read));
        }
    }

    public async Task<string> CreateAvatarVideoAsync(Stream content, int? cropX = null, int? cropY = null, int? cropWidth = null, int? cropHeight = null)
    {
        var tempDirectory = Directory.CreateTempSubdirectory("feed-avatar-video-");
        try
        {
            var inputPath = Path.Combine(tempDirectory.FullName, "source");
            var outputPath = Path.Combine(tempDirectory.FullName, "avatar.mp4");
            await using (var input = File.Create(inputPath))
            {
                await content.CopyToAsync(input);
            }

            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "ffmpeg",
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };
            var cropFilter = cropWidth.HasValue && cropHeight.HasValue
                ? $"crop={cropWidth.Value}:{cropHeight.Value}:{cropX.GetValueOrDefault()}:{cropY.GetValueOrDefault()},"
                : string.Empty;
            foreach (var argument in new[]
            {
                "-y", "-i", inputPath, "-t", "4", "-map", "0:v:0",
                "-vf", $"{cropFilter}scale=192:192:force_original_aspect_ratio=increase,crop=192:192",
                "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath
            })
                process.StartInfo.ArgumentList.Add(argument);

            process.Start();
            var error = await process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            if (process.ExitCode != 0 || !File.Exists(outputPath))
                throw new InvalidOperationException($"ffmpeg не смог обработать видео-аватар: {error}");

            await using var output = File.OpenRead(outputPath);
            var storageKey = await UploadDeduplicatedObjectAsync(output, "video/mp4");
            return $"avatar-video/{storageKey}";
        }
        finally
        {
            tempDirectory.Delete(true);
        }
    }

    public async Task<string> UploadDeduplicatedObjectAsync(Stream content, string contentType)
    {
        if (!content.CanSeek)
            throw new InvalidOperationException("Дедупликация требует потока с поддержкой перемотки");

        var hash = await SHA256.HashDataAsync(content);
        content.Position = 0;

        var objectKey = $"sha256/{Convert.ToHexString(hash).ToLowerInvariant()}";
        try
        {
            await _s3.GetObjectMetadataAsync(_bucket, objectKey);
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            await UploadObjectAsync(objectKey, content, contentType);
        }

        return objectKey;
    }

    public Task<GetObjectResponse> GetObjectAsync(
        string objectKey,
        CancellationToken cancellationToken = default) =>
        _s3.GetObjectAsync(_bucket, objectKey, cancellationToken);

    public Task<GetObjectMetadataResponse> GetObjectMetadataAsync(string objectKey) =>
        _s3.GetObjectMetadataAsync(_bucket, objectKey);

    public async Task<IReadOnlyList<string>> ListObjectKeysAsync(string prefix)
    {
        var keys = new List<string>();
        string? continuationToken = null;
        do
        {
            var response = await _s3.ListObjectsV2Async(new ListObjectsV2Request
            {
                BucketName = _bucket,
                Prefix = prefix,
                ContinuationToken = continuationToken
            });
            keys.AddRange(response.S3Objects.Select(item => item.Key));
            continuationToken = response.IsTruncated ? response.NextContinuationToken : null;
        }
        while (continuationToken != null);

        return keys;
    }
}
