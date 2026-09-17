using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Feed.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFileAccessLevels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AccessLevel",
                table: "UserFiles",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "AccessLevel",
                table: "FileFolders",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.Sql("UPDATE \"FileFolders\" SET \"AccessLevel\" = CASE WHEN \"IsPublic\" THEN 2 ELSE 0 END");
            migrationBuilder.Sql("UPDATE \"UserFiles\" SET \"AccessLevel\" = CASE WHEN \"IsPublic\" THEN 2 ELSE 0 END");

            migrationBuilder.DropColumn(
                name: "IsPublic",
                table: "UserFiles");

            migrationBuilder.DropColumn(
                name: "IsPublic",
                table: "FileFolders");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsPublic",
                table: "UserFiles",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsPublic",
                table: "FileFolders",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql("UPDATE \"UserFiles\" SET \"IsPublic\" = \"AccessLevel\" = 2");
            migrationBuilder.Sql("UPDATE \"FileFolders\" SET \"IsPublic\" = \"AccessLevel\" = 2");

            migrationBuilder.DropColumn(
                name: "AccessLevel",
                table: "UserFiles");

            migrationBuilder.DropColumn(
                name: "AccessLevel",
                table: "FileFolders");
        }
    }
}
