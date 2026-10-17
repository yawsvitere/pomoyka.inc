namespace Feed.Api.Models;

public class FeedPoll
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Question { get; set; } = string.Empty;
    public DateTime EndsAt { get; set; }
    public bool IsAnonymous { get; set; }
    public bool AllowUserOptions { get; set; }
    public bool AllowMultipleChoices { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<FeedPollOption> Options { get; set; } = new List<FeedPollOption>();
    public ICollection<FeedPollVote> Votes { get; set; } = new List<FeedPollVote>();
}
