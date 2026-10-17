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
[Route("api/polls")]
[Authorize]
public class PollsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IHubContext<FeedHub> _feedHub;

    public PollsController(AppDbContext db, IHubContext<FeedHub> feedHub)
    {
        _db = db;
        _feedHub = feedHub;
    }

    [HttpGet]
    public async Task<ActionResult<List<FeedPollDto>>> GetPolls()
    {
        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();

        var polls = await GetPollQuery()
            .OrderByDescending(poll => poll.CreatedAt)
            .ToListAsync();

        return Ok(polls.Select(poll => FeedPollDtoMapper.ToDto(poll, userId.Value)).ToList());
    }

    [HttpPost("{id:guid}/options")]
    public async Task<ActionResult<FeedPollDto>> AddOption(
        Guid id,
        [FromBody] AddFeedPollOptionRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();

        var poll = await _db.FeedPolls
            .Include(item => item.Options)
            .FirstOrDefaultAsync(item => item.Id == id);
        if (poll == null)
            return NotFound();
        if (poll.EndsAt <= DateTime.UtcNow)
            return Conflict(new { message = "Голосование уже завершено" });
        if (!poll.AllowUserOptions)
            return BadRequest(new { message = "Добавлять варианты нельзя" });

        var text = request.Text.Trim();
        if (text.Length == 0)
            return BadRequest(new { message = "Вариант не может быть пустым" });
        if (poll.Options.Count >= 50)
            return Conflict(new { message = "Достигнут лимит вариантов" });
        if (poll.Options.Any(option =>
                string.Equals(option.Text, text, StringComparison.OrdinalIgnoreCase)))
            return Conflict(new { message = "Такой вариант уже есть" });

        poll.Options.Add(new FeedPollOption
        {
            PollId = poll.Id,
            Text = text,
            CreatedById = userId,
            SortOrder = poll.Options.Count
        });
        await _db.SaveChangesAsync();
        await NotifySidebarChangedAsync();

        var updatedPoll = await GetPollQuery().FirstAsync(item => item.Id == id);
        return Ok(FeedPollDtoMapper.ToDto(updatedPoll, userId.Value));
    }

    [HttpPut("{id:guid}/vote")]
    public async Task<ActionResult<FeedPollDto>> Vote(
        Guid id,
        [FromBody] VoteFeedPollRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();

        var poll = await _db.FeedPolls
            .Include(item => item.Options)
            .FirstOrDefaultAsync(item => item.Id == id);
        if (poll == null)
            return NotFound();
        if (poll.EndsAt <= DateTime.UtcNow)
            return Conflict(new { message = "Голосование уже завершено" });

        var optionIds = request.OptionIds.Distinct().ToList();
        if (optionIds.Count > 0 &&
            (optionIds.Count > (poll.AllowMultipleChoices ? 50 : 1) ||
             optionIds.Any(optionId => poll.Options.All(option => option.Id != optionId))))
            return BadRequest(new { message = "Выбраны недопустимые варианты" });

        var existingVote = await _db.FeedPollVotes
            .Include(vote => vote.Options)
            .FirstOrDefaultAsync(vote => vote.PollId == id && vote.UserId == userId);

        if (existingVote != null && optionIds.Count == 0)
        {
            _db.FeedPollVotes.Remove(existingVote);
        }
        else if (optionIds.Count > 0)
        {
            if (existingVote == null)
            {
                existingVote = new FeedPollVote
                {
                    PollId = id,
                    UserId = userId.Value
                };
                _db.FeedPollVotes.Add(existingVote);
            }
            else
            {
                existingVote.VotedAt = DateTime.UtcNow;
            }

            var existingOptionIds = existingVote.Options
                .Select(optionVote => optionVote.OptionId)
                .ToHashSet();
            _db.FeedPollVoteOptions.RemoveRange(existingVote.Options
                .Where(optionVote => !optionIds.Contains(optionVote.OptionId)));
            _db.FeedPollVoteOptions.AddRange(optionIds
                .Where(optionId => !existingOptionIds.Contains(optionId))
                .Select(optionId => new FeedPollVoteOption
            {
                VoteId = existingVote.Id,
                OptionId = optionId
            }));
        }

        await _db.SaveChangesAsync();
        await NotifySidebarChangedAsync();

        var updatedPoll = await GetPollQuery().FirstAsync(item => item.Id == id);
        return Ok(FeedPollDtoMapper.ToDto(updatedPoll, userId.Value));
    }

    private IQueryable<FeedPoll> GetPollQuery() =>
        _db.FeedPolls
            .AsNoTracking()
            .AsSplitQuery()
            .Include(poll => poll.Options)
                .ThenInclude(option => option.Votes)
                    .ThenInclude(optionVote => optionVote.Vote)
                        .ThenInclude(vote => vote!.User)
            .Include(poll => poll.Votes)
                .ThenInclude(vote => vote.Options);

    private Guid? GetCurrentUserId()
    {
        var rawId = User.FindFirstValue("sub")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(rawId, out var id) ? id : null;
    }

    private Task NotifySidebarChangedAsync() =>
        _feedHub.Clients.Group("feed-global").SendAsync("FeedSidebarChanged");
}
