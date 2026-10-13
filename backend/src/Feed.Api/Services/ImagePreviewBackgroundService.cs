using System.Collections.Concurrent;
using System.Threading.Channels;
using Feed.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Feed.Api.Services;

public sealed class ImagePreviewBackgroundService : BackgroundService
{
    private readonly Channel<ImagePreviewJob> _jobs = Channel.CreateUnbounded<ImagePreviewJob>();
    private readonly ConcurrentDictionary<string, byte> _pending = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, byte> _completed = new(StringComparer.Ordinal);
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ImagePreviewBackgroundService> _logger;

    public ImagePreviewBackgroundService(
        IServiceScopeFactory scopeFactory,
        ILogger<ImagePreviewBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    public void Enqueue(string storageKey, string contentType)
    {
        if (_completed.ContainsKey(storageKey) || !_pending.TryAdd(storageKey, 0))
            return;

        if (!_jobs.Writer.TryWrite(new ImagePreviewJob(storageKey, contentType)))
        {
            _pending.TryRemove(storageKey, out _);
            throw new InvalidOperationException("Could not enqueue image preview generation.");
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await EnqueueMissingPreviewsAsync(stoppingToken);

        await foreach (var job in _jobs.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var storage = scope.ServiceProvider.GetRequiredService<IStorageService>();
                var preview = await storage.CreateImagePreviewAsync(job.StorageKey, job.ContentType);
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

                _completed.TryAdd(job.StorageKey, 0);
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
            var archivedFiles = await db.ArchivedPostFiles
                .AsNoTracking()
                .Where(file => file.ContentType.StartsWith("image/"))
                .Select(file => new { file.StorageKey, file.ContentType })
                .ToListAsync(cancellationToken);

            foreach (var file in files.Concat(postFiles).Concat(archivedFiles).DistinctBy(file => file.StorageKey))
            {
                if (!existingPreviews.Contains(storage.GetPreviewObjectKey(file.StorageKey)))
                    Enqueue(file.StorageKey, file.ContentType);
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

    private sealed record ImagePreviewJob(string StorageKey, string ContentType);
}
