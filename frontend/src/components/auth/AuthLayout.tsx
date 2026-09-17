import type { ReactNode } from "react";
import "../../styles/pages/auth.css";

interface AuthLayoutProps {
  title: string;
  children: ReactNode;
  bottom?: ReactNode;
}

export function AuthLayout({ title, children, bottom }: AuthLayoutProps) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <aside className="auth-side">
          <div className="auth-logo">
            <img src="/trash.svg" alt="" aria-hidden="true" />
            <span>помойка.inc</span>
          </div>

          <div className="auth-side-bottom">
            <p>тебя поместили в надёжное место.</p>

          </div>
        </aside>

        <section className="auth-content">
          <div className="auth-logo auth-logo-mobile">
            <span>помойка.inc</span>
          </div>

          <div className="auth-form-wrapper">
            <h1>{title}</h1>

            {children}

            {bottom && <div className="auth-bottom">{bottom}</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
