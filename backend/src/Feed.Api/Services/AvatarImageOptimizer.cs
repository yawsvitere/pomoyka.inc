using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Processing;

namespace Feed.Api.Services;

public sealed class AvatarImageOptimizer
{
    private const int AvatarSize = 200;

    public async Task<Stream> OptimizeAsync(Stream input)
    {
        using var image = await Image.LoadAsync(input);
        image.Mutate(context => context.Resize(new ResizeOptions
        {
            Size = new Size(AvatarSize, AvatarSize),
            Mode = ResizeMode.Crop
        }));

        var output = new MemoryStream();
        await image.SaveAsWebpAsync(output);
        output.Position = 0;
        return output;
    }
}
