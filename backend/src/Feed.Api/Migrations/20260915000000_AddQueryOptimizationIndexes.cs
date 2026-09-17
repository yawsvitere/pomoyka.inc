using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Feed.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddQueryOptimizationIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_UserFiles_FolderId_UploadedAt",
                table: "UserFiles",
                columns: new[] { "FolderId", "UploadedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_UserFiles_OwnerId_AccessLevel_UploadedAt",
                table: "UserFiles",
                columns: new[] { "OwnerId", "AccessLevel", "UploadedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Posts_AuthorId_IsPostishka_CreatedAt",
                table: "Posts",
                columns: new[] { "AuthorId", "IsPostishka", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Posts_IsPostishka_AccessLevel_CreatedAt",
                table: "Posts",
                columns: new[] { "IsPostishka", "AccessLevel", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Posts_PomojkaId_IsPostishka_CreatedAt",
                table: "Posts",
                columns: new[] { "PomojkaId", "IsPostishka", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_InviteCodes_CreatedAt",
                table: "InviteCodes",
                column: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_UserFiles_FolderId_UploadedAt",
                table: "UserFiles");

            migrationBuilder.DropIndex(
                name: "IX_UserFiles_OwnerId_AccessLevel_UploadedAt",
                table: "UserFiles");

            migrationBuilder.DropIndex(
                name: "IX_Posts_AuthorId_IsPostishka_CreatedAt",
                table: "Posts");

            migrationBuilder.DropIndex(
                name: "IX_Posts_IsPostishka_AccessLevel_CreatedAt",
                table: "Posts");

            migrationBuilder.DropIndex(
                name: "IX_Posts_PomojkaId_IsPostishka_CreatedAt",
                table: "Posts");

            migrationBuilder.DropIndex(
                name: "IX_InviteCodes_CreatedAt",
                table: "InviteCodes");
        }
    }
}
