namespace Feed.Api.Models;

public class FeedPollVoteOption
{
    public Guid VoteId { get; set; }
    public FeedPollVote? Vote { get; set; }
    public Guid OptionId { get; set; }
    public FeedPollOption? Option { get; set; }
}
