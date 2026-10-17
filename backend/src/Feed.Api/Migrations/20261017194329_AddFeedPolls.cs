using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Feed.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFeedPolls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FeedPolls",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Question = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    EndsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    IsAnonymous = table.Column<bool>(type: "boolean", nullable: false),
                    AllowUserOptions = table.Column<bool>(type: "boolean", nullable: false),
                    AllowMultipleChoices = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FeedPolls", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "FeedPollOptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PollId = table.Column<Guid>(type: "uuid", nullable: false),
                    Text = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FeedPollOptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FeedPollOptions_AspNetUsers_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_FeedPollOptions_FeedPolls_PollId",
                        column: x => x.PollId,
                        principalTable: "FeedPolls",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "FeedPollVotes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PollId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    VotedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FeedPollVotes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FeedPollVotes_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_FeedPollVotes_FeedPolls_PollId",
                        column: x => x.PollId,
                        principalTable: "FeedPolls",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "FeedPollVoteOptions",
                columns: table => new
                {
                    VoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    OptionId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FeedPollVoteOptions", x => new { x.VoteId, x.OptionId });
                    table.ForeignKey(
                        name: "FK_FeedPollVoteOptions_FeedPollOptions_OptionId",
                        column: x => x.OptionId,
                        principalTable: "FeedPollOptions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_FeedPollVoteOptions_FeedPollVotes_VoteId",
                        column: x => x.VoteId,
                        principalTable: "FeedPollVotes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FeedPollOptions_CreatedById",
                table: "FeedPollOptions",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_FeedPollOptions_PollId_SortOrder",
                table: "FeedPollOptions",
                columns: new[] { "PollId", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_FeedPollVoteOptions_OptionId",
                table: "FeedPollVoteOptions",
                column: "OptionId");

            migrationBuilder.CreateIndex(
                name: "IX_FeedPollVotes_PollId_UserId",
                table: "FeedPollVotes",
                columns: new[] { "PollId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FeedPollVotes_UserId",
                table: "FeedPollVotes",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_FeedPolls_CreatedAt",
                table: "FeedPolls",
                column: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FeedPollVoteOptions");

            migrationBuilder.DropTable(
                name: "FeedPollOptions");

            migrationBuilder.DropTable(
                name: "FeedPollVotes");

            migrationBuilder.DropTable(
                name: "FeedPolls");
        }
    }
}
