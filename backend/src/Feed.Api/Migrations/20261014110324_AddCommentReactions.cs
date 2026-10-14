using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Feed.Api.Migrations;

public partial class AddCommentReactions : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(
            """
            DROP TABLE IF EXISTS "ArchivedCommentLikes";
            DROP TABLE IF EXISTS "CommentLikes";
            ALTER TABLE "PostComments"
                ADD COLUMN IF NOT EXISTS "ReactionData" text NOT NULL DEFAULT '[]';
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "ReactionData",
            table: "PostComments");

        migrationBuilder.CreateTable(
            name: "ArchivedCommentLikes",
            columns: table => new
            {
                ArchivedCommentId = table.Column<Guid>(type: "uuid", nullable: false),
                UserId = table.Column<Guid>(type: "uuid", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey(
                    "PK_ArchivedCommentLikes",
                    x => new { x.ArchivedCommentId, x.UserId });
                table.ForeignKey(
                    name: "FK_ArchivedCommentLikes_ArchivedPostComments_ArchivedCommentId",
                    column: x => x.ArchivedCommentId,
                    principalTable: "ArchivedPostComments",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_ArchivedCommentLikes_AspNetUsers_UserId",
                    column: x => x.UserId,
                    principalTable: "AspNetUsers",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "CommentLikes",
            columns: table => new
            {
                CommentId = table.Column<Guid>(type: "uuid", nullable: false),
                UserId = table.Column<Guid>(type: "uuid", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_CommentLikes", x => new { x.CommentId, x.UserId });
                table.ForeignKey(
                    name: "FK_CommentLikes_PostComments_CommentId",
                    column: x => x.CommentId,
                    principalTable: "PostComments",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_CommentLikes_AspNetUsers_UserId",
                    column: x => x.UserId,
                    principalTable: "AspNetUsers",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_ArchivedCommentLikes_UserId",
            table: "ArchivedCommentLikes",
            column: "UserId");
        migrationBuilder.CreateIndex(
            name: "IX_CommentLikes_UserId",
            table: "CommentLikes",
            column: "UserId");
    }
}
