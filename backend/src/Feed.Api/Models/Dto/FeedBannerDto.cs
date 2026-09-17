namespace Feed.Api.Models.Dto;

public class FeedBannerDto
{
    public Guid Id { get; set; }
    public Guid PostId { get; set; }
    public string Title { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string? ImageUrl { get; set; }
}
