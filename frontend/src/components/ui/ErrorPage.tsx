import { useRef } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Audio, AudioPlayer, AudioSkin } from "@videojs/react/audio";
import "@videojs/react/audio/skin.css";
import "../../styles/components/error-page.css";

type ErrorPageProps = {
  status: 403 | 404 | 500;
  title?: string;
  description?: ReactNode;
  showStatus?: boolean;
  showHomeLink?: boolean;
  onLogout?: () => void;
};

const defaultContent = {
  403: { title: "Доступ ограничен" },
  404: { title: "Страница не найдена" },
  500: { title: "Доступ ограничен" },
} as const;

export function ErrorPage({
  status,
  title,
  description,
  showStatus = true,
  showHomeLink = true,
  onLogout,
}: ErrorPageProps) {
  const content = defaultContent[status];
  const is403 = status === 403;
  const image = is403 ? "/eror2.webp" : "/eror.webp";
  const statusRef = useRef<HTMLSpanElement>(null);

  const handleMove = (e: PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.style.setProperty("--mx", (e.clientX / window.innerWidth).toFixed(3));
    el.style.setProperty("--my", (e.clientY / window.innerHeight).toFixed(3));

    const rect = statusRef.current?.getBoundingClientRect();
    if (rect) {
      el.style.setProperty("--sx", `${e.clientX - rect.left}px`);
      el.style.setProperty("--sy", `${e.clientY - rect.top}px`);
    }
  };

  return (
    <main
      className={`error-page${is403 ? " is-locked" : ""}`}
      onPointerMove={handleMove}
      style={{ "--ep-img": `url("${image}")` } as CSSProperties}
    >
      <img className="error-page-aura" src={image} alt="" aria-hidden="true" />

      <div className="error-page-content">
        {showStatus ? (
          <span
            className="error-page-status"
            aria-hidden="true"
            ref={statusRef}
          >
            <span className="ep-digits">{status}</span>
            {is403 && <span className="ep-digits ep-reveal">{status}</span>}
          </span>
        ) : (
          <img className="error-page-image" src={image} alt="" />
        )}

        <h1>
          {showStatus && <span className="visually-hidden">{status}. </span>}
          {title ?? content.title}
        </h1>
        {description && <p>{description}</p>}

        <div className="error-page-audio">
          <AudioPlayer>
            <AudioSkin>
              <Audio
                src={is403 ? "/Sandy.mp3" : "/Agua De Beber Eror-Page.mp3"}
                playsInline
                preload="none"
              />
            </AudioSkin>
          </AudioPlayer>
        </div>

        {(showHomeLink || onLogout) && (
          <div className="error-page-actions">
            {showHomeLink && <Link to="/">На главную</Link>}
            {onLogout && (
              <button type="button" onClick={onLogout}>
                Выйти
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
