using Amazon.S3;
using Amazon.S3.Model;
using System.Security.Cryptography;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;
using System.Diagnostics;

namespace Feed.Api.Services;

public interface IStorageService
{
    string GetPresignedUploadUrl(string objectKey, string contentType, TimeSpan? expiry = null);

    string GetPresignedDownloadUrl(string objectKey, TimeSpan? expiry = null);
    string GetPublicObjectUrl(string objectKey);

    Task DeleteObjectAsync(string objectKey);
    Task CopyObjectAsync(string sourceKey, string destinationKey);
    Task UploadObjectAsync(string objectKey, Stream content, string contentType);
    Task<string?> CreateImagePreviewAsync(string sourceKey, string contentType);
    Task<string?> CreateVideoPreviewAsync(string sourceKey, string contentType);
    Task<string> CreateAvatarVideoAsync(Stream content, int? cropX = null, int? cropY = null, int? cropWidth = null, int? cropHeight = null);
    Task<string> UploadDeduplicatedObjectAsync(Stream content, string contentType);
    string GetPreviewObjectKey(string objectKey);
    string GetVideoPreviewObjectKey(string objectKey);
    Task<GetObjectResponse> GetObjectAsync(string objectKey);
    Task<GetObjectMetadataResponse> GetObjectMetadataAsync(string objectKey);
    Task<IReadOnlyList<string>> ListObjectKeysAsync(string prefix);
}

public class StorageService : IStorageService
{
    private readonly IAmazonS3 _s3;
    private readonly IAmazonS3 _publicS3;
    private readonly string _bucket;
    private readonly string _publicEndpoint;

    public StorageService(IAmazonS3 s3, IConfiguration config)
    {
        _s3 = s3;
        _bucket = config["Minio:Bucket"] ?? "feed-files";

        _publicEndpoint = config["Minio:PublicEndpoint"] ?? config["Minio:Endpoint"] ?? "localhost:9000";
        _publicS3 = string.IsNullOrWhiteSpace(_publicEndpoint)
            ? _s3
            : new AmazonS3Client(
                new Amazon.Runtime.BasicAWSCredentials(
                    config["Minio:AccessKey"], config["Minio:SecretKey"]),
                new AmazonS3Config
                {
                    ServiceURL = $"http://{_publicEndpoint}",
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
        $"http://{_publicEndpoint}/{_bucket}/{string.Join('/', objectKey.Split('/').Select(Uri.EscapeDataString))}";

    public async Task DeleteObjectAsync(string objectKey)
    {
        await _s3.DeleteObjectAsync(_bucket, objectKey);
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

    public string GetPreviewObjectKey(string objectKey) => $"previews/{objectKey}.webp";

    public string GetVideoPreviewObjectKey(string objectKey) => $"previews/{objectKey}.mp4";

    public async Task<string?> CreateImagePreviewAsync(string sourceKey, string contentType)
    {
        if (!contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return null;

        var previewKey = GetPreviewObjectKey(sourceKey);
        try
        {
            await _s3.GetObjectMetadataAsync(_bucket, previewKey);
            return previewKey;
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
        }

        using var source = await _s3.GetObjectAsync(_bucket, sourceKey);
        using var image = await Image.LoadAsync(source.ResponseStream);
        var targetWidth = Math.Min(360, image.Width);
        var targetHeight = Math.Max(1, (int)Math.Round(image.Height * (targetWidth / (double)image.Width)));
        image.Mutate(context => context.Resize(targetWidth, targetHeight));

        await using var preview = new MemoryStream();
        await image.SaveAsync(preview, new WebpEncoder { Quality = 82 });
        preview.Position = 0;
        await UploadObjectAsync(previewKey, preview, "image/webp");
        return previewKey;
    }

    public async Task<string?> CreateVideoPreviewAsync(string sourceKey, string contentType)
    {
        if (!contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
            return null;

        var previewKey = GetVideoPreviewObjectKey(sourceKey);
        try
        {
            await _s3.GetObjectMetadataAsync(_bucket, previewKey);
            return previewKey;
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
        }

        var tempDirectory = Directory.CreateTempSubdirectory("feed-video-preview-");
        try
        {
            var inputPath = Path.Combine(tempDirectory.FullName, "source");
            var outputPath = Path.Combine(tempDirectory.FullName, "preview.mp4");
            using (var source = await _s3.GetObjectAsync(_bucket, sourceKey))
            await using (var input = File.Create(inputPath))
            {
                await source.ResponseStream.CopyToAsync(input);
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
            foreach (var argument in new[]
            {
                "-y", "-i", inputPath, "-t", "8", "-vf", "scale=440:-2", "-an",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
                "-profile:v", "main", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath
            })
                process.StartInfo.ArgumentList.Add(argument);

            process.Start();
            var error = await process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            if (process.ExitCode != 0 || !File.Exists(outputPath))
                throw new InvalidOperationException($"ffmpeg не смог создать превью видео: {error}");

            await using var preview = File.OpenRead(outputPath);
            await UploadObjectAsync(previewKey, preview, "video/mp4");
            return previewKey;
        }
        finally
        {
            tempDirectory.Delete(true);
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

    public Task<GetObjectResponse> GetObjectAsync(string objectKey) =>
        _s3.GetObjectAsync(_bucket, objectKey);

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
