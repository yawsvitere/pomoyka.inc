using Feed.Api.Data;
using Feed.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Feed.Api.Services;

/// <summary>
/// Service for managing daily Pomojkas and archival operations.
/// </summary>
public class PomojkaService
{
    private readonly AppDbContext _context;
    private readonly ILogger<PomojkaService> _logger;

    public PomojkaService(
        AppDbContext context,
        ILogger<PomojkaService> logger)
    {
        _context = context;
        _logger = logger;
    }

    /// <summary>
    /// Gets today's Pomojka.
    /// Creates it if it does not exist.
    /// Today is determined using Moscow timezone.
    /// </summary>
    public async Task<Pomojka> GetOrCreateTodaysPomojkaAsync(
        CancellationToken cancellationToken = default)
    {
        var moscowTz = TimeZoneInfo.FindSystemTimeZoneById("Europe/Moscow");

        var nowMoscow = TimeZoneInfo.ConvertTimeFromUtc(
            DateTime.UtcNow,
            moscowTz);

        var today = DateOnly.FromDateTime(nowMoscow);

        var existing = await _context.Pomojkas
            .FirstOrDefaultAsync(
                x => x.Date == today,
                cancellationToken);

        if (existing != null)
        {
            return existing;
        }

        try
        {
            var newPomojka = new Pomojka
            {
                Date = today,
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };

            _context.Pomojkas.Add(newPomojka);

            await _context.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Created new Pomojka for date {Date}",
                today);

            return newPomojka;
        }
        catch (DbUpdateException ex)
            when (ex.InnerException?.Message.Contains("duplicate") == true)
        {
            _logger.LogInformation(
                "Race condition detected while creating Pomojka for {Date}, retrying",
                today);

            var retry = await _context.Pomojkas
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
    /// Gets a specific Pomojka by date.
    /// </summary>
    public async Task<Pomojka?> GetPomojkaByDateAsync(
        DateOnly date,
        CancellationToken cancellationToken = default)
    {
        return await _context.Pomojkas
            .FirstOrDefaultAsync(
                x => x.Date == date,
                cancellationToken);
    }

    /// <summary>
    /// Archives a Pomojka for the specified date.
    ///
    /// The entire operation happens inside one transaction:
    /// 1. Finds the active Pomojka.
    /// 2. Gets its posts and dependencies.
    /// 3. Creates ArchiveDay.
    /// 4. Copies posts into ArchivedPosts.
    /// 5. Copies files, blocks, comments and likes.
    /// 6. Deletes original posts.
    /// 7. Marks Pomojka as inactive.
    /// 8. Commits everything atomically.
    /// </summary>
    public async Task ArchivePomojkaAsync(
        DateOnly date,
        CancellationToken cancellationToken = default)
    {
        await using var transaction =
            await _context.Database.BeginTransactionAsync(
                System.Data.IsolationLevel.Serializable,
                cancellationToken);

        try
        {
            var pomojka = await _context.Pomojkas
                .Where(x =>
                    x.Date == date &&
                    x.IsActive)
                .FirstOrDefaultAsync(cancellationToken);

            if (pomojka == null)
            {
                _logger.LogInformation(
                    "Pomojka for date {Date} does not exist or is already archived",
                    date);

                await transaction.CommitAsync(cancellationToken);
                return;
            }

            var posts = await _context.Posts
                .Where(x => x.PomojkaId == pomojka.Id && !x.IsPostishka)
                .Include(x => x.Files)
                .Include(x => x.Blocks)
                .Include(x => x.Comments)
                .Include(x => x.Likes)
                .AsSplitQuery()
                .ToListAsync(cancellationToken);

            var postishkaCount = await _context.Posts
                .CountAsync(x => x.PomojkaId == pomojka.Id && x.IsPostishka, cancellationToken);

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

            pomojka.IsActive = false;
            pomojka.ClosedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);

            _logger.LogInformation(
                "Successfully archived Pomojka for date {Date}: {PostCount} posts moved to archive",
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
                "Error archiving Pomojka for date {Date}",
                date);

            throw;
        }
    }

    /// <summary>
    /// Archives every active Pomojka older than today.
    ///
    /// This is what allows the application to recover after
    /// being offline for one or more days.
    /// </summary>
    public async Task<int> ArchiveAllExpiredPomojkasAsync(
        DateOnly today,
        CancellationToken cancellationToken = default)
    {
        var expiredPomojkas = await _context.Pomojkas
            .Where(x =>
                x.IsActive &&
                x.Date < today)
            .OrderBy(x => x.Date)
            .Select(x => x.Date)
            .ToListAsync(cancellationToken);

        var archivedCount = 0;

        foreach (var date in expiredPomojkas)
        {
            cancellationToken.ThrowIfCancellationRequested();

            await ArchivePomojkaAsync(
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
