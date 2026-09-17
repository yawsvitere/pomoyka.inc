import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as postsApi from "../api/posts";
import type { Post } from "../api/types";
import { ContextMenu } from "../components/feed/ContextMenu";
import { Spinner } from "../components/ui/Spinner";
import { useAuth } from "../context/AuthContext";
import { getBrowserFileUrl } from "../utils/fileUrl";
import { AvatarMedia } from "../components/ui/AvatarMedia";
import "../styles/pages/postishki.css";

function getPostTitle(post: Post) {
  return post.title?.trim() || post.text?.trim().split("\n")[0] || "Без заголовка";
}

function getPostExcerpt(post: Post) {
  return post.description?.trim() || "Новая публикация в коллекции постишек.";
}

function getCoverUrl(post: Post) {
  const image = post.blocks.find(
    (block) => block.type === "image" && block.file,
  )?.file || post.files.find((file) => file.contentType.startsWith("image/"));

  return image ? getBrowserFileUrl(image.downloadUrl) : null;
}

function getInitials(displayName: string) {
  return displayName.trim().slice(0, 2).toUpperCase() || "?";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function isAdmin() {
  const token = localStorage.getItem("token");
  if (!token) return false;

  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    const roleClaim =
      payload.role ??
      payload["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"];
    return (Array.isArray(roleClaim) ? roleClaim : [roleClaim]).includes("Admin");
  } catch {
    return false;
  }
}

function PostishkiCard({
  post,
  index,
  onDelete,
}: {
  post: Post;
  index: number;
  onDelete: () => void;
}) {
  const coverUrl = getCoverUrl(post);
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <ContextMenu
      post={post}
      canDelete={user?.id === post.author.id || isAdmin()}
      onEdit={() => navigate(`/posts/${post.id}/edit`)}
      onDelete={onDelete}
    >
      <article className={`postishki-card postishki-card-${index % 6}`}>
        <Link className="postishki-card-cover" to={`/posts/${post.id}`}>
          {coverUrl ? (
            <img src={coverUrl} alt="" />
          ) : (
            <span className="postishki-card-no-cover">Постишки</span>
          )}
        </Link>
        <div className="postishki-card-content">
          <div className="postishki-card-meta">
            <span>{formatDate(post.createdAt)}</span>
          </div>
          <Link className="postishki-card-title" to={`/posts/${post.id}`}>
            {getPostTitle(post)}
          </Link>
          <p className="postishki-card-excerpt">{getPostExcerpt(post)}</p>
          <Link
            className="postishki-card-author"
            to={`/profile/${encodeURIComponent(post.author.displayName)}`}
          >
            {post.author.avatarUrl ? (
              <AvatarMedia
                src={getBrowserFileUrl(post.author.avatarUrl)}
                alt=""
                className="postishki-card-avatar"
              />
            ) : (
              <span className="postishki-card-avatar postishki-card-avatar-fallback">
                {getInitials(post.author.displayName)}
              </span>
            )}
            <span>{post.author.displayName}</span>
          </Link>
        </div>
      </article>
    </ContextMenu>
  );
}

export function PostishkiPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  async function deletePost(postId: string) {
    try {
      await postsApi.deletePost(postId);
      setPosts((currentPosts) => currentPosts.filter((post) => post.id !== postId));
    } catch {
      setError("Не удалось удалить постишку");
    }
  }

  useEffect(() => {
    void postsApi
      .getPostishki()
      .then(setPosts)
      .catch(() => setError("Не удалось загрузить постишки"))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return <div className="postishki-page"><Spinner /></div>;
  }

  return (
    <section className="postishki-page">
      <header className="postishki-header">
      </header>
      {error && <p className="postishki-error">{error}</p>}
      {!error && posts.length === 0 && <p className="postishki-empty">Постишек пока нет.</p>}
      <div className="postishki-list">
        {posts.map((post, index) => (
          <PostishkiCard
            key={post.id}
            post={post}
            index={index}
            onDelete={() => void deletePost(post.id)}
          />
        ))}
      </div>
    </section>
  );
}