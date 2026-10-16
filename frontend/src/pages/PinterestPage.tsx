import { useCallback, useEffect, useRef, useState } from "react";
import * as filesApi from "../api/files";
import { InfiniteScroll } from "../components/ui/InfiniteScroll";
import { Pinterest } from "../components/ui/Pinterest";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../components/ui/useToast";
import "../styles/pages/pinterest.css";

function shuffleMedia(items: filesApi.PinterestMedia[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

export function PinterestPage() {
  const { notify } = useToast();
  const [media, setMedia] = useState<filesApi.PinterestMedia[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [shuffleSeed] = useState(
    () => Math.floor(Math.random() * 2_147_483_647),
  );
  const pageRef = useRef(1);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    let active = true;
    void filesApi.getPinterestMedia(1, 50, shuffleSeed)
      .then((result) => {
        if (active) {
          setMedia(shuffleMedia(result.items));
          setHasMore(result.hasMore);
        }
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
          notify("error", "Не удалось загрузить Pinterest");
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notify, shuffleSeed]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || loadMoreFailed) return;
    loadingMoreRef.current = true;
    try {
      const nextPage = pageRef.current + 1;
      const result = await filesApi.getPinterestMedia(nextPage, 50, shuffleSeed);
      setMedia((current) => [...current, ...shuffleMedia(result.items)]);
      pageRef.current = nextPage;
      setHasMore(result.hasMore);
    } catch {
      setLoadMoreFailed(true);
      notify("error", "Не удалось загрузить следующие изображения");
    } finally {
      loadingMoreRef.current = false;
    }
  }, [hasMore, loadMoreFailed, notify, shuffleSeed]);

  if (isLoading) {
    return <div className="pinterest-page-state"><Spinner label="Загрузка Pinterest" /></div>;
  }

  const images = media.map((item) => ({
    id: item.id,
    fileName: item.fileName,
    url: item.downloadUrl,
    contentType: item.contentType,
    width: item.width,
    height: item.height,
    previewUrl: item.previewUrl,
  }));

  return (
    <section className="pinterest-page">
      <header className="pinterest-page-header">
      </header>
      {images.length > 0 ? (
        <InfiniteScroll
          hasMore={hasMore && !loadMoreFailed}
          isLoading={false}
          onLoadMore={loadMore}
          loadingLabel="Загрузка изображений"
        >
          <Pinterest images={images} />
        </InfiniteScroll>
      ) : loadFailed ? null : (
        <p className="pinterest-page-empty">Пока нет доступных изображений и видео</p>
      )}
      {loadMoreFailed && (
        <button
          className="pinterest-page-retry"
          type="button"
          onClick={() => setLoadMoreFailed(false)}
        >
          Повторить загрузку
        </button>
      )}
    </section>
  );
}