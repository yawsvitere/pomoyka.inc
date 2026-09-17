namespace Feed.Api.Models;

public class FeedBanner
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PostId { get; set; }
    public Post? Post { get; set; }
    public int SortOrder { get; set; }
}
