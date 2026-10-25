import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from "react";
import { Audio, AudioPlayer, AudioSkin } from "@videojs/react/audio";
import "@videojs/react/audio/skin.css";
import { Video, VideoPlayer, VideoSkin } from "@videojs/react/video";
import "@videojs/react/video/skin.css";
import { PhotoProvider, PhotoView } from "react-photo-view";
import type { Post } from "../../api/types";
import { apiClient } from "../../api/client";
import { CommentItem } from "./CommentItem";
import { CommentComposer } from "./CommentComposer";
import { ContextMenu, ReactionChip } from "./ContextMenu";
import { useAuth } from "../../context/AuthContext";
import { getBrowserFileUrl } from "../../utils/fileUrl";
import { AvatarMedia } from "../ui/AvatarMedia";
import { MediaModal } from "../ui/MediaModal";
import { AppExternalLink, AppLink } from "../ui/AppLink";
import { getPostishkaUrl } from "../../utils/postishkaUrl";
export type PostCardData = Omit<Post, "reactionCounts" | "reactions"> &
  Partial<Pick<Post, "reactionCounts" | "reactions">>;
interface PostCardProps {
  post: PostCardData;
  showAuthor?: boolean;
  commentsOpen?: boolean;
  authorLinks?: boolean;
  showArticleLink?: boolean;
  videoPreview?: boolean;
  delayedPreviewFileIds?: ReadonlySet<string>;
  onPreviewDelayComplete?: (fileId: string) => void;
  isOwnPost?: boolean;
  onOpenComments?: () => void;
  onCommentReaction?: (commentId: string, emoji: string) => void;
  onReaction?: (emoji: string) => void;
  onCommentSubmit?: (commentText: string, files: File[]) => Promise<boolean>;
  onDeletePost?: (postId: string) => void;
}

const GAP = 4;
const TARGET_ROW_HEIGHT = 220;
const MIN_ROW_HEIGHT = 150;
const MAX_ROW_HEIGHT = 360;
const MAX_TALL_MEDIA_HEIGHT = 500;
const MAX_SINGLE_IMAGE_WIDTH = 865;
const FALLBACK_GALLERY_WIDTH = 600;
const PREVIEW_START_DELAY_MS = 30;
const PREVIEW_RETRY_DELAY_MS = 400;
const NO_DELAYED_PREVIEW_FILE_IDS: ReadonlySet<string> = new Set();

const ratioCache = new Map<string, ImageRatio>();
const loadedImageCache = new Set<string>();
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

const DEFAULT_RATIO = 4 / 3;

function getDimensions(
  file: Post["files"][number],
  ratioMap: Record<string, ImageRatio>,
): ImageRatio | undefined {
  const { width, height } = file as {
    width?: number | null;
    height?: number | null;
  };
  if (width && height) return { width, height };
  return ratioMap[file.id];
}

function getRatio(
  file: Post["files"][number],
  ratioMap: Record<string, ImageRatio>,
) {
  const dimensions = getDimensions(file, ratioMap);
  return dimensions ? dimensions.width / dimensions.height : DEFAULT_RATIO;
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

function PostishkaOgPreview({
  postId,
  href,
}: {
  postId: string;
  href: string;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    void apiClient
      .get<Blob>(`/api/posts/og/${postId}.webp`, { responseType: "blob" })
      .then(({ data }) => {
        objectUrl = URL.createObjectURL(data);
        if (active) setImageUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [postId]);

  return (
    <AppLink className="postishka-og-preview" to={href}>
      {imageUrl ? (
        <img src={imageUrl} loading="lazy" />
      ) : (
        <div className="postishka-og-placeholder">
          {failed ? "Превью недоступно" : "Загружаем превью…"}
        </div>
      )}
      <span className="postishka-og-action">
        <span>
          Открыть постишку
          <span className="postishka-og-arrow" aria-hidden="true">
            →
          </span>
        </span>
      </span>
    </AppLink>
  );
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
  if (!files.length) return { type: "rows", rows: [] };

  const mosaic = calculateMosaicLayout(files, ratioMap);
  if (mosaic) return mosaic;

  return calculateRows(
    files,
    containerWidth || FALLBACK_GALLERY_WIDTH,
    ratioMap,
  );
}

function GalleryVideoTile({
  file,
  autoPlay,
  enabled,
  onMetadata,
  onOpen,
}: {
  file: Post["files"][number];
  autoPlay: boolean;
  enabled: boolean;
  onMetadata: (fileId: string, width: number, height: number) => void;
  onOpen: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [useOriginal, setUseOriginal] = useState(false);
  const [loaded, setLoaded] = useState(() => loadedImageCache.has(file.id));
  const [playing, setPlaying] = useState(false);
  const src = getBrowserFileUrl(
    useOriginal ? file.downloadUrl : file.previewUrl,
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !autoPlay || !enabled) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      void video.play().catch(() => undefined);
      return () => video.pause();
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.25 },
    );
    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, [autoPlay, enabled, src]);

  return (
    <button
      type="button"
      className="post-video-tile"
      data-loaded={loaded ? "true" : "false"}
      data-playing={playing ? "true" : "false"}
      aria-label={`Открыть видео ${file.fileName}`}
      onClick={onOpen}
      onMouseEnter={() => {
        if (!autoPlay) void videoRef.current?.play().catch(() => undefined);
      }}
      onMouseLeave={() => {
        if (!autoPlay) videoRef.current?.pause();
      }}
    >
      <video
        ref={videoRef}
        src={enabled ? `${src}${src.includes("#") ? "" : "#t=0.1"}` : undefined}
        aria-hidden="true"
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          const { videoWidth, videoHeight } = event.currentTarget;
          loadedImageCache.add(file.id);
          setLoaded(true);
          onMetadata(file.id, videoWidth, videoHeight);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          if (!useOriginal) setUseOriginal(true);
        }}
      />
      <span className="post-video-badge" aria-hidden="true" />
    </button>
  );
}

function PostImageGallery({
  files,
  videoAutoPlay = false,
  delayedPreviewFileIds = NO_DELAYED_PREVIEW_FILE_IDS,
  onPreviewDelayComplete,
  onOpenVideo,
}: {
  files: Post["files"];
  videoAutoPlay?: boolean;
  delayedPreviewFileIds?: ReadonlySet<string>;
  onPreviewDelayComplete?: (fileId: string) => void;
  onOpenVideo?: (video: { name: string; url: string }) => void;
}) {
  const galleryRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [startedPreviewFileIds, setStartedPreviewFileIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [retryCounts, setRetryCounts] = useState<Record<string, number>>({});
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        files
          .filter((file) => loadedImageCache.has(file.id))
          .map((file) => [file.id, true]),
      ),
  );
  const [originalFallbacks, setOriginalFallbacks] = useState<
    Record<string, boolean>
  >({});
  const [, setRatiosVersion] = useState(0);
  const ratioMapRef = useRef<Record<string, ImageRatio>>(
    Object.fromEntries(
      files.flatMap((file) => {
        const cached = ratioCache.get(file.id);
        return cached ? [[file.id, cached] as const] : [];
      }),
    ),
  );
  const retryTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const previewStartTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  useEffect(() => {
    for (const file of files) {
      if (
        !delayedPreviewFileIds.has(file.id) ||
        loadedImageCache.has(file.id) ||
        startedPreviewFileIds.has(file.id) ||
        previewStartTimersRef.current[file.id]
      )
        continue;

      previewStartTimersRef.current[file.id] = setTimeout(() => {
        delete previewStartTimersRef.current[file.id];
        setStartedPreviewFileIds((started) => {
          const next = new Set(started);
          next.add(file.id);
          return next;
        });
        onPreviewDelayComplete?.(file.id);
      }, PREVIEW_START_DELAY_MS);
    }
  }, [
    files,
    delayedPreviewFileIds,
    startedPreviewFileIds,
    onPreviewDelayComplete,
  ]);
  useEffect(
    () => () => {
      Object.values(retryTimersRef.current).forEach(clearTimeout);
      Object.values(previewStartTimersRef.current).forEach(clearTimeout);
    },
    [],
  );

  useLayoutEffect(() => {
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
      ratioCache.set(fileId, ratioMapRef.current[fileId]);
      setRatiosVersion((version) => version + 1);
    }
  };
  const handleVideoMetadata = (
    fileId: string,
    width: number,
    height: number,
  ) => {
    if (ratioMapRef.current[fileId] || !width || !height) return;
    ratioMapRef.current[fileId] = { width, height };
    ratioCache.set(fileId, ratioMapRef.current[fileId]);
    setRatiosVersion((version) => version + 1);
  };
  const isPreviewStarted = (fileId: string) =>
    !delayedPreviewFileIds.has(fileId) ||
    loadedImageCache.has(fileId) ||
    startedPreviewFileIds.has(fileId);
  const renderImage = (item: GalleryItem) => {
    const fileUrl = getBrowserFileUrl(item.file.downloadUrl);
    const previewUrl = getBrowserFileUrl(item.file.previewUrl);
    const retryCount = retryCounts[item.file.id] ?? 0;
    const imageUrl = originalFallbacks[item.file.id]
      ? fileUrl
      : retryCount
        ? `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}retry=${retryCount}`
        : previewUrl;
    const isVideo = item.file.contentType.startsWith("video/");
    const isSingleImage = files.length === 1 && !isVideo;
    const dimensions = getDimensions(item.file, ratioMapRef.current);
    const singleImageWidth = Math.min(
      MAX_SINGLE_IMAGE_WIDTH,
      MAX_TALL_MEDIA_HEIGHT * item.ratio,
      dimensions?.width ?? Number.POSITIVE_INFINITY,
    );

    return (
      <div
        className={`post-image-link${isSingleImage ? " post-image-link--single" : ""}${isVideo ? " post-image-link--video" : ""}`}
        data-post-file-id={item.file.id}
        key={item.file.id}
        style={{
          flex: layout.type === "rows" ? `${item.ratio} 1 0` : undefined,
          width: isSingleImage
            ? `${singleImageWidth}px`
            : layout.type === "mosaic"
              ? "100%"
              : undefined,
          height:
            layout.type === "mosaic" && !isSingleImage ? "100%" : undefined,
          aspectRatio:
            isSingleImage || layout.type === "mosaic" ? item.ratio : undefined,
        }}
      >
        {isVideo ? (
          <GalleryVideoTile
            file={item.file}
            autoPlay={videoAutoPlay}
            enabled={isPreviewStarted(item.file.id)}
            onMetadata={handleVideoMetadata}
            onOpen={() =>
              onOpenVideo?.({
                name: item.file.fileName,
                url: fileUrl,
              })
            }
          />
        ) : (
          <PhotoView src={fileUrl}>
            <img
              className="post-image"
              src={
                isPreviewStarted(item.file.id) ||
                originalFallbacks[item.file.id]
                  ? imageUrl
                  : undefined
              }
              data-loaded={loadedImages[item.file.id] ? "true" : "false"}
              onLoad={(event) => {
                loadedImageCache.add(item.file.id);
                setLoadedImages((loaded) => ({
                  ...loaded,
                  [item.file.id]: true,
                }));
                handleImageLoad(event, item.file.id);
              }}
              onError={() => {
                if (originalFallbacks[item.file.id]) return;
                if (retryCount >= 12) {
                  setOriginalFallbacks((fallbacks) => ({
                    ...fallbacks,
                    [item.file.id]: true,
                  }));
                  return;
                }
                clearTimeout(retryTimersRef.current[item.file.id]);
                retryTimersRef.current[item.file.id] = setTimeout(() => {
                  delete retryTimersRef.current[item.file.id];
                  setRetryCounts((counts) => ({
                    ...counts,
                    [item.file.id]: (counts[item.file.id] ?? 0) + 1,
                  }));
                }, PREVIEW_RETRY_DELAY_MS);
              }}
              style={{ objectFit: "cover" }}
            />
          </PhotoView>
        )}
      </div>
    );
  };
  return (
    <div
      className={`post-photo-gallery${files.length === 1 ? " post-photo-gallery--single" : ""}`}
      ref={galleryRef}
    >
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

function PostVideo({
  file,
  onOpenVideo,
  minWidth,
}: {
  file: Post["files"][number];
  onOpenVideo?: (video: { name: string; url: string }) => void;
  minWidth?: number;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [videoWidth, setVideoWidth] = useState<number | null>(null);
  const isPreview = Boolean(onOpenVideo);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewIsVisibleRef = useRef(false);

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth, videoHeight } = event.currentTarget;
    if (!videoWidth || !videoHeight) return;
    setRatio(videoWidth / videoHeight);
    setVideoWidth(videoWidth);
  };

  useEffect(() => {
    if (!isPreview || !previewVideoRef.current) return undefined;
    const video = previewVideoRef.current;
    if (typeof IntersectionObserver === "undefined") {
      previewIsVisibleRef.current = true;
      void video.play().catch(() => undefined);
      return () => {
        previewIsVisibleRef.current = false;
        video.pause();
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        previewIsVisibleRef.current = entry.isIntersecting;
        if (entry.isIntersecting) {
          void video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(video);
    return () => {
      previewIsVisibleRef.current = false;
      observer.disconnect();
      video.pause();
    };
  }, [isPreview]);

  const handlePreviewCanPlay = (event: SyntheticEvent<HTMLVideoElement>) => {
    if (previewIsVisibleRef.current)
      void event.currentTarget.play().catch(() => undefined);
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
    style.width = `${Math.max(
      ratio >= 1 ? (minWidth ?? 0) : 0,
      videoWidth * scale,
    )}px`;
    style.maxWidth = "100%";
  }

  return (
    <div className="post-video" data-post-file-id={file.id} style={style}>
      {onOpenVideo ? (
        <button
          type="button"
          className="post-video-preview"
          aria-label={`Открыть видео ${file.fileName}`}
          onClick={() =>
            onOpenVideo({
              name: file.fileName,
              url: getBrowserFileUrl(file.downloadUrl),
            })
          }
        >
          <video
            ref={previewVideoRef}
            src={getBrowserFileUrl(file.previewUrl)}
            aria-hidden="true"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onLoadedMetadata={handleLoadedMetadata}
            onCanPlay={handlePreviewCanPlay}
          />
        </button>
      ) : (
        <VideoPlayer>
          <VideoSkin>
            <Video
              src={getBrowserFileUrl(file.downloadUrl)}
              playsInline
              onLoadedMetadata={handleLoadedMetadata}
            />
          </VideoSkin>
        </VideoPlayer>
      )}
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
  videoPreview = false,
  delayedPreviewFileIds = NO_DELAYED_PREVIEW_FILE_IDS,
  onPreviewDelayComplete,
  isOwnPost = false,
  onOpenComments,
  onCommentReaction,
  onReaction,
  onCommentSubmit,
  onDeletePost,
}: PostCardProps) {
  const { user } = useAuth();
  const [localCommentsOpen, setLocalCommentsOpen] = useState(false);
  const [activeVideo, setActiveVideo] = useState<{
    name: string;
    url: string;
  } | null>(null);
  const [reactionAnimation, setReactionAnimation] = useState<{
    emoji: string;
    trigger: number;
  } | null>(null);
  const reactionAnimationCounterRef = useRef(0);
  const isMine = isOwnPost || user?.id === post.author.id;
  const handleContextReaction = (emoji: string) => {
    const isAlreadyMine = post.reactions?.some(
      (reaction) => reaction.emoji === emoji && reaction.user?.id === user?.id,
    );
    if (!isAlreadyMine) {
      reactionAnimationCounterRef.current += 1;
      setReactionAnimation({
        emoji,
        trigger: reactionAnimationCounterRef.current,
      });
    }
    onReaction?.(emoji);
  };
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
  const postishkaHref = post.isPostishka
    ? getPostishkaUrl(post)
    : `/posts/${post.relatedPostId}`;
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

  // Фото и видео — в одну общую сетку. Одиночное видео остаётся плеером.
  const mediaFiles = post.files.filter(
    (file) =>
      file.contentType.startsWith("image/") ||
      file.contentType.startsWith("video/"),
  );
  const galleryFiles =
    mediaFiles.length > 1 || imageFiles.length === 1 ? mediaFiles : [];
  const singleVideo =
    mediaFiles.length === 1 && videoFiles.length === 1 ? videoFiles[0] : null;

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
          const animateTrigger =
            reactionAnimation?.emoji === emoji ? reactionAnimation.trigger : 0;
          return (
            <ReactionChip
              key={`${emoji}:${animateTrigger}`}
              emoji={emoji}
              isMine={isMine}
              animateTrigger={animateTrigger}
              title={title || undefined}
              onClick={() => onReaction?.(emoji)}
              disabled={!onReaction}
            >
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
            </ReactionChip>
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
  const hasPostText =
    !post.relatedPostId &&
    (post.isArticle
      ? Boolean(post.title?.trim() || articleText)
      : Boolean(post.text?.trim()));
  const isMediaOnly = post.files.length > 0 && !hasPostText;
  const isReactionsOnly =
    post.files.length === 0 && !hasPostText && !!reactionChips;
  const isTextOnly = post.files.length === 0 && hasPostText;

  return (
    <PhotoProvider>
      <ContextMenu
        post={post as Post}
        canDelete={user?.id === post.author.id || isAdmin()}
        onReaction={handleContextReaction}
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
              <AppLink className="post-avatar-link" to={profileUrl}>
                {author}
              </AppLink>
            ) : (
              <span className="post-avatar-link">{author}</span>
            )
          ) : (
            <span className="post-avatar-spacer" aria-hidden="true" />
          )}
          <div
            className={`post-body${galleryFiles.length > 1 ? " post-body--with-files" : ""}${galleryFiles.length === 1 ? " post-body--single-image" : ""}${isMediaOnly ? " post-body--media-only" : ""}${isReactionsOnly ? " post-body--reactions-only" : ""}${isTextOnly ? " post-body--text-only" : ""}${post.isPostishka || post.relatedPostId ? " post-body--postishka-preview" : ""}`}
          >
            {showAuthor && (
              <div className="post-meta">
                <div>
                  {authorLinks ? (
                    <AppLink
                      className="post-author"
                      to={profileUrl}
                      style={{ color: authorColor }}
                    >
                      {post.author.displayName}
                    </AppLink>
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
            {post.files.length > 0 && !post.isPostishka && (
              <div className="post-files-wrap">
                <div className="post-files">
                  {galleryFiles.length > 0 && (
                    <PostImageGallery
                      files={galleryFiles}
                      videoAutoPlay={videoPreview}
                      delayedPreviewFileIds={delayedPreviewFileIds}
                      onPreviewDelayComplete={onPreviewDelayComplete}
                      onOpenVideo={(video) => setActiveVideo(video)}
                    />
                  )}
                  {singleVideo && (
                    <PostVideo
                      key={singleVideo.id}
                      file={singleVideo}
                      minWidth={
                        videoPreview && post.files.length === 1 ? 550 : 0
                      }
                      onOpenVideo={
                        videoPreview
                          ? (video) => setActiveVideo(video)
                          : undefined
                      }
                    />
                  )}
                  {audioFiles.map((file) => (
                    <div
                      className="post-audio"
                      data-post-file-id={file.id}
                      key={file.id}
                    >
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
                    <AppExternalLink
                      className="post-file"
                      data-post-file-id={file.id}
                      key={file.id}
                      href={getBrowserFileUrl(file.downloadUrl)}
                    >
                      <span className="file-icon">📄</span>
                      <span>
                        <strong>{file.fileName}</strong>
                        <small>{Math.round(file.sizeBytes / 1024)} KB</small>
                      </span>
                    </AppExternalLink>
                  ))}
                </div>
                {(galleryFiles.length > 0 || (videoPreview && singleVideo)) &&
                  !hasPostText &&
                  !reactionChips && (
                    <span className="post-time post-time--on-image">
                      {new Date(post.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
              </div>
            )}
            {post.isPostishka ? (
              <>
                <PostishkaOgPreview postId={post.id} href={postishkaHref} />
                {!reactionChips && (
                  <span className="post-time post-time--bottom">
                    {new Date(post.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </>
            ) : hasPostText ? (
              <div className="post-content-row">
                {post.isArticle ? (
                  <div className="article-preview">
                    <h2>{post.title}</h2>
                    <p className="post-text">
                      {post.blocks?.find((block) => block.type === "text")
                        ?.text ?? ""}
                    </p>
                    {showArticleLink && (
                      <AppLink
                        to={
                          post.isPostishka
                            ? getPostishkaUrl(post)
                            : `/posts/${post.id}`
                        }
                      >
                        Читать далее →
                      </AppLink>
                    )}
                  </div>
                ) : (
                  <p className="post-text">{post.text}</p>
                )}
                {!reactionChips && (
                  <span className="post-time post-time--bottom">
                    {new Date(post.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>
            ) : null}
            {post.relatedPostId && !post.isPostishka && (
              <PostishkaOgPreview
                postId={post.relatedPostId}
                href={postishkaHref}
              />
            )}
            {reactionChips ? (
              <div className="post-reactions-footer">
                {reactionsOverlay ?? reactionsInline}
                <span className="post-time post-time--bottom">
                  {new Date(post.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ) : (
              (reactionsOverlay ?? reactionsInline)
            )}
            {!reactionChips &&
              !post.isPostishka &&
              galleryFiles.length === 0 &&
              !(videoPreview && singleVideo) &&
              !hasPostText && (
                <span
                  className={`post-time post-time--bottom${singleVideo ? " post-time--below-video" : ""}`}
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
                    onReaction={onCommentReaction}
                  />
                ))}
                {onCommentSubmit && (
                  <CommentComposer onSubmit={onCommentSubmit} />
                )}
              </div>
            )}
          </div>
        </article>
      </ContextMenu>
      {activeVideo && (
        <MediaModal
          type="video"
          name={activeVideo.name}
          url={activeVideo.url}
          onClose={() => setActiveVideo(null)}
        />
      )}
    </PhotoProvider>
  );
}
