using Feed.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Feed.Api.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20261013120000_TransliteratePostishkaSlugs")]
public partial class TransliteratePostishkaSlugs : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(
            """
            DO $$
            DECLARE
                post_record RECORD;
                base_slug TEXT;
                candidate TEXT;
                suffix INTEGER;
            BEGIN
                FOR post_record IN
                    SELECT "Id", "Slug"
                    FROM "Posts"
                    WHERE "IsPostishka" = TRUE AND "Slug" ~ '[абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ]'
                    ORDER BY "CreatedAt", "Id"
                LOOP
                    base_slug := lower(post_record."Slug");
                    base_slug := translate(
                        base_slug,
                        'абвгдезийклмнопрстуфыэ',
                        'abvgdeziyklmnoprstufye'
                    );
                    base_slug := replace(base_slug, 'ё', 'yo');
                    base_slug := replace(base_slug, 'ж', 'zh');
                    base_slug := replace(base_slug, 'х', 'kh');
                    base_slug := replace(base_slug, 'ц', 'ts');
                    base_slug := replace(base_slug, 'ч', 'ch');
                    base_slug := replace(base_slug, 'ш', 'sh');
                    base_slug := replace(base_slug, 'щ', 'shch');
                    base_slug := replace(base_slug, 'ъ', '');
                    base_slug := replace(base_slug, 'ь', '');
                    base_slug := replace(base_slug, 'ю', 'yu');
                    base_slug := replace(base_slug, 'я', 'ya');
                    base_slug := btrim(left(base_slug, 200), '-');
                    IF base_slug = '' THEN
                        base_slug := 'postishka';
                    END IF;

                    candidate := base_slug;
                    suffix := 2;
                    WHILE EXISTS (
                        SELECT 1 FROM "Posts"
                        WHERE "Slug" = candidate AND "Id" <> post_record."Id"
                    ) LOOP
                        candidate := left(base_slug, 195) || '-' || suffix;
                        suffix := suffix + 1;
                    END LOOP;

                    UPDATE "Posts" SET "Slug" = candidate WHERE "Id" = post_record."Id";
                END LOOP;
            END $$;
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
    }
}
