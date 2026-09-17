using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Feed.Api.Migrations
{
    /// <inheritdoc />
    public partial class SetAuthenticatedFileDefaults : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE \"UserFiles\" SET \"AccessLevel\" = 1 WHERE \"AccessLevel\" = 0");
            migrationBuilder.Sql("UPDATE \"FileFolders\" SET \"AccessLevel\" = 1 WHERE \"AccessLevel\" = 0");

            migrationBuilder.AlterColumn<int>(
                name: "AccessLevel",
                table: "UserFiles",
                type: "integer",
                nullable: false,
                defaultValue: 1,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AlterColumn<int>(
                name: "AccessLevel",
                table: "FileFolders",
                type: "integer",
                nullable: false,
                defaultValue: 1,
                oldClrType: typeof(int),
                oldType: "integer");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<int>(
                name: "AccessLevel",
                table: "UserFiles",
                type: "integer",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer",
                oldDefaultValue: 1);

            migrationBuilder.AlterColumn<int>(
                name: "AccessLevel",
                table: "FileFolders",
                type: "integer",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer",
                oldDefaultValue: 1);
        }
    }
}
