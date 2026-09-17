using Feed.Api.Data;
using Microsoft.EntityFrameworkCore;
using SixLabors.ImageSharp;

namespace Feed.Api.Services;

public sealed class FileMetadataBackfillService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<FileMetadataBackfillService> _logger;

    public FileMetadataBackfillService(
        IServiceProvider serviceProvider,
        ILogger<FileMetadataBackfillService> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await BackfillImagesAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Failed to backfill file dimensions");
        }
    }

    private async Task BackfillImagesAsync(CancellationToken cancellationToken)
    {
        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var storage = scope.ServiceProvider.GetRequiredService<IStorageService>();
        var files = await db.UserFiles
            .Where(file =>
                (file.Width == null || file.Height == null) &&
                file.ContentType.StartsWith("image/"))
            .ToListAsync(cancellationToken);

        var updated = 0;
        foreach (var file in files)
        {
            try
            {
                var objectResponse = await storage.GetObjectAsync(file.StorageKey);
                await using var stream = objectResponse.ResponseStream;
                using var image = await Image.LoadAsync(stream, cancellationToken);
                file.Width = image.Width;
                file.Height = image.Height;
                updated += 1;
            }
            catch (Exception exception)
            {
                _logger.LogWarning(
                    exception,
                    "Could not read dimensions for file {FileId}",
                    file.Id);
            }
        }

        if (updated > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
        }

        _logger.LogInformation(
            "File metadata backfill completed: {Updated} of {Total} image(s) updated",
            updated,
            files.Count);
    }
}
