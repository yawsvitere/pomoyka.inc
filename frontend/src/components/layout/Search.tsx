import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as searchApi from "../../api/search";
import searchIcon from "../../assets/icons/search.svg";
import { AvatarMedia } from "../ui/AvatarMedia";
import { getBrowserFileUrl } from "../../utils/fileUrl";
import "../../styles/components/search.css";

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

export function Search() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<searchApi.SearchResponse | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    const value = query.trim();
    if (!value) {
      setResults(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void searchApi
        .search(value)
        .then((data) => {
          setResults(data);
          setIsOpen(true);
        })
        .catch(() => setResults(null));
    }, 280);

    return () => window.clearTimeout(timeoutId);
  }, [query]);

  const hasResults =
    results && Object.values(results).some((items) => items.length > 0);

  return (
    <div className="top-header-search" ref={rootRef} role="search">
      <div className="top-header-search-control">
        <img
          className="top-header-search-icon"
          src={searchIcon}
          alt=""
          aria-hidden="true"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => query.trim() && setIsOpen(true)}
          placeholder="Поиск"
          aria-label="Поиск"
        />
      </div>
      {isOpen && results && (
        <div className="top-header-search-results">
          {!hasResults && (
            <div className="top-header-search-empty">Ничего не найдено</div>
          )}
          {results.users.length > 0 && (
            <SearchGroup title="Пользователи">
              {results.users.map((user) => (
                <Link
                  key={user.id}
                  to={`/profile/${encodeURIComponent(user.displayName)}`}
                  onClick={() => setIsOpen(false)}
                >
                  <span className="top-header-search-user-avatar">
                    {user.avatarUrl ? (
                      <AvatarMedia
                        src={getBrowserFileUrl(user.avatarUrl)}
                        alt=""
                      />
                    ) : (
                      user.displayName.charAt(0).toUpperCase()
                    )}
                  </span>
                  <span className="top-header-search-user-name">
                    {user.displayName}
                  </span>
                </Link>
              ))}
            </SearchGroup>
          )}
          {results.files.length > 0 && (
            <SearchGroup title="Файлы">
              {results.files.map((file) => (
                <Link
                  key={`${file.kind}-${file.id}`}
                  to={
                    file.kind === "user" ? "/files" : `/files/file/${file.id}`
                  }
                  onClick={() => setIsOpen(false)}
                >
                  {file.fileName}
                </Link>
              ))}
            </SearchGroup>
          )}
          {results.dates.length > 0 && (
            <SearchGroup title="Даты">
              {results.dates.map((date) => (
                <Link
                  key={date.date}
                  to={`/archive/${date.date.replaceAll("-", "/")}`}
                  onClick={() => setIsOpen(false)}
                >
                  {formatDate(date.date)}
                </Link>
              ))}
            </SearchGroup>
          )}
          {results.posts.length > 0 && (
            <SearchGroup title="Постишки">
              {results.posts.map((post) => (
                <Link
                  key={post.id}
                  to={`/posts/${post.id}`}
                  onClick={() => setIsOpen(false)}
                >
                  {post.title || post.text?.slice(0, 70) || "Без текста"}
                </Link>
              ))}
            </SearchGroup>
          )}
        </div>
      )}
    </div>
  );
}

function SearchGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="top-header-search-group">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
