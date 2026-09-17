import { useEffect, useRef, useState, type ReactNode } from "react";
import { Spinner } from "./Spinner";
import "../../styles/core/infinite-scroll.css";

type InfiniteScrollProps = {
  children: ReactNode;
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => Promise<void>;
  loadingLabel?: string;
};

export function InfiniteScroll({
  children,
  hasMore,
  isLoading,
  onLoadMore,
  loadingLabel = "Загрузка новых элементов",
}: InfiniteScrollProps) {
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(hasMore);
  const isLoadingRef = useRef(isLoading);

  hasMoreRef.current = hasMore;
  isLoadingRef.current = isLoading;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const isNearViewport = () => {
      const { top } = sentinel.getBoundingClientRect();
      return top <= window.innerHeight + 240;
    };

    const loadMore = () => {
      if (
        !isNearViewport() ||
        !hasMoreRef.current ||
        isLoadingRef.current ||
        loadingMoreRef.current
      ) {
        return;
      }

      loadingMoreRef.current = true;
      setIsLoadingMore(true);

      void onLoadMore().finally(() => {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);

        requestAnimationFrame(loadMore);
      });
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        loadMore();
      },
      { rootMargin: "240px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadMore]);

  return (
    <>
      {children}
      <div ref={sentinelRef} className="infinite-scroll-loader">
        {isLoadingMore && <Spinner label={loadingLabel} />}
      </div>
    </>
  );
}
