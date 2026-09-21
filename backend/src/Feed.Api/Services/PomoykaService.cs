using Feed.Api.Data;
using Feed.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Feed.Api.Services;

/// <summary>
/// Service for managing daily Pomoykas and archival operations.
/// </summary>
public class PomoykaService
{
    private readonly AppDbContext _context;
    private readonly ILogger<PomoykaService> _logger;

    public PomoykaService(
        AppDbContext context,
        ILogger<PomoykaService> logger)
    {
        _context = context;
        _logger = logger;
    }

    /// <summary>
    /// Gets today's Pomoyka.
    /// Creates it if it does not exist.
    /// Today is determined using Moscow timezone.
    /// </summary>
    public async Task<Pomoyka> GetOrCreateTodaysPomoykaAsync(
        CancellationToken cancellationToken = default)
    {
        var moscowTz = TimeZoneInfo.FindSystemTimeZoneById("Europe/Moscow");

        var nowMoscow = TimeZoneInfo.ConvertTimeFromUtc(
            DateTime.UtcNow,
            moscowTz);

        var today = DateOnly.FromDateTime(nowMoscow);

        var existing = await _context.Pomoykas
            .FirstOrDefaultAsync(
                x => x.Date == today,
                cancellationToken);

        if (existing != null)
        {
            return existing;
        }

        try
        {
            var newPomoyka = new Pomoyka
            {
                Date = today,
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };

            _context.Pomoykas.Add(newPomoyka);

            await _context.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Created new Pomoyka for date {Date}",
                today);

            return newPomoyka;
        }
        catch (DbUpdateException ex)
            when (ex.InnerException?.Message.Contains("duplicate") == true)
        {
            _logger.LogInformation(
                "Race condition detected while creating Pomoyka for {Date}, retrying",
                today);

            var retry = await _context.Pomoykas
                .FirstOrDefaultAsync(
                    x => x.Date == today,
                    cancellationToken);

            if (retry == null)
            {
                throw;
            }

            return retry;
        }
    }

    /// <summary>
    /// Gets a specific Pomoyka by date.
    /// </summary>
    public async Task<Pomoyka?> GetPomoykaByDateAsync(
        DateOnly date,
        CancellationToken cancellationToken = default)
    {
        return await _context.Pomoykas
            .FirstOrDefaultAsync(
                x => x.Date == date,
                cancellationToken);
    }

    /// <summary>
    /// Archives a Pomoyka for the specified date.
    ///
    /// The entire operation happens inside one transaction:
    /// 1. Finds the active Pomoyka.
    /// 2. Gets its posts and dependencies.
    /// 3. Creates ArchiveDay.
    /// 4. Copies posts into ArchivedPosts.
    /// 5. Copies files, blocks, comments and likes.
    /// 6. Deletes original posts.
    /// 7. Marks Pomoyka as inactive.
    /// 8. Commits everything atomically.
    /// </summary>
    public async Task ArchivePomoykaAsync(
        DateOnly date,
        CancellationToken cancellationToken = default)
    {
        await using var transaction =
            await _context.Database.BeginTransactionAsync(
                System.Data.IsolationLevel.Serializable,
                cancellationToken);

        try
        {
            var pomoyka = await _context.Pomoykas
                .Where(x =>
                    x.Date == date &&
                    x.IsActive)
                .FirstOrDefaultAsync(cancellationToken);

            if (pomoyka == null)
            {
                _logger.LogInformation(
                    "Pomoyka for date {Date} does not exist or is already archived",
                    date);

                await transaction.CommitAsync(cancellationToken);
                return;
            }

            var posts = await _context.Posts
                .Where(x => x.PomoykaId == pomoyka.Id && !x.IsPostishka)
                .Include(x => x.Files)
                .Include(x => x.Blocks)
                .Include(x => x.Comments)
                .Include(x => x.Likes)
                .AsSplitQuery()
                .ToListAsync(cancellationToken);

            var postishkaCount = await _context.Posts
                .CountAsync(x => x.PomoykaId == pomoyka.Id && x.IsPostishka, cancellationToken);

            var archiveDay = new ArchiveDay
            {
                Date = date,
                PostCount = posts.Count,
                PostishkaCount = postishkaCount,
                ParticipantCount = posts
                    .Select(x => x.AuthorId)
                    .Distinct()
                    .Count(),
                ClosedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow
            };

            _context.ArchiveDays.Add(archiveDay);

            await _context.SaveChangesAsync(cancellationToken);

            foreach (var post in posts)
            {
                var archivedPost = new ArchivedPost
                {
                    Id = Guid.NewGuid(),
                    ArchiveDayId = archiveDay.Id,
                    AuthorId = post.AuthorId,
                    Text = post.Text,
                    Title = post.Title,
                    CreatedAt = post.CreatedAt
                };

                var archivedFileIds = new Dictionary<Guid, Guid>();

                foreach (var file in post.Files)
                {
                    var archivedFileId = Guid.NewGuid();

                    archivedFileIds[file.Id] = archivedFileId;

                    archivedPost.Files.Add(
                        new ArchivedPostFile
                        {
                            Id = archivedFileId,
                            ArchivedPostId = archivedPost.Id,
                            FileName = file.FileName,

                            StorageKey = file.StorageKey,

                            ContentType = file.ContentType,
                            SizeBytes = file.SizeBytes,
                            UploadedAt = file.UploadedAt
                        });
                }

                foreach (var block in post.Blocks)
                {
                    archivedPost.Blocks.Add(
                        new ArchivedPostBlock
                        {
                            Id = Guid.NewGuid(),
                            ArchivedPostId = archivedPost.Id,
                            SortOrder = block.SortOrder,
                            Type = block.Type,
                            Text = block.Text,

                            FileId =
                                block.FileId.HasValue &&
                                archivedFileIds.TryGetValue(
                                    block.FileId.Value,
                                    out var archivedFileId)
                                    ? archivedFileId
                                    : null
                        });
                }

                foreach (var comment in post.Comments)
                {
                    archivedPost.Comments.Add(
                        new ArchivedPostComment
                        {
                            Id = Guid.NewGuid(),
                            ArchivedPostId = archivedPost.Id,
                            AuthorId = comment.AuthorId,
                            Text = comment.Text,
                            CreatedAt = comment.CreatedAt
                        });
                }

                foreach (var like in post.Likes)
                {
                    archivedPost.Likes.Add(
                        new ArchivedPostLike
                        {
                            ArchivedPostId = archivedPost.Id,
                            UserId = like.UserId
                        });
                }

                _context.ArchivedPosts.Add(archivedPost);
            }

            await _context.SaveChangesAsync(cancellationToken);

            _context.Posts.RemoveRange(posts);

            pomoyka.IsActive = false;
            pomoyka.ClosedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);

            _logger.LogInformation(
                "Successfully archived Pomoyka for date {Date}: {PostCount} posts moved to archive",
                date,
                posts.Count);
        }
        catch (OperationCanceledException)
        {
            await transaction.RollbackAsync(CancellationToken.None);
            throw;
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(CancellationToken.None);

            _logger.LogError(
                ex,
                "Error archiving Pomoyka for date {Date}",
                date);

            throw;
        }
    }

    /// <summary>
    /// Archives every active Pomoyka older than today.
    ///
    /// This is what allows the application to recover after
    /// being offline for one or more days.
    /// </summary>
    public async Task<int> ArchiveAllExpiredPomoykasAsync(
        DateOnly today,
        CancellationToken cancellationToken = default)
    {
        var expiredPomoykas = await _context.Pomoykas
            .Where(x =>
                x.IsActive &&
                x.Date < today)
            .OrderBy(x => x.Date)
            .Select(x => x.Date)
            .ToListAsync(cancellationToken);

        var archivedCount = 0;

        foreach (var date in expiredPomoykas)
        {
            cancellationToken.ThrowIfCancellationRequested();

            await ArchivePomoykaAsync(
                date,
                cancellationToken);

            archivedCount++;
        }

        return archivedCount;
    }

    /// <summary>
    /// Gets an archive day by date.
    /// </summary>
    public async Task<ArchiveDay?> GetArchiveDayAsync(
        DateOnly date,
        CancellationToken cancellationToken = default)
    {
        return await _context.ArchiveDays
            .FirstOrDefaultAsync(
                x => x.Date == date,
                cancellationToken);
    }

    /// <summary>
    /// Gets all archive days for a given year and month.
    /// </summary>
    public async Task<List<ArchiveDay>> GetArchiveDaysForMonthAsync(
        int year,
        int month,
        CancellationToken cancellationToken = default)
    {
        var startDate = new DateOnly(year, month, 1);
        var endDate = startDate
            .AddMonths(1)
            .AddDays(-1);

        return await _context.ArchiveDays
            .Where(x =>
                x.Date >= startDate &&
                x.Date <= endDate)
            .OrderBy(x => x.Date)
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// Gets archived posts for a specific day with pagination.
    /// </summary>
    public async Task<(List<ArchivedPost> Posts, int Total)>
        GetArchivedPostsForDayAsync(
            DateOnly date,
            int skip = 0,
            int take = 20,
            CancellationToken cancellationToken = default)
    {
        var archiveDay =
            await GetArchiveDayAsync(
                date,
                cancellationToken);

        if (archiveDay == null)
        {
            return (
                new List<ArchivedPost>(),
                0);
        }

        var query = _context.ArchivedPosts
            .Where(x =>
                x.ArchiveDayId == archiveDay.Id)
            .OrderByDescending(x => x.CreatedAt);

        var total =
            await query.CountAsync(cancellationToken);

        var posts = await query
            .Skip(skip)
            .Take(take)
            .Include(x => x.Author)
            .Include(x => x.Files)
            .Include(x => x.Blocks)
            .Include(x => x.Comments)
            .Include(x => x.Likes)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        return (
            posts,
            total);
    }
}
