import { useCallback, useEffect, useRef, useState } from "react";
import * as filesApi from "../api/files";
import { DateRangePicker } from "../components/common/DateRangePicker";
import { InfiniteScroll } from "../components/ui/InfiniteScroll";
import { AvatarMedia } from "../components/ui/AvatarMedia";
import { Pinterest } from "../components/ui/Pinterest";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../components/ui/useToast";
import checkIcon from "../assets/icons/check.svg";
import imageIcon from "../assets/icons/image.svg";
import videoIcon from "../assets/icons/video.svg";
import { getBrowserFileUrl } from "../utils/fileUrl";
import "../styles/pages/pinterest.css";

interface FilterOption {
  value: string;
  label: string;
  nicknameColor?: string | null;
  avatarUrl?: string | null;
  icon?: string;
}

interface PinterestFilterSelectProps {
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  menuAlign?: "start" | "end";
}

function PinterestFilterSelect({
  value,
  options,
  onChange,
  menuAlign = "start",
}: PinterestFilterSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <div className={`pinterest-select${isOpen ? " is-open" : ""}`} ref={rootRef}>
      <button
        className="pinterest-select__trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        {selectedOption?.avatarUrl ? (
          <AvatarMedia
            className="pinterest-select__avatar"
            src={getBrowserFileUrl(selectedOption.avatarUrl)}
            alt=""
          />
        ) : selectedOption?.value && !selectedOption.icon ? (
          <span className="pinterest-select__avatar pinterest-select__avatar--fallback">
            {selectedOption.label.slice(0, 1).toUpperCase()}
          </span>
        ) : null}
        {selectedOption?.icon && (
          <img className="pinterest-select__icon" src={selectedOption.icon} alt="" />
        )}
        <span className="pinterest-select__value">
          <span
            style={
              selectedOption?.value && selectedOption.nicknameColor
                ? { color: selectedOption.nicknameColor }
                : undefined
            }
          >
            {selectedOption?.label}
          </span>
        </span>
        <svg className="pinterest-select__chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {isOpen && (
        <div
          className={`pinterest-select__menu pinterest-select__menu--${menuAlign}`}
          role="menu"
        >
          {options.map((option) => (
            <button
              key={option.value}
              className="pinterest-select__option"
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              {option.avatarUrl ? (
                <AvatarMedia
                  className="pinterest-select__avatar"
                  src={getBrowserFileUrl(option.avatarUrl)}
                  alt=""
                />
              ) : option.value && !option.icon ? (
                <span className="pinterest-select__avatar pinterest-select__avatar--fallback">
                  {option.label.slice(0, 1).toUpperCase()}
                </span>
              ) : null}
              {option.icon && (
                <img className="pinterest-select__icon" src={option.icon} alt="" />
              )}
              <span className="pinterest-select__value">
                <span
                  style={
                    option.value && option.nicknameColor
                      ? { color: option.nicknameColor }
                      : undefined
                  }
                >
                  {option.label}
                </span>
              </span>
              {option.value === value && (
                <img className="pinterest-select__check" src={checkIcon} alt="" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [authors, setAuthors] = useState<filesApi.PinterestAuthor[]>([]);
  const [authorId, setAuthorId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [mediaType, setMediaType] = useState<"" | "image" | "video">("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [shuffleSeed] = useState(
    () => Math.floor(Math.random() * 2_147_483_647),
  );
  const pageRef = useRef(1);
  const loadingMoreRef = useRef(false);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    let active = true;
    requestGenerationRef.current += 1;
    const filters: filesApi.PinterestMediaFilters = {
      ...(authorId ? { authorId } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
      ...(mediaType ? { mediaType } : {}),
    };
    pageRef.current = 1;
    loadingMoreRef.current = false;
    void filesApi.getPinterestMedia(1, 50, shuffleSeed, filters)
      .then((result) => {
        if (active) {
          setMedia(shuffleMedia(result.items));
          setAuthors(result.authors);
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
  }, [authorId, fromDate, mediaType, notify, retryCount, shuffleSeed, toDate]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || loadMoreFailed) return;
    loadingMoreRef.current = true;
    const generation = requestGenerationRef.current;
    try {
      const nextPage = pageRef.current + 1;
      const result = await filesApi.getPinterestMedia(nextPage, 50, shuffleSeed, {
        ...(authorId ? { authorId } : {}),
        ...(fromDate ? { fromDate } : {}),
        ...(toDate ? { toDate } : {}),
        ...(mediaType ? { mediaType } : {}),
      });
      if (generation !== requestGenerationRef.current) return;
      setMedia((current) => [...current, ...shuffleMedia(result.items)]);
      setAuthors(result.authors);
      pageRef.current = nextPage;
      setHasMore(result.hasMore);
    } catch {
      if (generation !== requestGenerationRef.current) return;
      setLoadMoreFailed(true);
      notify("error", "Не удалось загрузить следующие изображения");
    } finally {
      if (generation === requestGenerationRef.current)
        loadingMoreRef.current = false;
    }
  }, [authorId, fromDate, hasMore, loadMoreFailed, mediaType, notify, shuffleSeed, toDate]);

  const deleteMedia = useCallback(async (id: string) => {
    try {
      await filesApi.deleteFile(id);
      setMedia((current) => current.filter((item) => item.id !== id));
      notify("success", "Изображение удалено");
    } catch {
      notify("error", "Не удалось удалить изображение");
    }
  }, [notify]);

  const startFilterRequest = () => {
    setIsLoading(true);
    setLoadFailed(false);
    setLoadMoreFailed(false);
  };

  const images = media.map((item) => ({
    id: item.id,
    fileName: item.fileName,
    url: item.downloadUrl,
    contentType: item.contentType,
    width: item.width,
    height: item.height,
    previewUrl: item.previewUrl,
    ownerId: item.ownerId,
    author: item.author,
  }));

  return (
    <section className="pinterest-page">
      <header className="pinterest-page-header">
        <div className="pinterest-filters" aria-label="Фильтры Pinterest">
          <label className="pinterest-filter">
            <span>Автор</span>
            <PinterestFilterSelect
              value={authorId}
              options={[
                { value: "", label: "Все авторы" },
                ...authors.map((author) => ({
                  value: author.id,
                  label: author.displayName,
                  nicknameColor: author.nicknameColor,
                  avatarUrl: author.avatarUrl,
                })),
              ]}
              onChange={(value) => {
                startFilterRequest();
                setAuthorId(value);
              }}
            />
          </label>
          <div className="pinterest-filter">
            <span>Период</span>
            <DateRangePicker
              value={{ from: fromDate || null, to: toDate || null }}
              placeholder="Любая дата"
              onChange={(range) => {
                startFilterRequest();
                setFromDate(range.from ?? "");
                setToDate(range.to ?? "");
              }}
            />
          </div>
          <label className="pinterest-filter">
            <span>Тип контента</span>
            <PinterestFilterSelect
              value={mediaType}
              menuAlign="end"
              options={[
                { value: "", label: "Все типы" },
                { value: "image", label: "Изображения", icon: imageIcon },
                { value: "video", label: "Видео", icon: videoIcon },
              ]}
              onChange={(value) => {
                if (value === "" || value === "image" || value === "video") {
                  startFilterRequest();
                  setMediaType(value);
                }
              }}
            />
          </label>
        </div>
      </header>
      {isLoading ? (
        <div className="pinterest-page-state">
          <Spinner label="Загрузка Pinterest" />
        </div>
      ) : images.length > 0 ? (
        <InfiniteScroll
          hasMore={hasMore && !loadMoreFailed}
          isLoading={false}
          onLoadMore={loadMore}
          loadingLabel="Загрузка изображений"
        >
          <Pinterest images={images} onDelete={deleteMedia} />
        </InfiniteScroll>
      ) : loadFailed ? (
        <button
          className="pinterest-page-retry"
          type="button"
          onClick={() => {
            startFilterRequest();
            setRetryCount((count) => count + 1);
          }}
        >
          Повторить загрузку
        </button>
      ) : (
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