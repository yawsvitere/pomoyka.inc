using System.Security.Claims;
using Feed.Api.Data;
using Feed.Api.Hubs;
using Feed.Api.Models;
using Feed.Api.Models.Dto;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Feed.Api.Controllers;

[ApiController]
[Route("api/posts/{postId:guid}/comments")]
[Authorize]
public class CommentsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IHubContext<FeedHub> _hub;

    public CommentsController(AppDbContext db, IHubContext<FeedHub> hub)
    {
        _db = db;
        _hub = hub;
    }

    [HttpPost]
    public async Task<ActionResult<CommentDto>> Create(Guid postId, CreateCommentRequest request)
    {
        var authorId = GetUserId();
        if (authorId == null) return Unauthorized();
        if (!await _db.Posts.AnyAsync(p => p.Id == postId)) return NotFound(new { message = "Пост не найден" });
        var comment = new PostComment { PostId = postId, AuthorId = authorId.Value, Text = request.Text.Trim() };
        _db.PostComments.Add(comment);
        await _db.SaveChangesAsync();
        var created = await _db.PostComments.AsNoTracking().Include(c => c.Author).Include(c => c.Likes).FirstAsync(c => c.Id == comment.Id);
        var dto = ToDto(created);
        await _hub.Clients.Group("feed-global").SendAsync("NewComment", postId, dto);
        return Ok(dto);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid postId, Guid id)
    {
        var userId = GetUserId();
        var comment = await _db.PostComments.FirstOrDefaultAsync(c => c.Id == id && c.PostId == postId);
        if (comment == null) return NotFound();
        if (userId == null || comment.AuthorId != userId) return Forbid();
        _db.PostComments.Remove(comment);
        await _db.SaveChangesAsync();
        await _hub.Clients.Group("feed-global").SendAsync("CommentDeleted", postId, id);
        return NoContent();
    }

    private Guid? GetUserId() => Guid.TryParse(
        User.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
        ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    private CommentDto ToDto(PostComment comment) => new()
    {
        Id = comment.Id,
        Text = comment.Text,
        CreatedAt = comment.CreatedAt,
        Author = new UserDto
        {
            Id = comment.Author!.Id,
            Email = comment.Author.Email ?? string.Empty,
            DisplayName = comment.Author.DisplayName,
            NicknameColor = string.IsNullOrWhiteSpace(comment.Author.NicknameColor) ? "#4f46e5" : comment.Author.NicknameColor,
            AvatarUrl = comment.Author.AvatarUrl == null ? null : $"/api/files/avatar/{comment.Author.Id}?v={Uri.EscapeDataString(comment.Author.AvatarUrl)}"
        },
        LikeCount = comment.Likes.Count,
        IsLiked = comment.Likes.Any(l => l.UserId == GetUserId())
    };

}
