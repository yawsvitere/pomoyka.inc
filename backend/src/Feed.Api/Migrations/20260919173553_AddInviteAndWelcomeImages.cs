using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Feed.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddInviteAndWelcomeImages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ImageUrl",
                table: "InviteCodes",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WelcomeImageUrl",
                table: "AspNetUsers",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ImageUrl",
                table: "InviteCodes");

            migrationBuilder.DropColumn(
                name: "WelcomeImageUrl",
                table: "AspNetUsers");
        }
    }
}
