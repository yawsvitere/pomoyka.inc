import { useState, useEffect, useRef, useCallback } from "react";
import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import * as postsApi from "../api/posts";
import type { Comment, Post } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { FeedComposer } from "../components/feed/FeedComposer";
import { FeedSidebar } from "../components/feed/FeedSidebar";
import { PostCard } from "../components/feed/PostCard";
import { InfiniteScroll } from "../components/ui/InfiniteScroll";
import { Spinner } from "../components/ui/Spinner";
import "../styles/components/composer.css";
import "../styles/pages/feed.css";
import "../styles/components/post.css";
import "../styles/components/comment.css";
import "react-photo-view/dist/react-photo-view.css";

const FEED_PAGE_SIZE = 4;

function getCurrentUserId() {
  try {
    const token = localStorage.getItem("token");
    return token ? JSON.parse(atob(token.split(".")[1])).sub : null;
  } catch {
    return null;
  }
}

function sortPostsNewestFirst(posts: Post[]) {
  return [...posts].sort(
    (first, second) =>
      new Date(second.createdAt).getTime() -
      new Date(first.createdAt).getTime(),
  );
}

function updatePostAvatar(
  post: Post,
  userId: string,
  avatarUrl: string | null,
) {
  return {
    ...post,
    author:
      post.author.id === userId ? { ...post.author, avatarUrl } : post.author,
    comments: post.comments.map((comment) => ({
      ...comment,
      author:
        comment.author.id === userId
          ? { ...comment.author, avatarUrl }
          : comment.author,
    })),
    reactions: post.reactions.map((reaction) => ({
      ...reaction,
      user:
        reaction.user.id === userId
          ? { ...reaction.user, avatarUrl }
          : reaction.user,
    })),
  };
}

function updatePostNicknameColor(
  post: Post,
  userId: string,
  nicknameColor: string,
) {
  return {
    ...post,
    author:
      post.author.id === userId
        ? { ...post.author, nicknameColor }
        : post.author,
    comments: post.comments.map((comment) => ({
      ...comment,
      author:
        comment.author.id === userId
          ? { ...comment.author, nicknameColor }
          : comment.author,
    })),
    reactions: post.reactions.map((reaction) => ({
      ...reaction,
      user:
        reaction.user.id === userId
          ? { ...reaction.user, nicknameColor }
          : reaction.user,
    })),
  };
}

export function FeedPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [postishki, setPostishki] = useState<Post[]>([]);
  const [banners, setBanners] = useState<import("../api/types").FeedBanner[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string>("");
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const nextPageRef = useRef(1);

  useEffect(() => {
    if (!user) return;

    void postsApi
      .getFeedBanners()
      .then(setBanners)
      .catch(() => setBanners([]));
    void postsApi
      .getPostishki(1, 3)
      .then(setPostishki)
      .catch(() => setPostishki([]));

    setPosts((currentPosts) =>
      currentPosts.map((post) => ({
        ...post,
        author:
          post.author.id === user.id
            ? { ...post.author, ...user }
            : post.author,
        comments: post.comments.map((comment) => ({
          ...comment,
          author:
            comment.author.id === user.id
              ? { ...comment.author, ...user }
              : comment.author,
        })),
        reactions: post.reactions.map((reaction) => ({
          ...reaction,
          user:
            reaction.user.id === user.id
              ? { ...reaction.user, ...user }
              : reaction.user,
        })),
      })),
    );
  }, [user]);

  useEffect(() => {
    void loadFeed(1);

    const connection = new HubConnectionBuilder()
      .withUrl(`${import.meta.env.VITE_API_URL ?? ""}/hubs/feed`, {
        accessTokenFactory: () => localStorage.getItem("token") ?? "",
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    connection.on("NewPost", (newPost: Post) => {
      setPosts((currentPosts) =>
        currentPosts.some((post) => post.id === newPost.id)
          ? currentPosts
          : sortPostsNewestFirst([...currentPosts, newPost]),
      );
    });

    connection.on(
      "UserAvatarChanged",
      (userId: string, avatarUrl: string | null) => {
        setPosts((currentPosts) =>
          currentPosts.map((post) => updatePostAvatar(post, userId, avatarUrl)),
        );
      },
    );

    connection.on(
      "UserProfileChanged",
      (userId: string, nicknameColor: string) => {
        setPosts((currentPosts) =>
          currentPosts.map((post) =>
            updatePostNicknameColor(post, userId, nicknameColor),
          ),
        );
      },
    );

    connection.on("NewComment", (postId: string, comment: Comment) => {
      setOpenComments((current) => new Set(current).add(postId));
      setPosts((currentPosts) =>
        currentPosts.map((post) =>
          post.id === postId &&
          !post.comments.some((item) => item.id === comment.id)
            ? { ...post, comments: [...post.comments, comment] }
            : post,
        ),
      );
    });

    connection.on(
      "PostFileAdded",
      (postId: string, file: Post["files"][number]) => {
        setPosts((currentPosts) =>
          currentPosts.map((post) =>
            post.id === postId &&
            !post.files.some((item) => item.id === file.id)
              ? { ...post, files: [...post.files, file] }
              : post,
          ),
        );
      },
    );

    connection.on("CommentDeleted", (postId: string, commentId: string) => {
      setPosts((currentPosts) =>
        currentPosts.map((post) =>
          post.id === postId
            ? {
                ...post,
                comments: post.comments.filter(
                  (comment) => comment.id !== commentId,
                ),
              }
            : post,
        ),
      );
    });

    connection.on("PostDeleted", (postId: string) => {
      setPosts((currentPosts) =>
        currentPosts.filter((post) => post.id !== postId),
      );
    });

    connection.on(
      "PostReactionChanged",
      (
        postId: string,
        result: Post["reactions"] extends never[]
          ? never
          : {
              reactionCounts: Record<string, number>;
              reactions: Post["reactions"];
            },
        _actorId: string,
      ) => {
        setPosts((current) =>
          current.map((post) =>
            post.id === postId
              ? {
                  ...post,
                  reactionCounts: result.reactionCounts,
                  reactions: result.reactions,
                }
              : post,
          ),
        );
      },
    );

    connection.on(
      "CommentLikeChanged",
      (
        postId: string,
        commentId: string,
        likeCount: number,
        liked: boolean,
        actorId: string,
      ) => {
        setPosts((current) =>
          current.map((post) =>
            post.id === postId
              ? {
                  ...post,
                  comments: post.comments.map((comment) =>
                    comment.id === commentId
                      ? {
                          ...comment,
                          likeCount,
                          isLiked:
                            actorId === getCurrentUserId()
                              ? liked
                              : comment.isLiked,
                        }
                      : comment,
                  ),
                }
              : post,
          ),
        );
      },
    );

    connection.start().catch(() => undefined);

    return () => {
      connection.stop();
    };
  }, []);

  const loadFeed = useCallback(async (page: number) => {
    const isFirstPage = page === 1;
    if (isFirstPage) {
      setIsLoading(true);
    }
    setError("");
    try {
      const data = await postsApi.getFeed(page, FEED_PAGE_SIZE);

      if (!Array.isArray(data) || data.length === 0) {
        setHasMore(false);
        if (isFirstPage) {
          setPosts([]);
        }
        return;
      }

      setPosts((currentPosts) =>
        isFirstPage
          ? sortPostsNewestFirst(data)
          : sortPostsNewestFirst([
              ...currentPosts,
              ...data.filter(
                (post) => !currentPosts.some((item) => item.id === post.id),
              ),
            ]),
      );
      nextPageRef.current = page + 1;
      setHasMore(data.length >= FEED_PAGE_SIZE);
    } catch (err) {
      console.error("Error loading feed:", err);
      setHasMore(false);
      if (isFirstPage) {
        setPosts([]);
      }
      setError("Не удалось загрузить ленту");
    } finally {
      if (isFirstPage) {
        setIsLoading(false);
      }
    }
  }, []);

  const handleLoadMore = useCallback(
    () => loadFeed(nextPageRef.current),
    [loadFeed],
  );

  async function handlePostSubmit(text: string, selectedFiles: File[]) {
    setError("");
    const newPost = await postsApi.createPost(text);
    let postForFeed = newPost;
    if (selectedFiles.length > 0) {
      await Promise.all(
        selectedFiles.map((file) => postsApi.uploadPostFile(newPost.id, file)),
      );
      postForFeed = await postsApi.getPost(newPost.id);
    }
    setPosts((currentPosts) =>
      currentPosts.some((post) => post.id === postForFeed.id)
        ? currentPosts.map((post) =>
            post.id === postForFeed.id ? postForFeed : post,
          )
        : sortPostsNewestFirst([...currentPosts, postForFeed]),
    );
  }

  async function handleCommentSubmit(postId: string, commentText: string) {
    if (!commentText.trim()) return;
    try {
      const comment = await postsApi.createComment(postId, commentText);
      setPosts((currentPosts) =>
        currentPosts.map((post) =>
          post.id === postId &&
          !post.comments.some((item) => item.id === comment.id)
            ? { ...post, comments: [...post.comments, comment] }
            : post,
        ),
      );
    } catch {
      setError("Не удалось добавить комментарий");
    }
  }

  async function handlePostReaction(postId: string, emoji: string) {
    const result = await postsApi.setPostReaction(postId, emoji);
    setPosts((current) =>
      current.map((post) =>
        post.id === postId ? { ...post, ...result } : post,
      ),
    );
  }

  async function handlePostDelete(postId: string) {
    try {
      await postsApi.deletePost(postId);
      setPosts((currentPosts) =>
        currentPosts.filter((post) => post.id !== postId),
      );
    } catch {
      setError("Не удалось удалить пост");
    }
  }

  return (
    <div className="feed-page">
      <div className="feed-layout">
        <section className="feed-main">
          {error && <div className="feed-error">{error}</div>}

          <FeedComposer onSubmit={handlePostSubmit} onError={setError}>
            <InfiniteScroll
              hasMore={hasMore}
              isLoading={isLoading}
              onLoadMore={handleLoadMore}
              loadingLabel="Загрузка новых постов"
            >
              {isLoading ? (
                <p className="feed-state">
                  <Spinner />
                </p>
              ) : posts.length === 0 ? (
                <div className="feed-state feed-empty">
                  <div>пока пусто :(</div>
                  <div>будьте первым сегодня</div>
                </div>
              ) : (
                <div className="feed-list">
                  {posts.map((post, index) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      isOwnPost={post.author.id === user?.id}
                      showAuthor={
                        index === 0 ||
                        (posts[index - 1].author.id !== post.author.id &&
                          posts[index - 1].author.displayName !==
                            post.author.displayName)
                      }
                      authorLinks
                      showArticleLink
                      commentsOpen={openComments.has(post.id)}
                      onOpenComments={() =>
                        setOpenComments((current) =>
                          new Set(current).add(post.id),
                        )
                      }
                      onReaction={(emoji) =>
                        void handlePostReaction(post.id, emoji)
                      }
                      onDeletePost={(postId) => void handlePostDelete(postId)}
                      onCommentSubmit={(text) =>
                        void handleCommentSubmit(post.id, text)
                      }
                    />
                  ))}
                </div>
              )}
            </InfiniteScroll>
          </FeedComposer>
        </section>

        <FeedSidebar posts={posts} postishki={postishki} banners={banners} />
      </div>
    </div>
  );
}
