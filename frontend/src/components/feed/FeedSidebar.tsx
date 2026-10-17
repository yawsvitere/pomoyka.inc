import type { FeedBanner, Post, PostFile } from "../../api/types";
import { AppExternalLink, AppLink } from "../ui/AppLink";
import { getBrowserFileUrl } from "../../utils/fileUrl";
import { getPostishkaUrl } from "../../utils/postishkaUrl";
import { PostishkaCoverImage } from "./PostishkaCoverImage";

interface FeedSidebarProps {
  posts: Post[];
  postishki: Post[];
  banners: FeedBanner[];
}

function getPostLabel(post: Post) {
  return post.title?.trim() || post.text?.trim() || "Без текста";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function getRecentFiles(posts: Post[]) {
  return posts
    .flatMap((post) => post.files.map((file) => ({ file, post })))
    .slice(0, 4);
}

function FileLink({ file, post }: { file: PostFile; post: Post }) {
  return (
    <AppExternalLink
      className="feed-sidebar-file"
      href={getBrowserFileUrl(file.downloadUrl)}
      title={file.fileName}
    >
      <span className="feed-sidebar-file-icon">↗</span>
      <span>
        <strong>{file.fileName}</strong>
        <small>{post.author.displayName}</small>
      </span>
    </AppExternalLink>
  );
}

export function FeedSidebar({ posts, postishki, banners }: FeedSidebarProps) {
  const recentPostishki = postishki.slice(0, 3);
  const recentFiles = getRecentFiles(posts);

  return (
    <aside className="feed-sidebar" aria-label="Обзор ленты">
      {banners.length > 0 && (
        <div className="feed-sidebar-banners" aria-label="Баннеры">
          {banners.map((banner) => (
            <AppLink
              className="feed-sidebar-banner"
              key={banner.id}
              to={getPostishkaUrl({
                slug: banner.postSlug,
              })}
            >
              <PostishkaCoverImage
                postId={banner.postId}
                hasOgCover={banner.hasOgCover}
                fallbackUrl={
                  banner.imageUrl
                    ? getBrowserFileUrl(banner.imageUrl)
                    : null
                }
              />
              <span className="feed-sidebar-banner-overlay">
                <strong>{banner.title}</strong>
                <small>{formatDate(banner.createdAt)}</small>
              </span>
            </AppLink>
          ))}
        </div>
      )}
      <section className="feed-sidebar-section">
        <div className="feed-sidebar-heading">
          <h2>Последние постишки</h2>
          <span>{recentPostishki.length}</span>
        </div>
        {recentPostishki.length > 0 ? (
          <div className="feed-sidebar-posts">
            {recentPostishki.map((post) => (
              <AppLink
                className="feed-sidebar-post"
                key={post.id}
                to={getPostishkaUrl(post)}
              >
                <strong>{getPostLabel(post)}</strong>
                <span>
                  {post.author.displayName} · {formatDate(post.createdAt)}
                </span>
              </AppLink>
            ))}
          </div>
        ) : (
          <p className="feed-sidebar-empty">Пока ничего нет</p>
        )}
      </section>

      <section className="feed-sidebar-section">
        <div className="feed-sidebar-heading">
          <h2>Файлы</h2>
          <span>{recentFiles.length}</span>
        </div>
        {recentFiles.length > 0 ? (
          <div className="feed-sidebar-files">
            {recentFiles.map(({ file, post }) => (
              <FileLink file={file} post={post} key={file.id} />
            ))}
          </div>
        ) : (
          <p className="feed-sidebar-empty">Прикреплённых файлов нет</p>
        )}
      </section>
    </aside>
  );
}
