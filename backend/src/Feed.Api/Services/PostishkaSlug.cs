using System.Text;

namespace Feed.Api.Services;

public static class PostishkaSlug
{
    public static string FromTitle(string title)
    {
        var slug = new StringBuilder();
        var needsSeparator = false;

        foreach (var rune in title.Normalize(NormalizationForm.FormKC).EnumerateRunes())
        {
            if (!Rune.IsLetterOrDigit(rune))
            {
                needsSeparator = slug.Length > 0;
                continue;
            }

            if (needsSeparator)
            {
                if (slug.Length == 200)
                    break;
                slug.Append('-');
                needsSeparator = false;
            }

            var normalizedRune = Rune.ToLowerInvariant(rune);
            var transliterated = Transliterate(normalizedRune);
            if (transliterated.Length == 0)
                continue;
            if (slug.Length + transliterated.Length > 200)
                break;
            slug.Append(transliterated);
        }

        return slug.Length > 0 ? slug.ToString() : "postishka";
    }

    private static string Transliterate(Rune rune) => rune.Value switch
    {
        'а' => "a",
        'б' => "b",
        'в' => "v",
        'г' => "g",
        'д' => "d",
        'е' => "e",
        'ё' => "yo",
        'ж' => "zh",
        'з' => "z",
        'и' => "i",
        'й' => "y",
        'к' => "k",
        'л' => "l",
        'м' => "m",
        'н' => "n",
        'о' => "o",
        'п' => "p",
        'р' => "r",
        'с' => "s",
        'т' => "t",
        'у' => "u",
        'ф' => "f",
        'х' => "kh",
        'ц' => "ts",
        'ч' => "ch",
        'ш' => "sh",
        'щ' => "shch",
        'ъ' or 'ь' => string.Empty,
        'ы' => "y",
        'э' => "e",
        'ю' => "yu",
        'я' => "ya",
        _ => rune.ToString(),
    };
}
