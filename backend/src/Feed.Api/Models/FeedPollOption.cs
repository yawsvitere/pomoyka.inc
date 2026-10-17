namespace Feed.Api.Models;

public class FeedPollOption
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PollId { get; set; }
    public FeedPoll? Poll { get; set; }
    public string Text { get; set; } = string.Empty;
    public Guid? CreatedById { get; set; }
    public AppUser? CreatedBy { get; set; }
    public int SortOrder { get; set; }
    public ICollection<FeedPollVoteOption> Votes { get; set; } = new List<FeedPollVoteOption>();
}
