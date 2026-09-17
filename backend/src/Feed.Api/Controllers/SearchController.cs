using System.Globalization;
using Feed.Api.Data;
using Feed.Api.Models.Dto;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Feed.Api.Controllers;

[ApiController]
[Route("api/search")]
[Authorize]
public class SearchController : ControllerBase
{
    private readonly AppDbContext _db;

    public SearchController(AppDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<ActionResult<SearchResponseDto>> Search([FromQuery] string? query)
    {
        var term = query?.Trim();
        if (string.IsNullOrWhiteSpace(term))
            return Ok(new SearchResponseDto());

        var pattern = $"%{term}%";

        var users = await _db.Users
            .AsNoTracking()
            .Where(user => EF.Functions.ILike(user.DisplayName, pattern) ||
                          (user.Email != null && EF.Functions.ILike(user.Email, pattern)))
            .OrderBy(user => user.DisplayName)
            .Take(8)
            .Select(user => new SearchUserDto(
                user.Id,
                user.DisplayName,
                user.AvatarUrl == null
                    ? null
                    : $"/api/files/avatar/{user.Id}?v={Uri.EscapeDataString(user.AvatarUrl)}"))
            .ToListAsync();

        var userFiles = await _db.UserFiles
            .AsNoTracking()
            .Where(file => EF.Functions.ILike(file.FileName, pattern))
            .OrderByDescending(file => file.UploadedAt)
            .Take(8)
            .Select(file => new SearchFileDto(file.Id, file.FileName, "user"))
            .ToListAsync();

        var postFiles = await _db.PostFiles
            .AsNoTracking()
            .Where(file => EF.Functions.ILike(file.FileName, pattern))
            .OrderByDescending(file => file.UploadedAt)
            .Take(8)
            .Select(file => new SearchFileDto(file.Id, file.FileName, "post"))
            .ToListAsync();

        var posts = await _db.Posts
            .AsNoTracking()
            .Where(post => post.IsPostishka &&
                           ((post.Title != null && EF.Functions.ILike(post.Title, pattern)) ||
                           (post.Text != null && EF.Functions.ILike(post.Text, pattern)))
            )
            .OrderByDescending(post => post.CreatedAt)
            .Take(12)
            .Select(post => new SearchPostDto(post.Id, post.Title, post.Text, post.IsPostishka, post.CreatedAt))
            .ToListAsync();

        var dates = await FindDatesAsync(term);

        return Ok(new SearchResponseDto
        {
            Users = users,
            Files = userFiles.Concat(postFiles).Take(8).ToList(),
            Dates = dates,
            Posts = posts
        });
    }

    private async Task<List<SearchDateDto>> FindDatesAsync(string term)
    {
        DateOnly? date = null;
        var formats = new[] { "dd.MM.yyyy", "d.M.yyyy", "dd.MM", "d.M" };
        if (DateOnly.TryParseExact(term, formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
            date = parsed.Year == 1 ? new DateOnly(DateTime.UtcNow.Year, parsed.Month, parsed.Day) : parsed;

        var dates = _db.ArchiveDays.AsNoTracking();
        if (date.HasValue)
            dates = dates.Where(day => day.Date == date.Value);
        else
            return new List<SearchDateDto>();

        return await dates
            .OrderByDescending(day => day.Date)
            .Take(8)
            .Select(day => new SearchDateDto(day.Date, day.PostCount))
            .ToListAsync();
    }
}