using Feed.Api.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Feed.Api.Data;

public class AppDbContext : IdentityDbContext<AppUser, IdentityRole<Guid>, Guid>
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Pomojka> Pomojkas => Set<Pomojka>();
    public DbSet<Post> Posts => Set<Post>();
    public DbSet<PostFile> PostFiles => Set<PostFile>();
    public DbSet<PostBlock> PostBlocks => Set<PostBlock>();
    public DbSet<PostComment> PostComments => Set<PostComment>();
    public DbSet<PostLike> PostLikes => Set<PostLike>();
    public DbSet<CommentLike> CommentLikes => Set<CommentLike>();
    public DbSet<InviteCode> InviteCodes => Set<InviteCode>();
    public DbSet<FileFolder> FileFolders => Set<FileFolder>();
    public DbSet<UserFile> UserFiles => Set<UserFile>();
    public DbSet<FeedBanner> FeedBanners => Set<FeedBanner>();
    public DbSet<StorageSettings> StorageSettings => Set<StorageSettings>();

    public DbSet<ArchiveDay> ArchiveDays => Set<ArchiveDay>();
    public DbSet<ArchivedPost> ArchivedPosts => Set<ArchivedPost>();
    public DbSet<ArchivedPostFile> ArchivedPostFiles => Set<ArchivedPostFile>();
    public DbSet<ArchivedPostBlock> ArchivedPostBlocks => Set<ArchivedPostBlock>();
    public DbSet<ArchivedPostComment> ArchivedPostComments => Set<ArchivedPostComment>();
    public DbSet<ArchivedPostLike> ArchivedPostLikes => Set<ArchivedPostLike>();
    public DbSet<ArchivedCommentLike> ArchivedCommentLikes => Set<ArchivedCommentLike>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<InviteCode>()
            .Property(x => x.Name)
            .HasMaxLength(100)
            .IsRequired();

        builder.Entity<FileFolder>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(120).IsRequired();
            e.Property(x => x.AccessLevel)
                .HasDefaultValue(FileAccessLevel.Authenticated)
                .HasSentinel(FileAccessLevel.Authenticated);
            e.HasIndex(x => new { x.OwnerId, x.Name }).IsUnique();
            e.HasOne(x => x.Owner).WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<UserFile>(e =>
        {
            e.Property(x => x.FileName).HasMaxLength(255).IsRequired();
            e.Property(x => x.StorageKey).HasMaxLength(500).IsRequired();
            e.Property(x => x.ContentType).HasMaxLength(255).IsRequired();
            e.Property(x => x.AccessLevel)
                .HasDefaultValue(FileAccessLevel.Authenticated)
                .HasSentinel(FileAccessLevel.Authenticated);
            e.HasIndex(x => new { x.OwnerId, x.UploadedAt });
            e.HasIndex(x => new { x.OwnerId, x.AccessLevel, x.UploadedAt });
            e.HasIndex(x => new { x.FolderId, x.UploadedAt });
            e.HasOne(x => x.Owner).WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Folder).WithMany(x => x.Files).HasForeignKey(x => x.FolderId).OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<StorageSettings>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasData(new StorageSettings
            {
                Id = Feed.Api.Models.StorageSettings.SingletonId,
                TotalQuotaBytes = Feed.Api.Models.StorageSettings.DefaultTotalQuotaBytes,
                DefaultUserQuotaBytes = Feed.Api.Models.StorageSettings.DefaultPerUserQuotaBytes
            });
        });

        builder.Entity<Post>(e =>
        {
            e.HasOne(p => p.Pomojka)
                .WithMany(p => p.Posts)
                .HasForeignKey(p => p.PomojkaId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(p => p.Author)
                .WithMany()
                .HasForeignKey(p => p.AuthorId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasMany(p => p.Files)
                .WithOne(f => f.Post)
                .HasForeignKey(f => f.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasMany(p => p.Blocks)
                .WithOne(b => b.Post)
                .HasForeignKey(b => b.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            e.Property(p => p.Text).HasColumnType("text");
            e.Property(p => p.Title).HasMaxLength(200);
            e.Property(p => p.Description).HasMaxLength(500);
            e.Property(p => p.AccessLevel)
                .HasDefaultValue(PostAccessLevel.Authenticated)
                .HasSentinel(PostAccessLevel.Authenticated);
            e.HasIndex(x => new { x.IsPostishka, x.CreatedAt });
            e.HasIndex(x => new { x.PomojkaId, x.IsPostishka, x.CreatedAt });
            e.HasIndex(x => new { x.IsPostishka, x.AccessLevel, x.CreatedAt });
            e.HasIndex(x => new { x.AuthorId, x.IsPostishka, x.CreatedAt });
            e.Navigation(p => p.Comments).UsePropertyAccessMode(PropertyAccessMode.Property);
            e.HasIndex(x => new { x.PomojkaId, x.CreatedAt }); // для быстрого поиска постов в Pomojka
        });

        builder.Entity<FeedBanner>(e =>
        {
            e.HasOne(x => x.Post)
                .WithMany()
                .HasForeignKey(x => x.PostId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => x.PostId).IsUnique();
            e.HasIndex(x => x.SortOrder);
        });

        builder.Entity<PostBlock>(e =>
        {
            e.Property(x => x.Type).HasMaxLength(20).IsRequired();
            e.Property(x => x.Text).HasMaxLength(20000);
            e.HasIndex(x => new { x.PostId, x.SortOrder });
            e.HasOne(x => x.File)
                .WithMany()
                .HasForeignKey(x => x.FileId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<PostComment>(e =>
        {
            e.Property(x => x.Text).HasMaxLength(1000).IsRequired();
            e.HasOne(x => x.Post).WithMany(x => x.Comments)
                .HasForeignKey(x => x.PostId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Author).WithMany()
                .HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.PostId, x.CreatedAt });
        });

        builder.Entity<PostLike>(e =>
        {
            e.HasKey(x => new { x.PostId, x.UserId });
            e.HasOne(x => x.Post).WithMany(x => x.Likes).HasForeignKey(x => x.PostId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });
        builder.Entity<CommentLike>(e =>
        {
            e.HasKey(x => new { x.CommentId, x.UserId });
            e.HasOne(x => x.Comment).WithMany(x => x.Likes).HasForeignKey(x => x.CommentId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<Pomojka>(e =>
        {
            e.HasIndex(x => x.Date).IsUnique();
            e.HasIndex(x => x.IsActive);
            e.Property(x => x.Date).HasColumnType("date");
        });

        builder.Entity<ArchiveDay>(e =>
        {
            e.HasIndex(x => x.Date).IsUnique();
            e.Property(x => x.Date).HasColumnType("date");
            e.HasMany(x => x.Posts)
                .WithOne(x => x.ArchiveDay)
                .HasForeignKey(x => x.ArchiveDayId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<ArchivedPost>(e =>
        {
            e.HasOne(p => p.Author)
                .WithMany()
                .HasForeignKey(p => p.AuthorId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasMany(p => p.Files)
                .WithOne(f => f.ArchivedPost)
                .HasForeignKey(f => f.ArchivedPostId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasMany(p => p.Blocks)
                .WithOne(b => b.ArchivedPost)
                .HasForeignKey(b => b.ArchivedPostId)
                .OnDelete(DeleteBehavior.Cascade);

            e.Property(p => p.Text).HasColumnType("text");
            e.Property(p => p.Title).HasMaxLength(200);
            e.Navigation(p => p.Comments).UsePropertyAccessMode(PropertyAccessMode.Property);
            e.HasIndex(x => new { x.ArchiveDayId, x.CreatedAt }); // для быстрого поиска постов в архиве дня
        });

        builder.Entity<ArchivedPostBlock>(e =>
        {
            e.Property(x => x.Type).HasMaxLength(20).IsRequired();
            e.Property(x => x.Text).HasMaxLength(20000);
            e.HasIndex(x => new { x.ArchivedPostId, x.SortOrder });
            e.HasOne(x => x.File)
                .WithMany()
                .HasForeignKey(x => x.FileId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<ArchivedPostComment>(e =>
        {
            e.Property(x => x.Text).HasMaxLength(1000).IsRequired();
            e.HasOne(x => x.ArchivedPost).WithMany(x => x.Comments)
                .HasForeignKey(x => x.ArchivedPostId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Author).WithMany()
                .HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.ArchivedPostId, x.CreatedAt });
        });

        builder.Entity<ArchivedPostLike>(e =>
        {
            e.HasKey(x => new { x.ArchivedPostId, x.UserId });
            e.HasOne(x => x.ArchivedPost).WithMany(x => x.Likes).HasForeignKey(x => x.ArchivedPostId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<ArchivedCommentLike>(e =>
        {
            e.HasKey(x => new { x.ArchivedCommentId, x.UserId });
            e.HasOne(x => x.Comment).WithMany(x => x.Likes).HasForeignKey(x => x.ArchivedCommentId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<InviteCode>(e =>
        {
            e.HasIndex(x => x.CodeHash).IsUnique();
            e.HasIndex(x => x.CreatedAt);
            e.HasOne(x => x.CreatedBy)
                .WithMany()
                .HasForeignKey(x => x.CreatedById)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.UsedBy)
                .WithMany()
                .HasForeignKey(x => x.UsedById)
                .OnDelete(DeleteBehavior.SetNull);
        });
    }
}
