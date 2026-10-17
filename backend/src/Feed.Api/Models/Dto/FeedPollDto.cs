namespace Feed.Api.Models.Dto;

public class FeedPollDto
{
    public Guid Id { get; set; }
    public string Question { get; set; } = string.Empty;
    public DateTime EndsAt { get; set; }
    public bool IsAnonymous { get; set; }
    public bool AllowUserOptions { get; set; }
    public bool AllowMultipleChoices { get; set; }
    public bool IsClosed { get; set; }
    public int TotalVotes { get; set; }
    public List<Guid> MyOptionIds { get; set; } = [];
    public List<FeedPollOptionDto> Options { get; set; } = [];
}

public class FeedPollOptionDto
{
    public Guid Id { get; set; }
    public string Text { get; set; } = string.Empty;
    public int VoteCount { get; set; }
    public List<FeedPollVoterDto> Voters { get; set; } = [];
}

public class FeedPollVoterDto
{
    public Guid Id { get; set; }
    public string DisplayName { get; set; } = string.Empty;
    public string NicknameColor { get; set; } = "#4f46e5";
    public string? AvatarUrl { get; set; }
}

public class CreateFeedPollRequest
{
    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.MaxLength(200)]
    public string Question { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Required]
    public DateTimeOffset EndsAt { get; set; }

    public bool IsAnonymous { get; set; }
    public bool AllowUserOptions { get; set; }
    public bool AllowMultipleChoices { get; set; }

    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.MinLength(2)]
    [System.ComponentModel.DataAnnotations.MaxLength(30)]
    public List<string> Options { get; set; } = [];
}

public class AddFeedPollOptionRequest
{
    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.MaxLength(120)]
    public string Text { get; set; } = string.Empty;
}

public class VoteFeedPollRequest
{
    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.MaxLength(50)]
    public List<Guid> OptionIds { get; set; } = [];
}

public static class FeedPollDtoMapper
{
    public static FeedPollDto ToDto(FeedPoll poll, Guid userId) => new()
    {
        Id = poll.Id,
        Question = poll.Question,
        EndsAt = poll.EndsAt,
        IsAnonymous = poll.IsAnonymous,
        AllowUserOptions = poll.AllowUserOptions,
        AllowMultipleChoices = poll.AllowMultipleChoices,
        IsClosed = poll.EndsAt <= DateTime.UtcNow,
        TotalVotes = poll.Votes.Count,
        MyOptionIds = poll.Votes
            .Where(vote => vote.UserId == userId)
            .SelectMany(vote => vote.Options)
            .Select(optionVote => optionVote.OptionId)
            .ToList(),
        Options = poll.Options
            .OrderBy(option => option.SortOrder)
            .Select(option => new FeedPollOptionDto
            {
                Id = option.Id,
                Text = option.Text,
                VoteCount = option.Votes.Count,
                Voters = poll.IsAnonymous
                    ? []
                    : option.Votes
                        .Where(optionVote => optionVote.Vote?.User != null)
                        .Select(optionVote => new FeedPollVoterDto
                        {
                            Id = optionVote.Vote!.User!.Id,
                            DisplayName = optionVote.Vote.User.DisplayName,
                            NicknameColor = optionVote.Vote.User.NicknameColor,
                            AvatarUrl = optionVote.Vote.User.AvatarUrl == null
                                ? null
                                : $"/api/files/avatar/{optionVote.Vote.User.Id}?v={Uri.EscapeDataString(optionVote.Vote.User.AvatarUrl)}"
                        })
                        .ToList()
            })
            .ToList()
    };
}
