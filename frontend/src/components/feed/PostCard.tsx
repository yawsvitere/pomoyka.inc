import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from "react";
import { Link } from "react-router-dom";
import { Audio, AudioPlayer, AudioSkin } from "@videojs/react/audio";
import "@videojs/react/audio/skin.css";
import { Video, VideoPlayer, VideoSkin } from "@videojs/react/video";
import "@videojs/react/video/skin.css";
import { PhotoProvider, PhotoView } from "react-photo-view";
import type { Post } from "../../api/types";
import { CommentItem } from "./CommentItem";
import { ContextMenu } from "./ContextMenu";
import { useAuth } from "../../context/AuthContext";
import { getBrowserFileUrl } from "../../utils/fileUrl";
import sendIcon from "../../assets/icons/send.svg";
import { ReactionIcon } from "./ContextMenu";
import { AvatarMedia } from "../ui/AvatarMedia";
export type PostCardData = Omit<Post, "reactionCounts" | "reactions"> &
  Partial<Pick<Post, "reactionCounts" | "reactions">>;
interface PostCardProps {
  post: PostCardData;
  showAuthor?: boolean;
  commentsOpen?: boolean;
  authorLinks?: boolean;
  showArticleLink?: boolean;
  isOwnPost?: boolean;
  onOpenComments?: () => void;
  onCommentLike?: (commentId: string) => void;
  onReaction?: (emoji: string) => void;
  onCommentSubmit?: (commentText: string) => void;
  onDeletePost?: (postId: string) => void;
}

const GAP = 4;
const TARGET_ROW_HEIGHT = 220;
const MIN_ROW_HEIGHT = 150;
const MAX_ROW_HEIGHT = 360;
const MAX_TALL_MEDIA_HEIGHT = 500;
const MAX_VIDEO_WIDTH = 992;
const MAX_VIDEO_HEIGHT = 750;

interface ImageRatio {
  width: number;
  height: number;
}
interface GalleryItem {
  file: Post["files"][number];
  ratio: number;
}
interface GalleryRow {
  files: Post["files"];
  height: number;
}
type GalleryLayout =
  | { type: "rows"; rows: GalleryRow[] }
  | {
      type: "mosaic";
      template: string;
      files: GalleryItem[];
      aspectRatio: number;
    };

function getRatio(
  file: Post["files"][number],
  ratioMap: Record<string, ImageRatio>,
) {
  const dimensions = ratioMap[file.id];
  return dimensions ? dimensions.width / dimensions.height : 1;
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
    return (Array.isArray(roleClaim) ? roleClaim : [roleClaim]).includes(
      "Admin",
    );
  } catch {
    return false;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function calculateMosaicLayout(
  files: Post["files"],
  ratioMap: Record<string, ImageRatio>,
): GalleryLayout | null {
  const items = files.map((file) => ({
    file,
    ratio: getRatio(file, ratioMap),
  }));
  const count = items.length;
  if (count === 1)
    return {
      type: "mosaic",
      template: "single",
      files: items,
      aspectRatio: clamp(items[0].ratio, 0.65, 1.8),
    };
  if (count === 2) {
    const portraitIndex = items.findIndex((item) => item.ratio < 0.85);
    if (
      portraitIndex !== -1 &&
      items.filter((item) => item.ratio < 0.85).length === 1
    )
      return {
        type: "mosaic",
        template: "two-mixed",
        files: [
          items[portraitIndex],
          ...items.filter((_, index) => index !== portraitIndex),
        ],
        aspectRatio: 1.45,
      };
    return { type: "mosaic", template: "two", files: items, aspectRatio: 1.65 };
  }
  if (count === 3) {
    const portraitIndex = items.findIndex((item) => item.ratio < 0.85);
    if (portraitIndex !== -1)
      return {
        type: "mosaic",
        template: "three-portrait",
        files: [
          items[portraitIndex],
          ...items.filter((_, index) => index !== portraitIndex),
        ],
        aspectRatio: 1.35,
      };

    const widestIndex = items.reduce(
      (best, item, index) => (item.ratio > items[best].ratio ? index : best),
      0,
    );

    return {
      type: "mosaic",
      template: "three-main",
      files: [
        items[widestIndex],
        ...items.filter((_, index) => index !== widestIndex),
      ],
      aspectRatio: 1.65,
    };
  }
  if (count === 4) {
    const portraitIndex = items.findIndex((item) => item.ratio < 0.8);
    if (
      portraitIndex !== -1 &&
      items.filter((item) => item.ratio < 0.8).length === 1
    )
      return {
        type: "mosaic",
        template: "four-main",
        files: [
          items[portraitIndex],
          ...items.filter((_, index) => index !== portraitIndex),
        ],
        aspectRatio: 1.4,
      };
    return {
      type: "mosaic",
      template: "four",
      files: items,
      aspectRatio: 1.55,
    };
  }
  return null;
}

function calculateRows(
  files: Post["files"],
  containerWidth: number,
  ratioMap: Record<string, ImageRatio>,
): GalleryLayout {
  const ratios = files.map((file) => getRatio(file, ratioMap));
  const bestScores = Array<number>(files.length + 1).fill(
    Number.POSITIVE_INFINITY,
  );
  const nextEnds = Array<number>(files.length).fill(files.length);
  bestScores[files.length] = 0;
  for (let start = files.length - 1; start >= 0; start -= 1) {
    for (
      let end = start + 1;
      end <= Math.min(files.length, start + 4);
      end += 1
    ) {
      const count = end - start;
      const ratioSum = ratios
        .slice(start, end)
        .reduce((sum, ratio) => sum + ratio, 0);
      const height = (containerWidth - GAP * (count - 1)) / ratioSum;
      let score = Math.abs(height - TARGET_ROW_HEIGHT);
      if (height < MIN_ROW_HEIGHT || height > MAX_ROW_HEIGHT) score += 600;
      if (end === files.length && count === 1 && files.length > 1) score += 120;
      if (count === 4) score += 15;
      if (score + bestScores[end] < bestScores[start]) {
        bestScores[start] = score + bestScores[end];
        nextEnds[start] = end;
      }
    }
  }
  const rows: GalleryRow[] = [];
  for (let start = 0; start < files.length; start = nextEnds[start]) {
    const end = nextEnds[start];
    const ratioSum = ratios
      .slice(start, end)
      .reduce((sum, ratio) => sum + ratio, 0);
    rows.push({
      files: files.slice(start, end),
      height: clamp(
        (containerWidth - GAP * (end - start - 1)) / ratioSum,
        MIN_ROW_HEIGHT,
        MAX_ROW_HEIGHT,
      ),
    });
  }
  return { type: "rows", rows };
}
function calculateLayout(
  files: Post["files"],
  containerWidth: number,
  ratioMap: Record<string, ImageRatio>,
): GalleryLayout {
  if (!files.length || !containerWidth) return { type: "rows", rows: [] };

  if (files.length <= 4) {
    return calculateMosaicLayout(files, ratioMap) ?? { type: "rows", rows: [] };
  }

  return (
    calculateMosaicLayout(files, ratioMap) ??
    calculateRows(files, containerWidth, ratioMap)
  );
}
function PostImageGallery({ files }: { files: Post["files"] }) {
  const galleryRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [, setRatiosVersion] = useState(0);
  const ratioMapRef = useRef<Record<string, ImageRatio>>({});
  useEffect(() => {
    const gallery = galleryRef.current;
    if (!gallery) return;
    const observer = new ResizeObserver(() =>
      setContainerWidth(gallery.clientWidth),
    );
    observer.observe(gallery);
    setContainerWidth(gallery.clientWidth);
    return () => observer.disconnect();
  }, []);
  const layout = calculateLayout(files, containerWidth, ratioMapRef.current);
  const handleImageLoad = (
    event: SyntheticEvent<HTMLImageElement>,
    fileId: string,
  ) => {
    const image = event.currentTarget;
    if (
      !ratioMapRef.current[fileId] &&
      image.naturalWidth &&
      image.naturalHeight
    ) {
      ratioMapRef.current[fileId] = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      setRatiosVersion((version) => version + 1);
    }
  };
  const renderImage = (item: GalleryItem) => {
    const fileUrl = getBrowserFileUrl(item.file.downloadUrl);
    const isSingleImage = files.length === 1;
    const isPortrait = getRatio(item.file, ratioMapRef.current) < 1;
    const isSinglePortrait = isSingleImage && isPortrait;

    return (
      <div
        className={`post-image-link${isSingleImage ? " post-image-link--single" : ""}`}
        key={item.file.id}
        style={{
          flex: layout.type === "rows" ? `${item.ratio} 1 0` : undefined,
          width:
            layout.type === "mosaic" && !isSingleImage ? "100%" : undefined,
          height:
            layout.type === "mosaic" && !isSingleImage ? "100%" : undefined,
          aspectRatio:
            layout.type === "mosaic" && !isSingleImage ? item.ratio : undefined,
        }}
      >
        <PhotoView src={fileUrl}>
          <img
            className="post-image"
            src={fileUrl}
            alt={item.file.fileName}
            onLoad={(event) => handleImageLoad(event, item.file.id)}
            style={
              isSingleImage
                ? {
                    maxWidth: "100%",
                    height: "auto",
                    maxHeight: `${MAX_TALL_MEDIA_HEIGHT}px`,
                    objectFit: "contain",
                    margin: isSinglePortrait ? "0 auto 0 0" : "0 auto",
                    display: "block",
                  }
                : {
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    margin: 0,
                  }
            }
          />
        </PhotoView>
      </div>
    );
  };
  return (
    <div className="post-photo-gallery" ref={galleryRef}>
      {layout.type === "mosaic" ? (
        <div
          className={`post-photo-mosaic post-photo-mosaic--${layout.template}`}
          style={{
            aspectRatio: files.length === 1 ? undefined : layout.aspectRatio,
          }}
        >
          {layout.files.map(renderImage)}
        </div>
      ) : (
        layout.rows.map((row, rowIndex) => (
          <div
            className="post-photo-row"
            key={`${rowIndex}-${row.files[0].id}`}
            style={{ height: row.height }}
          >
            {row.files.map((file) =>
              renderImage({ file, ratio: getRatio(file, ratioMapRef.current) }),
            )}
          </div>
        ))
      )}
    </div>
  );
}

function PostVideo({ file }: { file: Post["files"][number] }) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [videoWidth, setVideoWidth] = useState<number | null>(null);

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth, videoHeight } = event.currentTarget;
    if (!videoWidth || !videoHeight) return;
    setRatio(videoWidth / videoHeight);
    setVideoWidth(videoWidth);
  };

  const style: CSSProperties = {};
  if (ratio && videoWidth) {
    const videoHeight = videoWidth / ratio;
    const scale = Math.min(
      1,
      MAX_VIDEO_WIDTH / videoWidth,
      MAX_VIDEO_HEIGHT / videoHeight,
    );
    style.aspectRatio = `${ratio}`;
    style.width = `${videoWidth * scale}px`;
    style.maxWidth = "100%";
  }

  return (
    <div className="post-video" style={style}>
      <VideoPlayer>
        <VideoSkin>
          <Video
            src={getBrowserFileUrl(file.downloadUrl)}
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
          />
        </VideoSkin>
      </VideoPlayer>
    </div>
  );
}

function ReactionAvatar({
  displayName,
  avatarUrl,
}: {
  displayName?: string;
  avatarUrl?: string | null;
}) {
  return avatarUrl ? (
    <AvatarMedia
      className="reaction-avatar"
      src={getBrowserFileUrl(avatarUrl)}
      alt=""
    />
  ) : (
    <span className="reaction-avatar reaction-avatar-fallback">
      {(displayName ?? "?").charAt(0).toUpperCase()}
    </span>
  );
}

export function PostCard({
  post,
  showAuthor = true,
  commentsOpen = false,
  authorLinks = false,
  showArticleLink = false,
  isOwnPost = false,
  onOpenComments,
  onCommentLike,
  onReaction,
  onCommentSubmit,
  onDeletePost,
}: PostCardProps) {
  const { user } = useAuth();
  const [localCommentsOpen, setLocalCommentsOpen] = useState(false);
  const isMine = isOwnPost || user?.id === post.author.id;
  const profileUrl = `/profile/${encodeURIComponent(post.author.displayName)}`;
  const commentsVisible = commentsOpen || localCommentsOpen;
  const author = post.author.avatarUrl ? (
    <AvatarMedia
      className="post-avatar"
      src={getBrowserFileUrl(post.author.avatarUrl)}
      alt=""
    />
  ) : (
    <span className="post-avatar post-avatar-fallback">
      {post.author.displayName.charAt(0).toUpperCase()}
    </span>
  );
  const authorColor = post.author.nicknameColor ?? "#4f46e5";
  const imageFiles = post.files.filter((file) =>
    file.contentType.startsWith("image/"),
  );
  const videoFiles = post.files.filter((file) =>
    file.contentType.startsWith("video/"),
  );
  const audioFiles = post.files.filter((file) =>
    file.contentType.startsWith("audio/"),
  );
  const otherFiles = post.files.filter(
    (file) =>
      !file.contentType.startsWith("image/") &&
      !file.contentType.startsWith("video/") &&
      !file.contentType.startsWith("audio/"),
  );

  const MAX_REACTION_AVATARS = 5;
  const reactionChips =
    post.reactionCounts && Object.keys(post.reactionCounts).length > 0
      ? Object.entries(post.reactionCounts).map(([emoji, count]) => {
          const reactionsForEmoji =
            post.reactions?.filter((reaction) => reaction.emoji === emoji) ??
            [];
          const isMine = reactionsForEmoji.some(
            (reaction) => reaction.user?.id === user?.id,
          );
          const visibleReactions = reactionsForEmoji.slice(
            0,
            MAX_REACTION_AVATARS,
          );
          const hiddenCount = count - visibleReactions.length;
          const title = reactionsForEmoji
            .map((reaction) => reaction.user?.displayName)
            .filter((name): name is string => Boolean(name))
            .join(", ");
          return (
            <button
              type="button"
              className={`reaction-chip${isMine ? " is-active" : ""}`}
              key={emoji}
              title={title || undefined}
              onClick={() => onReaction?.(emoji)}
              disabled={!onReaction}
            >
              <span className="reaction-chip__emoji">
                <ReactionIcon emoji={emoji} />
              </span>
              {visibleReactions.length > 0 && (
                <span className="reaction-chip__avatars">
                  {visibleReactions.map((reaction, index) => (
                    <span
                      className="reaction-avatar-slot"
                      key={reaction.user?.id ?? index}
                      style={{ zIndex: visibleReactions.length - index }}
                    >
                      <ReactionAvatar
                        displayName={reaction.user?.displayName}
                        avatarUrl={reaction.user?.avatarUrl}
                      />
                    </span>
                  ))}
                  {hiddenCount > 0 && (
                    <span
                      className="reaction-avatar-slot reaction-avatar-more"
                      style={{ zIndex: 0 }}
                    >
                      +{hiddenCount}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })
      : null;
  const hasReactions = post.files.length > 0 && !!reactionChips;
  const reactionsOverlay = hasReactions ? (
    <div className="post-reactions">{reactionChips}</div>
  ) : null;
  const reactionsInline =
    post.files.length === 0 && reactionChips ? (
      <div className="post-reactions post-reactions--inline">
        {reactionChips}
      </div>
    ) : null;
  const articleText =
    post.blocks?.find((block) => block.type === "text")?.text?.trim() ?? "";
  const hasPostText = post.isArticle
    ? Boolean(post.title?.trim() || articleText)
    : Boolean(post.text?.trim());
  const isMediaOnly = post.files.length > 0 && !hasPostText && !reactionChips;
  const isReactionsOnly =
    post.files.length === 0 && !hasPostText && !!reactionChips;
  const isTextOnly = post.files.length === 0 && hasPostText;

  return (
    <PhotoProvider>
      <ContextMenu
        post={post as Post}
        canDelete={user?.id === post.author.id || isAdmin()}
        onReaction={onReaction}
        onComment={() => {
          if (onOpenComments) onOpenComments();
          else setLocalCommentsOpen(true);
        }}
        onDelete={onDeletePost ? () => onDeletePost(post.id) : undefined}
      >
        <article
          className={`post${showAuthor ? " post--with-author" : " post--continuation"}${isMine ? " post--mine" : ""}`}
        >
          {showAuthor ? (
            authorLinks ? (
              <Link className="post-avatar-link" to={profileUrl}>
                {author}
              </Link>
            ) : (
              <span className="post-avatar-link">{author}</span>
            )
          ) : (
            <span className="post-avatar-spacer" aria-hidden="true" />
          )}
          <div
            className={`post-body${imageFiles.length > 1 ? " post-body--with-files" : ""}${isMediaOnly ? " post-body--media-only" : ""}${isReactionsOnly ? " post-body--reactions-only" : ""}${isTextOnly ? " post-body--text-only" : ""}`}
          >
            {showAuthor && (
              <div className="post-meta">
                <div>
                  {authorLinks ? (
                    <Link
                      className="post-author"
                      to={profileUrl}
                      style={{ color: authorColor }}
                    >
                      {post.author.displayName}
                    </Link>
                  ) : (
                    <span
                      className="post-author"
                      style={{ color: authorColor }}
                    >
                      {post.author.displayName}
                    </span>
                  )}
                </div>
              </div>
            )}
            {post.files.length > 0 && (
              <div className="post-files-wrap">
                <div className="post-files">
                  {imageFiles.length > 0 && (
                    <PostImageGallery files={imageFiles} />
                  )}
                  {videoFiles.map((file) => (
                    <PostVideo key={file.id} file={file} />
                  ))}
                  {audioFiles.map((file) => (
                    <div className="post-audio" key={file.id}>
                      <AudioPlayer>
                        <AudioSkin>
                          <Audio
                            src={getBrowserFileUrl(file.downloadUrl)}
                            playsInline
                          />
                        </AudioSkin>
                      </AudioPlayer>
                    </div>
                  ))}
                  {otherFiles.map((file) => (
                    <a
                      className="post-file"
                      key={file.id}
                      href={getBrowserFileUrl(file.downloadUrl)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="file-icon">📄</span>
                      <span>
                        <strong>{file.fileName}</strong>
                        <small>{Math.round(file.sizeBytes / 1024)} KB</small>
                      </span>
                    </a>
                  ))}
                </div>
                {imageFiles.length > 0 && !hasPostText && (
                  <span className="post-time post-time--on-image">
                    {new Date(post.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>
            )}
            {hasPostText && (
              <div className="post-content-row">
                {post.isArticle ? (
                  <div className="article-preview">
                    <h2>{post.title}</h2>
                    <p className="post-text">
                      {post.blocks?.find((block) => block.type === "text")
                        ?.text ?? ""}
                    </p>
                    {showArticleLink && (
                      <Link to={`/posts/${post.id}`}>Читать далее →</Link>
                    )}
                  </div>
                ) : (
                  <p className="post-text">{post.text}</p>
                )}
                <span className="post-time post-time--bottom">
                  {new Date(post.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            )}
            {reactionsOverlay ?? reactionsInline}
            {post.relatedPostId && (
              <Link
                className="post-related-link"
                to={`/posts/${post.relatedPostId}`}
              >
                Читать постишку →
              </Link>
            )}
            {imageFiles.length === 0 && !hasPostText && (
              <span
                className={`post-time post-time--bottom${videoFiles.length > 0 ? " post-time--below-video" : ""}`}
              >
                {new Date(post.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
            {commentsVisible && (
              <div className="post-comments">
                {post.comments.map((comment) => (
                  <CommentItem
                    key={comment.id}
                    comment={comment}
                    onLike={onCommentLike}
                  />
                ))}
                {onCommentSubmit && (
                  <form
                    className="comment-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const input = event.currentTarget.elements.namedItem(
                        "comment",
                      ) as HTMLInputElement;
                      onCommentSubmit(input.value);
                      input.value = "";
                    }}
                  >
                    <input
                      className="input"
                      name="comment"
                      placeholder="Написать комментарий..."
                      maxLength={1000}
                    />
                    <button
                      className="btn-icon-filled"
                      type="submit"
                      aria-label="Отправить комментарий"
                      data-tooltip="Отправить"
                    >
                      <img src={sendIcon} alt="" aria-hidden="true" />
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </article>
      </ContextMenu>
    </PhotoProvider>
  );
}
