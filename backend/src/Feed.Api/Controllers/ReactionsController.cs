using System.Security.Claims;
using System.Text.Json;
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
[Route("api/reactions")]
[Authorize]
public class ReactionsController : ControllerBase
{
    private static readonly HashSet<string> AllowedEmojis = new() { "🍓", "😭", "🤮", "🥺", "🥶", "😎" };
    private readonly AppDbContext _db;
    private readonly IHubContext<FeedHub> _hub;

    public ReactionsController(AppDbContext db, IHubContext<FeedHub> hub)
    {
        _db = db;
        _hub = hub;
    }

    [HttpPut("post/{postId:guid}")]
    public async Task<ActionResult<PostReactionResult>> SetPostReaction(Guid postId, SetReactionRequest request)
    {
        var userId = GetUserId();
        if (userId == null) return Unauthorized();
        if (!AllowedEmojis.Contains(request.Emoji)) return BadRequest(new { message = "Недопустимая реакция" });
        var post = await _db.Posts.FirstOrDefaultAsync(item => item.Id == postId);
        if (post == null) return NotFound();
        var user = await _db.Users.FindAsync(userId.Value);
        if (user == null) return Unauthorized();
        var reactions = ReadReactions(post.ReactionData);
        var reaction = reactions.FirstOrDefault(item => item.UserId == userId.Value);
        if (reaction?.Emoji == request.Emoji)
            reactions.Remove(reaction);
        else if (reaction == null)
            reactions.Add(new PostReactionEntry { UserId = userId.Value, Emoji = request.Emoji, DisplayName = user.DisplayName, NicknameColor = user.NicknameColor });
        else
        {
            reaction.Emoji = request.Emoji;
            reaction.DisplayName = user.DisplayName;
            reaction.NicknameColor = user.NicknameColor;
        }
        post.ReactionData = JsonSerializer.Serialize(reactions);

        await _db.SaveChangesAsync();
        var reactionUserIds = reactions.Select(item => item.UserId).Distinct().ToList();
        var reactionAvatars = await _db.Users
            .Where(item => reactionUserIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.AvatarUrl);
        var result = new PostReactionResult
        {
            ReactionCounts = reactions.GroupBy(item => item.Emoji).ToDictionary(group => group.Key, group => group.Count()),
            Reactions = reactions.Select(item => new PostReactionDto
            {
                Emoji = item.Emoji,
                User = new UserDto
                {
                    Id = item.UserId,
                    Email = string.Empty,
                    DisplayName = item.DisplayName,
                    NicknameColor = string.IsNullOrWhiteSpace(item.NicknameColor) ? "#4f46e5" : item.NicknameColor,
                    AvatarUrl = reactionAvatars.TryGetValue(item.UserId, out var avatarUrl) && avatarUrl != null
                        ? $"/api/files/avatar/{item.UserId}?v={Uri.EscapeDataString(avatarUrl)}"
                        : null
                }
            }).ToList()
        };
        await _hub.Clients.Group("feed-global").SendAsync("PostReactionChanged", postId, result, userId.Value);
        return Ok(result);
    }

    private static List<PostReactionEntry> ReadReactions(string? data)
    {
        try { return JsonSerializer.Deserialize<List<PostReactionEntry>>(data ?? "[]") ?? new(); }
        catch (JsonException) { return new(); }
    }

    private Guid? GetUserId() => Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub), out var id) ? id : null;
}

public class SetReactionRequest
{
    public string Emoji { get; set; } = string.Empty;
}

public class PostReactionResult
{
    public Dictionary<string, int> ReactionCounts { get; set; } = new();
    public List<PostReactionDto> Reactions { get; set; } = new();
}

public class PostReactionEntry
{
    public Guid UserId { get; set; }
    public string Emoji { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string NicknameColor { get; set; } = "#4f46e5";
}