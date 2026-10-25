import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import * as postsApi from "../../api/posts";
import * as searchApi from "../../api/search";
import type { PostAttachment, PostAttachmentType } from "../../api/types";
import { getBrowserFileUrl } from "../../utils/fileUrl";
import { AvatarMedia } from "../ui/AvatarMedia";
import { AppLink } from "../ui/AppLink";
import "../../styles/components/attachment-picker.css";

type AttachmentFilter = "all" | PostAttachmentType;

interface AttachmentPickerProps {
  selected: PostAttachment[];
  disabled?: boolean;
  onChange: (attachments: PostAttachment[]) => void;
}

type SearchResult =
  | { type: "post"; item: searchApi.SearchPost }
  | { type: "user"; item: searchApi.SearchUser }
  | { type: "date"; item: searchApi.SearchDate }
  | { type: "file"; item: searchApi.SearchFile };

const MAX_ATTACHMENTS = 12;

const FILTERS = [
  ["all", "Всё"],
  ["post", "Постишки"],
  ["file", "Файлы"],
  ["user", "Люди"],
  ["date", "Дни"],
] as const;

function getResultKey(result: SearchResult) {
  switch (result.type) {
    case "post":
    case "user":
      return `${result.type}::${result.item.id}`;
    case "date":
      return `date::${result.item.date}`;
    case "file":
      return `file:${result.item.kind}:${result.item.id}`;
  }
}

function toAttachment(result: SearchResult): PostAttachment {
  switch (result.type) {
    case "post": {
      const post = result.item;
      return {
        id: post.id,
        type: "post",
        title: post.title || post.text?.split("\n")[0] || "Постишка",
        subtitle: "Постишка",
        href: `/posts/${encodeURIComponent(post.slug || post.id)}`,
        imageUrl: null,
      };
    }
    case "user": {
      const user = result.item;
      return {
        id: user.id,
        type: "user",
        title: user.displayName,
        subtitle: "Пользователь",
        href: `/profile/${encodeURIComponent(user.displayName)}`,
        imageUrl: user.avatarUrl,
      };
    }
    case "date": {
      const date = result.item;
      const [year, month, day] = date.date.split("-");
      return {
        id: date.date,
        type: "date",
        title: `${day}.${month}.${year}`,
        subtitle: `${date.postCount} постов в архиве`,
        href: `/archive/${date.date.replaceAll("-", "/")}`,
        imageUrl: null,
      };
    }
    case "file":
      return {
        id: result.item.id,
        type: "file",
        title: result.item.fileName,
        subtitle: "Файл из Помойки",
        href: `/files/file/${result.item.id}`,
        imageUrl: result.item.previewUrl,
        fileKind: result.item.kind,
      };
  }
}

function getTypeLabel(type: PostAttachmentType) {
  switch (type) {
    case "post":
      return "Постишка";
    case "user":
      return "Пользователь";
    case "date":
      return "День";
    case "file":
      return "Файл";
  }
}

function getResultMeta(result: SearchResult) {
  switch (result.type) {
    case "post":
      return "Постишка";
    case "user":
      return "Пользователь";
    case "date":
      return `${result.item.postCount} постов в архиве`;
    case "file":
      return `Файл · ${result.item.kind === "user" ? "библиотека" : "пост"}`;
  }
}

function getResults(results: searchApi.SearchResponse): SearchResult[] {
  return [
    ...results.posts.map((item) => ({ type: "post" as const, item })),
    ...results.users.map((item) => ({ type: "user" as const, item })),
    ...results.files.map((item) => ({ type: "file" as const, item })),
    ...results.dates.map((item) => ({ type: "date" as const, item })),
  ];
}

function attachmentKey(item: PostAttachment) {
  return `${item.type}:${item.fileKind ?? ""}:${item.id}`;
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function TypeIcon({ type }: { type: PostAttachmentType }) {
  switch (type) {
    case "post":
      return (
        <Svg>
          <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5z" />
          <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" />
        </Svg>
      );
    case "user":
      return (
        <Svg>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5" />
        </Svg>
      );
    case "date":
      return (
        <Svg>
          <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
          <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
        </Svg>
      );
    case "file":
      return (
        <Svg>
          <path d="M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5z" />
          <path d="M14 3.5V7.5h4" />
        </Svg>
      );
  }
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5.5 12.5 4.2 4.2L18.5 8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <Svg>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

function AttachmentPreview({ item }: { item: PostAttachment }) {
  const [postPreview, setPostPreview] = useState<{
    id: string;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (item.type !== "post") return;

    let active = true;
    let objectUrl: string | null = null;
    void postsApi
      .getPostishkaOgImage(item.id)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setPostPreview({ id: item.id, url: objectUrl });
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        if (active) setPostPreview(null);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id, item.type]);

  return (
    <span
      className="attachment-picker-preview"
      data-type={item.type}
      aria-hidden="true"
    >
      {item.type === "post" && postPreview?.id === item.id ? (
        <img src={postPreview.url} alt="" />
      ) : item.imageUrl ? (
        <AvatarMedia src={getBrowserFileUrl(item.imageUrl)} alt="" />
      ) : (
        <TypeIcon type={item.type} />
      )}
    </span>
  );
}

export function AttachmentPicker({
  selected,
  disabled = false,
  onChange,
}: AttachmentPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResponse, setSearchResponse] = useState<{
    query: string;
    results?: searchApi.SearchResponse;
    failed?: boolean;
  } | null>(null);
  const [filter, setFilter] = useState<AttachmentFilter>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim();
  const hasCurrentResponse = searchResponse?.query === normalizedQuery;
  const results = hasCurrentResponse ? (searchResponse.results ?? null) : null;
  const isLoading = isOpen && Boolean(normalizedQuery) && !hasCurrentResponse;
  const hasError = Boolean(hasCurrentResponse && searchResponse.failed);

  useEffect(() => {
    if (!isOpen || !normalizedQuery) return;

    let active = true;
    const timeoutId = window.setTimeout(() => {
      void searchApi
        .search(normalizedQuery)
        .then((data) => {
          if (active)
            setSearchResponse({ query: normalizedQuery, results: data });
        })
        .catch(() => {
          if (active)
            setSearchResponse({ query: normalizedQuery, failed: true });
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [isOpen, normalizedQuery]);

  useEffect(() => {
    if (!isOpen) return;

    const triggerElement = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    searchInputRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      triggerElement?.focus();
    };
  }, [isOpen]);

  function toggleAttachment(result: SearchResult) {
    const key = getResultKey(result);
    const existing = selected.find(
      (attachment) => attachmentKey(attachment) === key,
    );
    if (existing) {
      onChange(selected.filter((attachment) => attachment !== existing));
      return;
    }
    if (selected.length >= MAX_ATTACHMENTS) return;
    onChange([...selected, toAttachment(result)]);
  }

  const allResults = results ? getResults(results) : [];
  const visibleResults =
    filter === "all"
      ? allResults
      : allResults.filter((result) => result.type === filter);
  const counts: Record<AttachmentFilter, number> = {
    all: allResults.length,
    post: allResults.filter((r) => r.type === "post").length,
    file: allResults.filter((r) => r.type === "file").length,
    user: allResults.filter((r) => r.type === "user").length,
    date: allResults.filter((r) => r.type === "date").length,
  };
  const focusedIndex = Math.min(
    activeIndex,
    Math.max(visibleResults.length - 1, 0),
  );

  useEffect(() => {
    resultsRef.current
      ?.querySelector<HTMLElement>('[data-focused="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex, visibleResults.length]);

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (visibleResults.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(Math.min(focusedIndex + 1, visibleResults.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(focusedIndex - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      toggleAttachment(visibleResults[focusedIndex]);
    }
  }

  const progress = Math.min(selected.length / MAX_ATTACHMENTS, 1) * 100;

  return (
    <>
      <div className="attachment-picker">
        <button
          ref={triggerRef}
          className="attachment-picker-trigger"
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-label={`Вложения${selected.length > 0 ? `, выбрано ${selected.length}` : ""}`}
          onClick={() => setIsOpen(true)}
        >
          <Svg>
            <path d="m20 11.5-7.6 7.6a4.6 4.6 0 0 1-6.5-6.5l8-8a3 3 0 0 1 4.3 4.3l-8 8a1.5 1.5 0 0 1-2.2-2.2l7.3-7.3" />
          </Svg>
          <span>Вложения</span>
          {selected.length > 0 && (
            <span className="attachment-picker-count">{selected.length}</span>
          )}
        </button>
      </div>

      {isOpen &&
        createPortal(
          <div
            className="attachment-picker-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setIsOpen(false);
            }}
          >
            <section
              className="attachment-picker-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Выбор вложений"
            >
              <header className="attachment-picker-header">
                <button
                  className="attachment-picker-close"
                  type="button"
                  aria-label="Закрыть окно вложений"
                  onClick={() => setIsOpen(false)}
                >
                  <CloseIcon />
                </button>
              </header>

              <div className="attachment-picker-search">
                <Svg>
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m16 16 4 4" />
                </Svg>
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(event) => {
                    if (event.target.value.trim() !== normalizedQuery) {
                      setSearchResponse(null);
                      setActiveIndex(0);
                    }
                    setQuery(event.target.value);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Постишка, человек, файл или дата…"
                  aria-label="Найти вложение"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Очистить поиск"
                    onClick={() => {
                      setSearchResponse(null);
                      setQuery("");
                      setActiveIndex(0);
                      searchInputRef.current?.focus();
                    }}
                  >
                    Очистить
                  </button>
                )}
              </div>

              <nav
                className="attachment-picker-filters"
                aria-label="Тип вложения"
              >
                {FILTERS.map(([value, label]) => (
                  <button
                    type="button"
                    className={filter === value ? "is-active" : ""}
                    aria-pressed={filter === value}
                    key={value}
                    onClick={() => {
                      setFilter(value);
                      setActiveIndex(0);
                    }}
                  >
                    {label}
                    {results && (
                      <span className="attachment-picker-filter-count">
                        {counts[value]}
                      </span>
                    )}
                  </button>
                ))}
              </nav>

              <div
                className="attachment-picker-results"
                ref={resultsRef}
                aria-live="polite"
              >
                {!normalizedQuery && (
                  <div className="attachment-picker-state">
                    <span className="attachment-picker-state-icon">
                      <Svg>
                        <circle cx="11" cy="11" r="6.5" />
                        <path d="m16 16 4 4" />
                      </Svg>
                    </span>
                    <strong>Начни вводить запрос</strong>
                    <span className="attachment-picker-state-text">
                      Можно прикрепить что угодно из Помойки:
                    </span>
                    <ul className="attachment-picker-hints">
                      {(["post", "file", "user", "date"] as const).map(
                        (type) => (
                          <li key={type} data-type={type}>
                            <span className="attachment-picker-hint-icon">
                              <TypeIcon type={type} />
                            </span>
                            {type === "post" && "Постишки"}
                            {type === "file" && "Файлы"}
                            {type === "user" && "Людей"}
                            {type === "date" && "Дни из архива"}
                          </li>
                        ),
                      )}
                    </ul>
                    <span className="attachment-picker-state-text">
                      Дату ищи в формате <code>25.10.2026</code>
                    </span>
                  </div>
                )}

                {normalizedQuery && isLoading && (
                  <div
                    className="attachment-picker-skeletons"
                    aria-label="Загрузка"
                  >
                    {[0, 1, 2, 3].map((i) => (
                      <div className="attachment-picker-skeleton" key={i}>
                        <span />
                        <div>
                          <span />
                          <span />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {normalizedQuery && hasError && (
                  <div className="attachment-picker-state attachment-picker-error">
                    <span className="attachment-picker-state-icon">
                      <Svg>
                        <circle cx="12" cy="12" r="8.5" />
                        <path d="M12 8v4.5M12 16h.01" />
                      </Svg>
                    </span>
                    <strong>Поиск не сработал</strong>
                    <span className="attachment-picker-state-text">
                      Не удалось выполнить запрос. Попробуй ещё раз.
                    </span>
                  </div>
                )}

                {normalizedQuery &&
                  !isLoading &&
                  !hasError &&
                  visibleResults.length === 0 && (
                    <div className="attachment-picker-state">
                      <span className="attachment-picker-state-icon">
                        <Svg>
                          <circle cx="11" cy="11" r="6.5" />
                          <path d="m16 16 4 4M9 11h4" />
                        </Svg>
                      </span>
                      <strong>Ничего не нашлось</strong>
                      <span className="attachment-picker-state-text">
                        По запросу «{normalizedQuery}» пусто. Попробуй другой
                        запрос или фильтр.
                      </span>
                    </div>
                  )}

                {visibleResults.map((result, index) => {
                  const attachment = toAttachment(result);
                  const key = getResultKey(result);
                  const isSelected = selected.some(
                    (item) => attachmentKey(item) === key,
                  );
                  const isAtLimit =
                    selected.length >= MAX_ATTACHMENTS && !isSelected;
                  const isFocused = index === focusedIndex;
                  return (
                    <button
                      className={`attachment-picker-result${isSelected ? " is-selected" : ""}${isFocused ? " is-focused" : ""}`}
                      data-focused={isFocused}
                      type="button"
                      key={key}
                      aria-pressed={isSelected}
                      disabled={isAtLimit}
                      tabIndex={-1}
                      onClick={() => {
                        toggleAttachment(result);
                        setActiveIndex(index);
                        searchInputRef.current?.focus();
                      }}
                    >
                      <AttachmentPreview item={attachment} />
                      <span className="attachment-picker-result-copy">
                        <strong>{attachment.title}</strong>
                        <small>
                          <span
                            className="attachment-picker-tag"
                            data-type={result.type}
                          >
                            {getTypeLabel(result.type)}
                          </span>
                          {result.type !== "post" && result.type !== "user" && (
                            <span>
                              {getResultMeta(result).replace(/^Файл · /, "")}
                            </span>
                          )}
                        </small>
                      </span>
                      <span
                        className="attachment-picker-result-action"
                        aria-label={isSelected ? "Добавлено" : "Добавить"}
                      >
                        <CheckIcon />
                      </span>
                    </button>
                  );
                })}
              </div>

              <footer className="attachment-picker-footer">
                <div className="attachment-picker-meter">
                  <span>
                    <b>{selected.length}</b> из {MAX_ATTACHMENTS}
                  </span>
                  <i aria-hidden="true">
                    <em style={{ width: `${progress}%` }} />
                  </i>
                </div>
                <span
                  className="attachment-picker-shortcuts"
                  aria-hidden="true"
                >
                  <kbd>↑</kbd>
                  <kbd>↓</kbd> выбор <kbd>Enter</kbd> добавить
                </span>
                <button type="button" onClick={() => setIsOpen(false)}>
                  Готово
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}

export function PostAttachments({
  attachments,
}: {
  attachments: PostAttachment[];
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="post-attachments" aria-label="Вложения поста">
      {attachments.map((item) => (
        <AppLink
          className="post-attachment-card"
          to={item.href}
          key={attachmentKey(item)}
        >
          <AttachmentPreview item={item} />
          <span className="post-attachment-copy">
            <strong>{item.title}</strong>
            <small>{item.subtitle || getTypeLabel(item.type)}</small>
          </span>
          <span className="post-attachment-arrow" aria-hidden="true">
            <Svg>
              <path d="M8 16 16 8M9.5 8H16v6.5" />
            </Svg>
          </span>
        </AppLink>
      ))}
    </div>
  );
}

export function AttachmentSelection({
  selected,
  disabled,
  onRemove,
}: {
  selected: PostAttachment[];
  disabled: boolean;
  onRemove: (attachment: PostAttachment) => void;
}) {
  if (selected.length === 0) return null;

  return (
    <ul className="attachment-picker-selected" aria-label="Выбранные вложения">
      {selected.map((item) => (
        <li className="attachment-picker-chip" key={attachmentKey(item)}>
          <AttachmentPreview item={item} />
          <span className="attachment-picker-chip-title">{item.title}</span>
          <button
            type="button"
            aria-label={`Убрать вложение: ${item.title}`}
            disabled={disabled}
            onClick={() => onRemove(item)}
          >
            <CloseIcon />
          </button>
        </li>
      ))}
    </ul>
  );
}
