using System.Collections.Concurrent;
using System.Threading.Channels;
using Feed.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Feed.Api.Services;

public sealed class ImagePreviewBackgroundService : BackgroundService
{
    private readonly Channel<ImagePreviewJob> _priorityJobs;
    private readonly Channel<ImagePreviewJob> _secondaryJobs;
    private readonly SemaphoreSlim _jobSignal = new(0);
    private readonly ConcurrentDictionary<ImagePreviewJob, byte> _pending = new();
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
        var queueCapacity = Math.Clamp(
            _configuration.GetValue<int?>("PreviewWorker:QueueCapacity") ?? 200,
            10,
            2_000);
        _priorityJobs = CreateQueue(queueCapacity);
        _secondaryJobs = CreateQueue(queueCapacity);
    }

    public void Enqueue(string storageKey, string contentType)
    {
        if (contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            var feedJob = new ImagePreviewJob(
                storageKey,
                contentType,
                ImagePreviewVariant.Feed);
            TryEnqueue(feedJob, _priorityJobs.Writer);
            return;
        }

        if (contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase))
            TryEnqueue(new ImagePreviewJob(storageKey, contentType), _secondaryJobs.Writer);
    }

    public void Forget(string storageKey)
    {
        foreach (var job in _pending.Keys.Where(job => job.StorageKey == storageKey))
            _pending.TryRemove(job, out _);
    }

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
        while (!stoppingToken.IsCancellationRequested)
        {
            var job = await ReadNextJobAsync(stoppingToken);
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var storage = scope.ServiceProvider.GetRequiredService<IStorageService>();
                ImagePreviewResult? preview = null;
                if (job.Variant is { } variant)
                    preview = await storage.CreateImagePreviewAsync(
                        job.StorageKey,
                        job.ContentType,
                        variant);
                else
                    await storage.CreateVideoPreviewAsync(job.StorageKey, job.ContentType);

                if (job.Variant == ImagePreviewVariant.Feed)
                {
                    TryEnqueue(
                        new ImagePreviewJob(
                            job.StorageKey,
                            job.ContentType,
                            ImagePreviewVariant.Standard),
                        _secondaryJobs.Writer);
                    TryEnqueue(
                        new ImagePreviewJob(
                            job.StorageKey,
                            job.ContentType,
                            ImagePreviewVariant.Icon),
                        _secondaryJobs.Writer);
                }

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
                _pending.TryRemove(job, out _);
            }
        }
    }

    private async Task<ImagePreviewJob> ReadNextJobAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            if (_priorityJobs.Reader.TryRead(out var job))
            {
                _jobSignal.Wait(0);
                return job;
            }
            if (_secondaryJobs.Reader.TryRead(out job))
            {
                _jobSignal.Wait(0);
                return job;
            }

            await _jobSignal.WaitAsync(cancellationToken);
        }
    }

    private bool TryEnqueue(
        ImagePreviewJob job,
        ChannelWriter<ImagePreviewJob> writer)
    {
        if (!_pending.TryAdd(job, 0))
            return true;

        if (writer.TryWrite(job))
        {
            _jobSignal.Release();
            return true;
        }

        _pending.TryRemove(job, out _);
        _logger.LogWarning(
            "Preview queue is full; postponing preview for {StorageKey}",
            job.StorageKey);
        return false;
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

            var imageFiles = files.Concat(postFiles).Concat(commentFiles).Concat(archivedFiles)
                .DistinctBy(file => file.StorageKey)
                .Where(file => storage.GetImagePreviewObjectKeys(file.StorageKey)
                    .Any(previewKey => !existingPreviews.Contains(previewKey)))
                .ToArray();

            foreach (var file in imageFiles)
                await EnqueueReconciledJobAsync(
                    new ImagePreviewJob(file.StorageKey, file.ContentType, ImagePreviewVariant.Feed),
                    _priorityJobs.Writer,
                    cancellationToken);

            foreach (var file in videoFiles.DistinctBy(file => file.StorageKey))
            {
                if (storage.GetVideoPreviewObjectKeys(file.StorageKey)
                    .Any(previewKey => !existingPreviews.Contains(previewKey)))
                    await EnqueueReconciledJobAsync(
                        new ImagePreviewJob(file.StorageKey, file.ContentType),
                        _secondaryJobs.Writer,
                        cancellationToken);
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

    private async ValueTask EnqueueReconciledJobAsync(
        ImagePreviewJob job,
        ChannelWriter<ImagePreviewJob> writer,
        CancellationToken cancellationToken)
    {
        if (!_pending.TryAdd(job, 0))
            return;

        try
        {
            await writer.WriteAsync(job, cancellationToken);
            _jobSignal.Release();
        }
        catch
        {
            _pending.TryRemove(job, out _);
            throw;
        }
    }

    private static Channel<ImagePreviewJob> CreateQueue(int capacity) =>
        Channel.CreateBounded<ImagePreviewJob>(new BoundedChannelOptions(capacity)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleWriter = false,
            SingleReader = false
        });

    private sealed record ImagePreviewJob(
        string StorageKey,
        string ContentType,
        ImagePreviewVariant? Variant = null);
}
