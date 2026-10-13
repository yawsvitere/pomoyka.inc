using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Feed.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPostishkaSlug : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Slug",
                table: "Posts",
                type: "character varying(220)",
                maxLength: 220,
                nullable: true);

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
                        SELECT "Id", "Title"
                        FROM "Posts"
                        WHERE "IsPostishka" = TRUE AND "Slug" IS NULL
                        ORDER BY "CreatedAt", "Id"
                    LOOP
                        base_slug := replace(lower(regexp_replace(
                            btrim(coalesce(post_record."Title", '')),
                            '[^[:alnum:]]+',
                            '-',
                            'g'
                        )), 'ё', 'е');
                        base_slug := btrim(base_slug, '-');
                        IF base_slug = '' THEN
                            base_slug := 'postishka';
                        END IF;

                        candidate := base_slug;
                        suffix := 2;
                        WHILE EXISTS (SELECT 1 FROM "Posts" WHERE "Slug" = candidate) LOOP
                            candidate := base_slug || '-' || suffix;
                            suffix := suffix + 1;
                        END LOOP;

                        UPDATE "Posts" SET "Slug" = candidate WHERE "Id" = post_record."Id";
                    END LOOP;
                END $$;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_Posts_Slug",
                table: "Posts",
                column: "Slug",
                unique: true,
                filter: "\"Slug\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Posts_Slug",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "Slug",
                table: "Posts");
        }
    }
}
