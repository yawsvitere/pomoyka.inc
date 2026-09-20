import { useEffect, useState } from "react";

type AvatarMediaProps = {
  src: string;
  className?: string;
  alt?: string;
};

function isVideoAvatar(src: string) {
  try {
    return decodeURIComponent(src).includes("avatar-video/");
  } catch {
    return src.includes("avatar-video/");
  }
}

export function AvatarMedia({ src, className, alt = "" }: AvatarMediaProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (hasError) {
    return (
      <span
        className={
          className
            ? `${className} avatar-media-fallback`
            : "avatar-media-fallback"
        }
        role="img"
        aria-label={alt}
      >
        ?
      </span>
    );
  }

  return isVideoAvatar(src) ? (
    <video
      className={className}
      src={src}
      autoPlay
      loop
      muted
      playsInline
      aria-label={alt}
      onError={() => setHasError(true)}
    />
  ) : (
    <img
      className={className}
      src={src}
      alt={alt}
      onError={() => setHasError(true)}
    />
  );
}
