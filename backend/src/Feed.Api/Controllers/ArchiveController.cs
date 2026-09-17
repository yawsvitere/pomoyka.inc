using System.Security.Claims;
using Feed.Api.Models;
using Feed.Api.Models.Dto;
using Feed.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Feed.Api.Controllers;

[ApiController]
[Route("api/archive")]
public class ArchiveController : ControllerBase
{
    private readonly PomojkaService _pomojkaService;
    private readonly IStorageService _storage;
    private readonly ILogger<ArchiveController> _logger;

    public ArchiveController(
        PomojkaService pomojkaService,
        IStorageService storage,
        ILogger<ArchiveController> logger)
    {
        _pomojkaService = pomojkaService;
        _storage = storage;
        _logger = logger;
    }

    /// <summary>
    /// Gets calendar data for a specific month (list of archive days).
    /// Used to display archive calendar view.
    /// </summary>
    [HttpGet("calendar/{year:int}/{month:int}")]
    [AllowAnonymous]
    public async Task<ActionResult<ArchiveCalendarDto>> GetCalendar(int year, int month)
    {
        if (month < 1 || month > 12)
            return BadRequest(new { message = "Month must be between 1 and 12" });

        var archiveDays = await _pomojkaService.GetArchiveDaysForMonthAsync(year, month);

        var calendar = new ArchiveCalendarDto
        {
            Year = year,
            Month = month,
            Days = archiveDays.Select(d => new ArchiveDayDto
            {
                Date = d.Date,
                PostCount = d.PostCount,
                PostishkaCount = d.PostishkaCount,
                ParticipantCount = d.ParticipantCount,
                ClosedAt = d.ClosedAt
            }).ToList()
        };

        return Ok(calendar);
    }

    /// <summary>
    /// Gets all archived posts for a specific day.
    /// </summary>
    [HttpGet("{year:int}/{month:int}/{day:int}")]
    [AllowAnonymous]
    public async Task<ActionResult<ArchiveDayDetailDto>> GetArchiveDay(
        int year, int month, int day,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 100) pageSize = 100;

        try
        {
            var date = new DateOnly(year, month, day);
            var archiveDay = await _pomojkaService.GetArchiveDayAsync(date);

            if (archiveDay == null)
                return NotFound(new { message = $"No archive found for {date}" });

            // Получаем посты с пагинацией
            var (posts, total) = await _pomojkaService.GetArchivedPostsForDayAsync(date, (page - 1) * pageSize, pageSize);

            var detail = new ArchiveDayDetailDto
            {
                Date = date,
                PostCount = archiveDay.PostCount,
                PostishkaCount = archiveDay.PostishkaCount,
                ParticipantCount = archiveDay.ParticipantCount,
                ClosedAt = archiveDay.ClosedAt,
                Posts = posts.Select(ToArchivedPostDto).ToList(),
                Pagination = new PaginationDto
                {
                    Page = page,
                    PageSize = pageSize,
                    Total = total,
                    TotalPages = (total + pageSize - 1) / pageSize
                }
            };

            return Ok(detail);
        }
        catch (ArgumentOutOfRangeException)
        {
            return BadRequest(new { message = "Invalid date" });
        }
    }

    /// <summary>
    /// Gets a specific archived post with all its details.
    /// </summary>
    [HttpGet("post/{id:guid}")]
    [AllowAnonymous]
    public async Task<ActionResult<ArchivedPostDto>> GetArchivedPost(Guid id)
    {
        // Для простоты, можно использовать DbContext напрямую здесь
        // В реальном приложении это должен быть метод в PomojkaService
        var app = HttpContext.RequestServices;
        var db = app.GetRequiredService<Feed.Api.Data.AppDbContext>();

        var post = await db.ArchivedPosts
            .AsNoTracking()
            .Where(p => p.Id == id)
            .Include(p => p.Author)
            .Include(p => p.Files)
            .Include(p => p.Blocks).ThenInclude(b => b.File)
            .Include(p => p.Comments).ThenInclude(c => c.Author)
            .Include(p => p.Comments).ThenInclude(c => c.Likes)
            .Include(p => p.Likes)
            .AsSplitQuery()
            .FirstOrDefaultAsync();

        if (post == null)
            return NotFound();

        return Ok(ToArchivedPostDto(post));
    }

    private ArchivedPostDto ToArchivedPostDto(ArchivedPost post)
    {
        var userId = GetUserId();

        return new ArchivedPostDto
        {
            Id = post.Id,
            Text = post.Text,
            Title = post.Title,
            IsArticle = !string.IsNullOrWhiteSpace(post.Title),
            CreatedAt = post.CreatedAt,

            Blocks = post.Blocks.OrderBy(b => b.SortOrder).Select(b => new PostBlockDto
            {
                Id = b.Id,
                SortOrder = b.SortOrder,
                Type = b.Type,
                Text = b.Text,
                File = b.File == null ? null : ToArchivedFileDto(b.File)
            }).ToList(),

            Author = new UserDto
            {
                Id = post.Author!.Id,
                Email = post.Author.Email ?? string.Empty,
                DisplayName = post.Author.DisplayName,
                AvatarUrl = post.Author.AvatarUrl == null ? null : $"/api/files/avatar/{post.Author.Id}?v={Uri.EscapeDataString(post.Author.AvatarUrl)}"
            },

            Files = post.Files
                .Select(ToArchivedFileDto)
                .ToList(),

            Comments = post.Comments
                .OrderBy(c => c.CreatedAt)
                .Select(c => new CommentDto
                {
                    Id = c.Id,
                    Text = c.Text,
                    CreatedAt = c.CreatedAt,
                    Author = new UserDto
                    {
                        Id = c.Author!.Id,
                        Email = c.Author.Email ?? string.Empty,
                        DisplayName = c.Author.DisplayName,
                        AvatarUrl = c.Author.AvatarUrl == null ? null : $"/api/files/avatar/{c.Author.Id}?v={Uri.EscapeDataString(c.Author.AvatarUrl)}"
                    },
                    LikeCount = c.Likes.Count,
                    IsLiked = c.Likes.Any(l => l.UserId == userId)
                })
                .ToList(),
            LikeCount = post.Likes.Count,
            IsLiked = post.Likes.Any(l => l.UserId == userId)
        };
    }

    private PostFileDto ToArchivedFileDto(ArchivedPostFile file) => new()
    {
        Id = file.Id,
        FileName = file.FileName,
        ContentType = file.ContentType,
        SizeBytes = file.SizeBytes,
        DownloadUrl = $"{Request.Scheme}://{Request.Host}/api/files/archive/{file.Id}/download"
    };

    private Guid? GetUserId()
    {
        var value = User.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue(System.Security.Claims.ClaimTypes.NameIdentifier);

        if (Guid.TryParse(value, out var userId))
        {
            return userId;
        }

        return null;
    }
}

// DTOs for Archive Endpoints
public class ArchiveCalendarDto
{
    public int Year { get; set; }
    public int Month { get; set; }
    public List<ArchiveDayDto> Days { get; set; } = new();
}

public class ArchiveDayDto
{
    public DateOnly Date { get; set; }
    public int PostCount { get; set; }
    public int PostishkaCount { get; set; }
    public int ParticipantCount { get; set; }
    public DateTime ClosedAt { get; set; }
}

public class ArchiveDayDetailDto
{
    public DateOnly Date { get; set; }
    public int PostCount { get; set; }
    public int PostishkaCount { get; set; }
    public int ParticipantCount { get; set; }
    public DateTime ClosedAt { get; set; }
    public List<ArchivedPostDto> Posts { get; set; } = new();
    public PaginationDto Pagination { get; set; } = new();
}

public class ArchivedPostDto : PostDto
{
}

public class PaginationDto
{
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int Total { get; set; }
    public int TotalPages { get; set; }
}
