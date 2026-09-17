type AvatarMediaProps = {
  src: string;
  className?: string;
  alt?: string;
};

function isVideoAvatar(src: string) {
  try {
    return decodeURIComponent(src).includes('avatar-video/');
  } catch {
    return src.includes('avatar-video/');
  }
}

export function AvatarMedia({ src, className, alt = '' }: AvatarMediaProps) {
  return isVideoAvatar(src) ? (
    <video className={className} src={src} autoPlay loop muted playsInline aria-label={alt} />
  ) : (
    <img className={className} src={src} alt={alt} />
  );
}