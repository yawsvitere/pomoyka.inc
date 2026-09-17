import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject, SyntheticEvent } from "react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import { Spinner } from "./Spinner";
import { MediaModal } from "./MediaModal";
import { getBrowserFileUrl } from "../../utils/fileUrl";
import "react-photo-view/dist/react-photo-view.css";
import "../../styles/components/pinterest.css";

export type PinterestImage = {
  id: string;
  fileName: string;
  url: string;
  contentType: string;
  width: number | null;
  height: number | null;
  previewUrl: string | null;
};

const LOAD_MARGIN_PX = { image: 400, video: 150 } as const;
const UNLOAD_DELAY_MS = 4000;
const COLUMN_WIDTH = 360;
const COLUMN_GAP = 6;

function guessAspectRatio(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return [0.75, 0.8, 1, 1.1, 1.25, 1.33, 1.5][hash % 7];
}

function usePinterestColumns(images: PinterestImage[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const getColumnCount = (width: number) => {
    if (width <= 640) return 2;
    return Math.max(1, Math.floor((width + COLUMN_GAP) / (COLUMN_WIDTH + COLUMN_GAP)));
  };
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const update = (width: number) => setColumnCount(getColumnCount(width));
    update(element.getBoundingClientRect().width);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width));
      observer.observe(element);
      return () => observer.disconnect();
    }
    const handleResize = () => update(element.getBoundingClientRect().width);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const columns = useMemo(() => {
    const heights = new Array(columnCount).fill(0);
    const result: PinterestImage[][] = Array.from({ length: columnCount }, () => []);
    for (const image of images) {
      const ratio = image.width && image.height ? image.height / image.width : 1;
      const target = heights.indexOf(Math.min(...heights));
      result[target].push(image);
      heights[target] += ratio * COLUMN_WIDTH + COLUMN_GAP;
    }
    return result;
  }, [columnCount, images]);

  return { containerRef, columns };
}


function useMediaVisibility<T extends HTMLElement>(containerRef: RefObject<T | null>, marginPx: number) {
  const [isVisible, setIsVisible] = useState(false);
  const releaseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return undefined;
    }

    const clearReleaseTimer = () => {
      if (releaseTimerRef.current !== null) window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          clearReleaseTimer();
          setIsVisible(true);
        } else {
          clearReleaseTimer();
          releaseTimerRef.current = window.setTimeout(() => setIsVisible(false), UNLOAD_DELAY_MS);
        }
      },
      { rootMargin: `${marginPx}px 0px` },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      clearReleaseTimer();
    };
  }, [containerRef, marginPx]);

  return isVisible;
}

function PinterestCard({
  image,
  onOpenVideo,
}: {
  image: PinterestImage;
  onOpenVideo: (video: { name: string; url: string }) => void;
}) {
  const isVideo = image.contentType.startsWith("video/");
  const mediaUrl = getBrowserFileUrl(image.url);
  const previewUrl = getBrowserFileUrl(image.previewUrl ?? image.url);
  const [videoSource, setVideoSource] = useState(previewUrl);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [aspectRatio, setAspectRatio] = useState(image.width && image.height ? image.width / image.height : guessAspectRatio(image.id));
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);

  const isVisible = useMediaVisibility(containerRef, LOAD_MARGIN_PX[isVideo ? "video" : "image"]);


  useEffect(() => {
    if (!isVisible) {
      setIsReady(false);
      setHasError(false);
    }
  }, [isVisible]);


  useEffect(() => {
    if (!isVideo || isVisible || !videoRef.current) return;
    const video = videoRef.current;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }, [isVideo, isVisible]);

  useEffect(() => {
    if (!isVideo || !videoRef.current || typeof IntersectionObserver === "undefined") return undefined;
    const video = videoRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.1 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [isVideo]);

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const imageElement = event.currentTarget;
    if (!image.width && !image.height) setAspectRatio(imageElement.naturalWidth / imageElement.naturalHeight);
    setIsReady(true);
  };
  const handleVideoMeta = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (!image.width && !image.height) setAspectRatio(video.videoWidth / video.videoHeight);
    setIsReady(true);
  };

  const videoSrc = isVideo && isVisible ? videoSource : undefined;
  const handleVideoError = () => {
    if (videoSource !== mediaUrl) {
      setVideoSource(mediaUrl);
      return;
    }
    setHasError(true);
  };
  const imgSrc = !isVideo && isVisible ? previewUrl : undefined;

  return <div ref={containerRef} className={`pinterest-card${isReady ? " is-ready" : " is-loading"}`} style={{ aspectRatio: String(aspectRatio) }}>
    {!isReady && !hasError && <Spinner className="spinner--media" label={isVideo ? "Загрузка видео" : "Загрузка изображения"} />}
    {hasError && <div className="pinterest-media-error">Не удалось загрузить</div>}
    {isVideo ? <video ref={videoRef} src={videoSrc} aria-label={image.fileName} muted loop playsInline preload="metadata" onClick={() => onOpenVideo({ name: image.fileName, url: mediaUrl })} onLoadedMetadata={handleVideoMeta} onError={handleVideoError} /> : <PhotoView src={mediaUrl}>
      <a href={mediaUrl} target="_blank" rel="noreferrer" onClick={(event) => event.preventDefault()}>
        <img src={imgSrc} alt={image.fileName} loading="lazy" decoding="async" onLoad={handleImageLoad} onError={() => setHasError(true)} />
      </a>
    </PhotoView>}
  </div>;
}

export function Pinterest({ images }: { images: PinterestImage[] }) {
  const { containerRef, columns } = usePinterestColumns(images);
  const [activeVideo, setActiveVideo] = useState<{ name: string; url: string } | null>(null);
  return <>
    <PhotoProvider speed={() => 0}><div ref={containerRef} className="pinterest-grid">
      {columns.map((column, columnIndex) => <div className="pinterest-column" key={columnIndex}>
        {column.map((image) => <PinterestCard key={image.id} image={image} onOpenVideo={setActiveVideo} />)}
      </div>)}
    </div></PhotoProvider>
    {activeVideo && <MediaModal type="video" name={activeVideo.name} url={activeVideo.url} onClose={() => setActiveVideo(null)} />}
  </>;
}