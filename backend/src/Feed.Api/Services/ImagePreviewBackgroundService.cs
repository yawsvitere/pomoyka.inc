using System.Collections.Concurrent;
using System.Threading.Channels;
using Feed.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Feed.Api.Services;

public sealed class ImagePreviewBackgroundService : BackgroundService
{
    private readonly Channel<ImagePreviewJob> _jobs;
    private readonly ConcurrentDictionary<string, byte> _pending = new(StringComparer.Ordinal);
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ImagePreviewBackgroundService> _logger;
    private readonly IConfiguration _configuration;

    public ImagePreviewBackgroundService(
        IServiceScopeFactory scopeFactory,
        ILogger<ImagePreviewBackgroundService> logger,
        IConfiguration configuration)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _configuration = configuration;
        _jobs = Channel.CreateBounded<ImagePreviewJob>(new BoundedChannelOptions(
            Math.Clamp(_configuration.GetValue<int?>("PreviewWorker:QueueCapacity") ?? 200, 10, 2_000))
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleWriter = false,
            SingleReader = false
        });
    }

    public void Enqueue(string storageKey, string contentType)
    {
        if (!_pending.TryAdd(storageKey, 0))
            return;

        if (!_jobs.Writer.TryWrite(new ImagePreviewJob(storageKey, contentType)))
        {
            _pending.TryRemove(storageKey, out _);
            _logger.LogWarning("Preview queue is full; postponing preview for {StorageKey}", storageKey);
        }
    }

    public void Forget(string storageKey) => _pending.TryRemove(storageKey, out _);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var workerCount = Math.Clamp(
            _configuration.GetValue<int?>("PreviewWorker:Concurrency") ?? 2,
            1,
            4);
        var workers = Enumerable.Range(0, workerCount)
            .Select(_ => ProcessQueueAsync(stoppingToken));
        await Task.WhenAll(workers.Append(EnqueueMissingPreviewsAsync(stoppingToken)));
    }

    private async Task ProcessQueueAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in _jobs.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var storage = scope.ServiceProvider.GetRequiredService<IStorageService>();
                var preview = job.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)
                    ? null
                    : await storage.CreateImagePreviewAsync(job.StorageKey, job.ContentType);
                if (job.ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
                    await storage.CreateVideoPreviewAsync(job.StorageKey, job.ContentType);
                if (preview is { Width: > 0, Height: > 0 })
                {
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    var file = await db.UserFiles.FirstOrDefaultAsync(
                        item => item.StorageKey == job.StorageKey,
                        stoppingToken);
                    if (file != null)
                    {
                        file.Width = preview.Width;
                        file.Height = preview.Height;
                        await db.SaveChangesAsync(stoppingToken);
                    }
                }

                var cleanup = scope.ServiceProvider
                    .GetRequiredService<ContentAddressedPreviewCleanupService>();
                await cleanup.DeleteUnusedPreviewsAsync(
                    new[] { (job.StorageKey, job.ContentType) });
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                _logger.LogError(
                    exception,
                    "Failed to create image preview for {StorageKey}",
                    job.StorageKey);
            }
            finally
            {
                _pending.TryRemove(job.StorageKey, out _);
            }
        }
    }

    private async Task EnqueueMissingPreviewsAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var storage = scope.ServiceProvider.GetRequiredService<IStorageService>();
            var existingPreviews = (await storage.ListObjectKeysAsync("previews/"))
                .ToHashSet(StringComparer.Ordinal);
            var files = await db.UserFiles
                .AsNoTracking()
                .Where(file => file.ContentType.StartsWith("image/"))
                .Select(file => new { file.StorageKey, file.ContentType })
                .ToListAsync(cancellationToken);
            var postFiles = await db.PostFiles
                .AsNoTracking()
                .Where(file => file.ContentType.StartsWith("image/"))
                .Select(file => new { file.StorageKey, file.ContentType })
                .ToListAsync(cancellationToken);
            var commentFiles = await db.CommentFiles
                .AsNoTracking()
                .Where(file => file.ContentType.StartsWith("image/"))
                .Select(file => new { file.StorageKey, file.ContentType })
                .ToListAsync(cancellationToken);
            var archivedFiles = await db.ArchivedPostFiles
                .AsNoTracking()
                .Where(file => file.ContentType.StartsWith("image/"))
                .Select(file => new { file.StorageKey, file.ContentType })
                .ToListAsync(cancellationToken);

            var videoFiles = await db.UserFiles
                .AsNoTracking()
                .Where(file => file.ContentType.StartsWith("video/"))
                .Select(file => new { file.StorageKey, file.ContentType })
                .ToListAsync(cancellationToken);

            foreach (var file in files.Concat(postFiles).Concat(commentFiles).Concat(archivedFiles)
                .DistinctBy(file => file.StorageKey))
            {
                if (storage.GetImagePreviewObjectKeys(file.StorageKey)
                    .Any(previewKey => !existingPreviews.Contains(previewKey)))
                    await EnqueueReconciledAsync(file.StorageKey, file.ContentType, cancellationToken);
            }

            foreach (var file in videoFiles.DistinctBy(file => file.StorageKey))
            {
                if (storage.GetVideoPreviewObjectKeys(file.StorageKey)
                    .Any(previewKey => !existingPreviews.Contains(previewKey)))
                    await EnqueueReconciledAsync(file.StorageKey, file.ContentType, cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Failed to enqueue existing image previews");
        }
    }

    private async ValueTask EnqueueReconciledAsync(
        string storageKey,
        string contentType,
        CancellationToken cancellationToken)
    {
        if (!_pending.TryAdd(storageKey, 0))
            return;

        try
        {
            await _jobs.Writer.WriteAsync(new ImagePreviewJob(storageKey, contentType), cancellationToken);
        }
        catch
        {
            _pending.TryRemove(storageKey, out _);
            throw;
        }
    }

    private sealed record ImagePreviewJob(string StorageKey, string ContentType);
}
