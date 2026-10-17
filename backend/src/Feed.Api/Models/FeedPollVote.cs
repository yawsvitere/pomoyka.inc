namespace Feed.Api.Models;

public class FeedPollVote
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PollId { get; set; }
    public FeedPoll? Poll { get; set; }
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
    public DateTime VotedAt { get; set; } = DateTime.UtcNow;
    public ICollection<FeedPollVoteOption> Options { get; set; } = new List<FeedPollVoteOption>();
}
