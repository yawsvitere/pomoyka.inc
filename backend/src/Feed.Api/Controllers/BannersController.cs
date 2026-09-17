using Feed.Api.Data;
using Feed.Api.Models.Dto;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Feed.Api.Controllers;

[ApiController]
[Route("api/banners")]
[Authorize]
public class BannersController : ControllerBase
{
    private readonly AppDbContext _db;

    public BannersController(AppDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<ActionResult<List<FeedBannerDto>>> GetBanners()
    {
        var banners = await _db.FeedBanners
            .AsNoTracking()
            .Include(x => x.Post)
                .ThenInclude(x => x!.Files)
            .Where(x => x.Post != null && x.Post.IsPostishka)
            .OrderBy(x => x.SortOrder)
            .ToListAsync();

        return Ok(banners.Select(ToDto).ToList());
    }

    private FeedBannerDto ToDto(Models.FeedBanner banner) => new()
    {
        Id = banner.Id,
        PostId = banner.PostId,
        Title = banner.Post?.Title?.Trim() ?? "Без названия",
        CreatedAt = banner.Post?.CreatedAt ?? DateTime.UtcNow,
        ImageUrl = banner.Post?.Files
            .FirstOrDefault(file => file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)) is { } image
            ? $"/api/files/post/{image.Id}/download"
            : null
    };
}
