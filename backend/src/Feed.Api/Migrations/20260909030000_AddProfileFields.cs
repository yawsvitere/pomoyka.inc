using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Feed.Api.Migrations;

public partial class AddProfileFields : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(name: "About", table: "AspNetUsers", type: "text", maxLength: 500, nullable: true);
        migrationBuilder.AddColumn<string>(name: "BannerUrl", table: "AspNetUsers", type: "text", nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "About", table: "AspNetUsers");
        migrationBuilder.DropColumn(name: "BannerUrl", table: "AspNetUsers");
    }
}