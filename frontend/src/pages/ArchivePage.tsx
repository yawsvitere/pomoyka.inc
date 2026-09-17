import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as archiveApi from "../api/archive";
import * as postsApi from "../api/posts";
import { InfiniteScroll } from "../components/ui/InfiniteScroll";
import { PostCard } from "../components/feed/PostCard";
import { Spinner } from "../components/ui/Spinner";
import "../styles/pages/archive.css";
import "../styles/components/post.css";
import "../styles/components/comment.css";
import "react-photo-view/dist/react-photo-view.css";

const ARCHIVE_PAGE_SIZE = 4;

export function ArchivePage() {
  const { year, month, day } = useParams<{
    year: string;
    month: string;
    day: string;
  }>();
  const navigate = useNavigate();
  const [archiveDay, setArchiveDay] =
    useState<archiveApi.ArchiveDayDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string>("");
  const nextPageRef = useRef(1);

  const yearNum = Number(year);
  const monthNum = Number(month);
  const dayNum = Number(day);

  useEffect(() => {
    setArchiveDay(null);
    setHasMore(true);
    nextPageRef.current = 1;
    void loadArchiveDay(1);
  }, [yearNum, monthNum, dayNum]);

  async function loadArchiveDay(page: number) {
    if (page === 1) setIsLoading(true);
    setError("");
    try {
      const data = await archiveApi.getArchiveDay(
        yearNum,
        monthNum,
        dayNum,
        page,
        ARCHIVE_PAGE_SIZE,
      );
      setArchiveDay((current) =>
        page === 1 || !current
          ? data
          : { ...data, posts: [...current.posts, ...data.posts] },
      );
      nextPageRef.current = page + 1;
      setHasMore(page < data.pagination.totalPages);
    } catch (err) {
      console.error("Error loading archive day:", err);
      setError("Не удалось загрузить архив");
    } finally {
      setIsLoading(false);
    }
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr + "T00:00:00Z");
    return date.toLocaleDateString("ru-RU", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  async function handleCommentLike(postId: string, commentId: string) {
    const result = await postsApi.toggleCommentLike(commentId);
    setArchiveDay(
      (current) =>
        current && {
          ...current,
          posts: current.posts.map((post) =>
            post.id === postId
              ? {
                  ...post,
                  comments: post.comments.map((comment) =>
                    comment.id === commentId
                      ? { ...comment, ...result }
                      : comment,
                  ),
                }
              : post,
          ),
        },
    );
  }

  async function handlePostDelete(postId: string) {
    try {
      await postsApi.deletePost(postId);
      setArchiveDay(
        (current) =>
          current && {
            ...current,
            postCount: Math.max(0, current.postCount - 1),
            posts: current.posts.filter((post) => post.id !== postId),
          },
      );
    } catch {
      setError("Не удалось удалить пост");
    }
  }

  if (isLoading && !archiveDay) {
    return (
      <div className="archive-page">
        <Spinner />
      </div>
    );
  }

  if (error || !archiveDay) {
    return (
      <div className="archive-page">
        <div className="archive-error">{error || "Архив не найден"}</div>
        <button
          onClick={() => navigate("/archive")}
          className="btn btn-secondary"
        >
          ← Вернуться к календарю
        </button>
      </div>
    );
  }

  return (
    <div className="archive-page">
      <button
        onClick={() => navigate("/archive")}
        className="btn btn-secondary"
      >
        ← АРХИВ
      </button>

      <div className="archive-day-header">
        <div className="archive-day-title">
          <span className="archive-icon">💩</span>
          <h1>ПОМОЙКА</h1>
        </div>
        <div className="archive-day-date">{formatDate(archiveDay.date)}</div>
        <div className="archive-day-stats">
          <span>{archiveDay.postCount} постов</span>
          <span>{archiveDay.participantCount} участников</span>
        </div>
      </div>

      {error && <div className="archive-error">{error}</div>}

      <div className="archive-posts">
        {isLoading ? (
          <p className="archive-loading">
            <Spinner />
          </p>
        ) : archiveDay.posts.length === 0 ? (
          <p className="archive-empty">В этот день не было постов</p>
        ) : (
          <InfiniteScroll
            hasMore={hasMore}
            isLoading={isLoading}
            onLoadMore={() => loadArchiveDay(nextPageRef.current)}
            loadingLabel="Загрузка архивных постов"
          >
            {archiveDay.posts.map((post, index) => (
              <PostCard
                key={post.id}
                post={post}
                showAuthor={
                  index === 0 ||
                  (archiveDay.posts[index - 1].author.id !== post.author.id &&
                    archiveDay.posts[index - 1].author.displayName !==
                      post.author.displayName)
                }
                onCommentLike={(commentId) =>
                  void handleCommentLike(post.id, commentId)
                }
                onDeletePost={(postId) => void handlePostDelete(postId)}
              />
            ))}
          </InfiniteScroll>
        )}
      </div>
    </div>
  );
}
