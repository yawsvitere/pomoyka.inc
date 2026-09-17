using Feed.Api.Services;

namespace Feed.Api.Services;

public class ArchivalBackgroundService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<ArchivalBackgroundService> _logger;

    private static readonly TimeSpan CheckInterval =
        TimeSpan.FromMinutes(1);

    public ArchivalBackgroundService(
        IServiceProvider serviceProvider,
        ILogger<ArchivalBackgroundService> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(
        CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "Archival background service started");

        await RunArchivalCheckAsync(stoppingToken);

        using var timer =
            new PeriodicTimer(CheckInterval);

        try
        {
            while (await timer.WaitForNextTickAsync(
                stoppingToken))
            {
                await RunArchivalCheckAsync(
                    stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation(
                "Archival background service is shutting down");
        }
    }

    private async Task RunArchivalCheckAsync(
        CancellationToken cancellationToken)
    {
        try
        {
            using var scope =
                _serviceProvider.CreateScope();

            var pomojkaService =
                scope.ServiceProvider
                    .GetRequiredService<PomojkaService>();

            var moscowTimeZone =
                TimeZoneInfo.FindSystemTimeZoneById(
                    "Europe/Moscow");

            var nowMoscow =
                TimeZoneInfo.ConvertTimeFromUtc(
                    DateTime.UtcNow,
                    moscowTimeZone);

            var today =
                DateOnly.FromDateTime(nowMoscow);

            _logger.LogDebug(
                "Checking expired Pomojkas. Today: {Date}",
                today);

            var archivedCount =
                await pomojkaService
                    .ArchiveAllExpiredPomojkasAsync(
                        today,
                        cancellationToken);

            if (archivedCount > 0)
            {
                _logger.LogInformation(
                    "Archived {Count} expired Pomojka(s)",
                    archivedCount);
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Error while checking Pomojkas for archival");
        }
    }
}