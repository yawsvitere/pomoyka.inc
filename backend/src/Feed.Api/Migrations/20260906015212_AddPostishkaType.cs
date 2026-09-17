using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Feed.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPostishkaType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsPostishka",
                table: "Posts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "RelatedPostId",
                table: "Posts",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql("UPDATE \"Posts\" SET \"IsPostishka\" = TRUE WHERE \"Title\" IS NOT NULL AND btrim(\"Title\") <> ''");

            migrationBuilder.CreateIndex(
                name: "IX_Posts_IsPostishka_CreatedAt",
                table: "Posts",
                columns: new[] { "IsPostishka", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Posts_IsPostishka_CreatedAt",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "IsPostishka",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "RelatedPostId",
                table: "Posts");
        }
    }
}
