namespace Feed.Api.Models.Dto;

public record PinterestMediaPageDto(
    IReadOnlyList<PinterestMediaDto> Items,
    bool HasMore,
    IReadOnlyList<PinterestAuthorDto> Authors);

public record PinterestAuthorDto(
    Guid Id,
    string DisplayName,
    string NicknameColor,
    string? AvatarUrl);
