namespace Feed.Api.Models.Dto;

public record PinterestMediaPageDto(
    IReadOnlyList<PinterestMediaDto> Items,
    bool HasMore);
