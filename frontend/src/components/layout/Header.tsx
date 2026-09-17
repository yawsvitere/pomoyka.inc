import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { MobileHamburgerMenu } from "./MobileHamburgerMenu";
import { Search } from "./Search";
import { AvatarMedia } from "../ui/AvatarMedia";

export function Header({ onWelcomeOpen }: { onWelcomeOpen: () => void }) {
  const { user } = useAuth();
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:5000";
  const profileUrl = `/profile/${encodeURIComponent(user?.displayName ?? "")}`;

  return (
    <header className="top-header">
      <Link className="top-header-logo top-header-logo-mobile" to="/" aria-label="На главную">
        <img src="/trash.svg" alt="" aria-hidden="true" />
        <span>помойка.inc</span>
      </Link>
      <Search />

      {/* Мобильное меню */}
      <div className="top-header-mobile">
        <MobileHamburgerMenu />
      </div>

      <div className="top-header-desktop top-header-actions">
        <button className="top-header-welcome" type="button" onClick={onWelcomeOpen}>
          О приложении
        </button>
        <Link className="top-header-settings" to="/settings">
          Настройки
        </Link>
        <Link className="top-header-avatar-button" to={profileUrl} aria-label="Открыть профиль">
          {user?.avatarUrl ? (
            <AvatarMedia
              className="top-header-avatar"
              src={`${apiUrl}${user.avatarUrl}`}
              alt=""
            />
          ) : (
            <span className="top-header-avatar top-header-avatar-fallback">
              {user?.displayName?.charAt(0).toUpperCase()}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
