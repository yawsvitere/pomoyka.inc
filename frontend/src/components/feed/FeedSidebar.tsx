import { Link } from "react-router-dom";
import type { FeedBanner, Post, PostFile, User } from "../../api/types";
import { getBrowserFileUrl } from "../../utils/fileUrl";
import { AvatarMedia } from "../ui/AvatarMedia";

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

function getInitials(user: User) {
  return user.displayName.trim().slice(0, 2).toUpperCase() || "?";
}

function getRecentFiles(posts: Post[]) {
  return posts
    .flatMap((post) => post.files.map((file) => ({ file, post })))
    .slice(0, 4);
}

function FileLink({ file, post }: { file: PostFile; post: Post }) {
  return (
    <a
      className="feed-sidebar-file"
      href={getBrowserFileUrl(file.downloadUrl)}
      target="_blank"
      rel="noreferrer"
      title={file.fileName}
    >
      <span className="feed-sidebar-file-icon">↗</span>
      <span>
        <strong>{file.fileName}</strong>
        <small>{post.author.displayName}</small>
      </span>
    </a>
  );
}

export function FeedSidebar({ posts, postishki, banners }: FeedSidebarProps) {
  const recentPostishki = postishki.slice(0, 3);
  const recentFiles = getRecentFiles(posts);
  const users = Array.from(
    new Map(posts.map((post) => [post.author.id, post.author])).values(),
  ).slice(0, 6);

  return (
    <aside className="feed-sidebar" aria-label="Обзор ленты">
      {banners.length > 0 && (
        <div className="feed-sidebar-banners" aria-label="Баннеры">
          {banners.map((banner) => (
            <Link className="feed-sidebar-banner" key={banner.id} to={`/posts/${banner.postId}`}>
              {banner.imageUrl && <img src={getBrowserFileUrl(banner.imageUrl)} alt="" />}
              <span className="feed-sidebar-banner-overlay">
                <strong>{banner.title}</strong>
                <small>{formatDate(banner.createdAt)}</small>
              </span>
            </Link>
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
              <Link
                className="feed-sidebar-post"
                key={post.id}
                to={`/posts/${post.id}`}
              >
                <strong>{getPostLabel(post)}</strong>
                <span>
                  {post.author.displayName} · {formatDate(post.createdAt)}
                </span>
              </Link>
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

      <section className="feed-sidebar-section">
        <div className="feed-sidebar-heading">
          <h2>Пользователи</h2>
          <span>{users.length}</span>
        </div>
        {users.length > 0 ? (
          <div className="feed-sidebar-users">
            {users.map((user) => (
              <Link
                className="feed-sidebar-user"
                key={user.id}
                to={`/profile/${encodeURIComponent(user.displayName)}`}
              >
                {user.avatarUrl ? (
                  <AvatarMedia src={getBrowserFileUrl(user.avatarUrl)} alt="" />
                ) : (
                  <span className="feed-sidebar-user-avatar">
                    {getInitials(user)}
                  </span>
                )}
                <span>{user.displayName}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="feed-sidebar-empty">Пользователей пока нет</p>
        )}
      </section>
    </aside>
  );
}