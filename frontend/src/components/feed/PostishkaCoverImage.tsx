import { useEffect, useState, type ReactNode } from "react";
import * as postsApi from "../../api/posts";

interface PostishkaCoverImageProps {
  postId: string;
  hasOgCover?: boolean;
  fallbackUrl?: string | null;
  alt?: string;
  className?: string;
  placeholder?: ReactNode;
}

export function PostishkaCoverImage({
  postId,
  hasOgCover = false,
  fallbackUrl,
  alt = "",
  className,
  placeholder,
}: PostishkaCoverImageProps) {
  const [loadedCover, setLoadedCover] = useState<{
    postId: string;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (!hasOgCover) return;

    let active = true;
    let objectUrl: string | null = null;
    void postsApi
      .getPostishkaCover(postId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setLoadedCover({ postId, url: objectUrl });
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        if (active) setLoadedCover({ postId, url: "" });
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [postId, hasOgCover]);

  const isCurrentCover = loadedCover?.postId === postId;
  const src = hasOgCover
    ? isCurrentCover
      ? loadedCover.url || fallbackUrl
      : null
    : fallbackUrl;

  return src ? (
    <img className={className} src={src} alt={alt} />
  ) : (
    placeholder ?? null
  );
}
