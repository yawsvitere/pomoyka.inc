using System.Security.Claims;
using System.Text.Json;
using Feed.Api.Data;
using Feed.Api.Hubs;
using Feed.Api.Models;
using Feed.Api.Models.Dto;
using Feed.Api.Services;
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
    private readonly IStorageService _storage;
    private readonly ContentAddressedPreviewCleanupService _contentAddressedPreviewCleanup;
    private readonly ImagePreviewBackgroundService _imagePreviewBackgroundService;

    private const int MaxCommentImages = 10;
    private const long MaxCommentImageSizeBytes = 20L * 1024 * 1024;

    public CommentsController(
        AppDbContext db,
        IHubContext<FeedHub> hub,
        IStorageService storage,
        ContentAddressedPreviewCleanupService contentAddressedPreviewCleanup,
        ImagePreviewBackgroundService imagePreviewBackgroundService)
    {
        _db = db;
        _hub = hub;
        _storage = storage;
        _contentAddressedPreviewCleanup = contentAddressedPreviewCleanup;
        _imagePreviewBackgroundService = imagePreviewBackgroundService;
    }

    [HttpPost]
    [Consumes("application/json")]
    public Task<ActionResult<CommentDto>> Create(Guid postId, CreateCommentRequest request) =>
        CreateCommentAsync(postId, request, request.Files);

    [HttpPost]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxCommentImageSizeBytes * MaxCommentImages)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxCommentImageSizeBytes * MaxCommentImages)]
    public Task<ActionResult<CommentDto>> CreateWithImages(
        Guid postId,
        [FromForm] CreateCommentRequest request) =>
        CreateCommentAsync(postId, request, request.Files);

    private async Task<ActionResult<CommentDto>> CreateCommentAsync(
        Guid postId,
        CreateCommentRequest request,
        IReadOnlyList<IFormFile> files)
    {
        var authorId = GetUserId();
        if (authorId == null) return Unauthorized();
        var post = await _db.Posts.FirstOrDefaultAsync(p => p.Id == postId);
        if (post == null) return NotFound(new { message = "Пост не найден" });
        if (files.Count > MaxCommentImages)
            return BadRequest(new { message = $"Можно прикрепить не более {MaxCommentImages} изображений" });
        if (files.Any(file =>
                file.Length == 0 ||
                file.Length > MaxCommentImageSizeBytes ||
                !file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)))
            return BadRequest(new { message = "Можно прикрепить только изображения размером до 20 МБ" });

        var comment = new PostComment
        {
            PostId = postId,
            AuthorId = authorId.Value,
            Text = request.Text.Trim()
        };

        foreach (var file in files)
        {
            await using var stream = file.OpenReadStream();
            var storageKey = await _storage.UploadDeduplicatedObjectAsync(stream, file.ContentType);
            comment.Files.Add(new CommentFile
            {
                FileName = Path.GetFileName(file.FileName),
                StorageKey = storageKey,
                ContentType = file.ContentType,
                SizeBytes = file.Length
            });
        }

        _db.PostComments.Add(comment);
        await _db.SaveChangesAsync();
        foreach (var file in comment.Files)
            _imagePreviewBackgroundService.Enqueue(file.StorageKey, file.ContentType);

        var created = await _db.PostComments.AsNoTracking()
            .Include(c => c.Author)
            .Include(c => c.Files)
            .FirstAsync(c => c.Id == comment.Id);
        var dto = ToDto(created);
        await _hub.Clients.Group("feed-global").SendAsync("NewComment", postId, dto);
        return Ok(dto);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid postId, Guid id)
    {
        var userId = GetUserId();
        var comment = await _db.PostComments
            .Include(c => c.Files)
            .FirstOrDefaultAsync(c => c.Id == id && c.PostId == postId);
        if (comment == null) return NotFound();
        if (userId == null || comment.AuthorId != userId) return Forbid();
        foreach (var file in comment.Files)
        {
            if (!file.StorageKey.StartsWith("sha256/", StringComparison.Ordinal))
            {
                await _storage.DeleteObjectAsync(file.StorageKey);
                await _storage.DeleteObjectAsync(_storage.GetPreviewObjectKey(file.StorageKey));
            }
        }
        _db.PostComments.Remove(comment);
        await _db.SaveChangesAsync();
        await _contentAddressedPreviewCleanup.DeleteUnusedPreviewsAsync(
            comment.Files.Select(file => (file.StorageKey, file.ContentType)));
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
        Files = comment.Files.Select(file => new PostFileDto
        {
            Id = file.Id,
            FileName = file.FileName,
            ContentType = file.ContentType,
            SizeBytes = file.SizeBytes,
            DownloadUrl = $"{Request.Scheme}://{Request.Host}/api/files/comment/{file.Id}/download",
            PreviewUrl = _storage.GetPublicObjectUrl(_storage.GetPreviewObjectKey(file.StorageKey))
        }).ToList(),
        ReactionCounts = ReadReactions(comment.ReactionData)
            .GroupBy(reaction => reaction.Emoji)
            .ToDictionary(group => group.Key, group => group.Count()),
        Reactions = ReadReactions(comment.ReactionData).Select(reaction => new PostReactionDto
        {
            Emoji = reaction.Emoji,
            User = new UserDto
            {
                Id = reaction.UserId,
                Email = string.Empty,
                DisplayName = reaction.DisplayName,
                NicknameColor = string.IsNullOrWhiteSpace(reaction.NicknameColor) ? "#4f46e5" : reaction.NicknameColor
            }
        }).ToList()
    };

    private static List<PostReactionEntry> ReadReactions(string? data)
    {
        try { return JsonSerializer.Deserialize<List<PostReactionEntry>>(data ?? "[]") ?? new(); }
        catch (JsonException) { return new(); }
    }

}
