import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import "../../styles/pages/auth.css";

const AUTH_BACKGROUND_IMAGES = [
  "/authimage.webp",
  "/authimage2.webp",
  "/authimage3.webp",
  "/authimage4.webp",
  "/authimage5.webp",
];

interface AuthLayoutProps {
  title: string;
  children: ReactNode;
}

export function AuthLayout({ title, children }: AuthLayoutProps) {
  const [showBackground, setShowBackground] = useState(
    () => window.matchMedia("(min-width: 701px)").matches,
  );
  const [loadedBackgroundImages, setLoadedBackgroundImages] = useState(
    () => new Set(showBackground ? [0] : []),
  );

  useEffect(() => {
    const media = window.matchMedia("(min-width: 701px)");
    const updateBackgroundVisibility = () => setShowBackground(media.matches);
    media.addEventListener("change", updateBackgroundVisibility);

    return () => media.removeEventListener("change", updateBackgroundVisibility);
  }, []);

  useEffect(() => {
    if (!showBackground) return;

    const timers = AUTH_BACKGROUND_IMAGES.slice(1).map((_, index) =>
      window.setTimeout(
        () => {
          setLoadedBackgroundImages((loaded) => new Set(loaded).add(index + 1));
        },
        (index + 1) * 7_000 - 3_500,
      ),
    );

    return () => timers.forEach(window.clearTimeout);
  }, [showBackground]);

  return (
    <main className="auth-page">
      <div className="auth-card">
        <aside className="auth-side">
          <div className="auth-background" aria-hidden="true">
            {AUTH_BACKGROUND_IMAGES.map((image, index) => (
              <div className="auth-background-slide" key={image}>
                {showBackground &&
                  (index === 0 || loadedBackgroundImages.has(index)) && (
                  <img
                    src={image}
                    alt=""
                    decoding="async"
                    fetchPriority={index === 0 ? "high" : "auto"}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="auth-logo">
            <img src="/trash.svg" alt="" aria-hidden="true" />
            <span>
              помойка.inc<sup>®</sup>
            </span>
          </div>

          <div className="auth-side-bottom">
            <p>тебя поместили в надёжное место.</p>
          </div>
        </aside>

        <section className="auth-content">
          <div className="auth-logo auth-logo-mobile">
            <span>
              помойка.inc<sup>®</sup>
            </span>
          </div>

          <div className="auth-form-wrapper">
            <h1>{title}</h1>

            {children}
          </div>

          <footer className="auth-footer">
            <nav className="auth-footer-links" aria-label="Полезные ссылки">
              <a
                href="https://github.com/yawsvitere/pomoyka.inc/blob/main/README.md"
                target="_blank"
                rel="noreferrer"
              >
                справка
              </a>
              <a
                href="https://github.com/yawsvitere/pomoyka.inc"
                target="_blank"
                rel="noreferrer"
              >
                github
              </a>
            </nav>
            <p>
              Если вы попали сюда случайно, вряд ли сможете войти. Но можете{" "}
              <a
                href="https://github.com/yawsvitere/pomoyka.inc"
                target="_blank"
                rel="noreferrer"
              >
                развернуть помойку.inc у себя
              </a>
              .
            </p>
          </footer>
        </section>
      </div>
    </main>
  );
}
