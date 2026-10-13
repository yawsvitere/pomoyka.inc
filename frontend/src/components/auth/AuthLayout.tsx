import type { ReactNode } from "react";
import "../../styles/pages/auth.css";

interface AuthLayoutProps {
  title: string;
  children: ReactNode;
}

export function AuthLayout({ title, children }: AuthLayoutProps) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <aside className="auth-side">
          <div className="auth-background" aria-hidden="true">
            <div className="auth-background-slide" />
            <div className="auth-background-slide" />
            <div className="auth-background-slide" />
            <div className="auth-background-slide" />
            <div className="auth-background-slide" />
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
