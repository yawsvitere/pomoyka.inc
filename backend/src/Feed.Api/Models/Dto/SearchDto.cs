namespace Feed.Api.Models.Dto;

public class SearchResponseDto
{
    public List<SearchUserDto> Users { get; set; } = new();
    public List<SearchFileDto> Files { get; set; } = new();
    public List<SearchDateDto> Dates { get; set; } = new();
    public List<SearchPostDto> Posts { get; set; } = new();
}

public record SearchUserDto(Guid Id, string DisplayName, string? AvatarUrl);
public record SearchFileDto(Guid Id, string FileName, string Kind, string? PreviewUrl);
public record SearchDateDto(DateOnly Date, int PostCount);
public record SearchPostDto(Guid Id, string Slug, string? Title, string? Text, bool IsPostishka, DateTime CreatedAt);