import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../context/AuthContext";
import adminIcon from "../../assets/icons/admin.svg";
import profileIcon from "../../assets/icons/profile.svg";
import settingsIcon from "../../assets/icons/settings.svg";
import archiveIcon from "../../assets/icons/archive.svg";
import pencilIcon from "../../assets/icons/pencil.svg";
import pinterestIcon from "../../assets/icons/pinterest.svg";
import shareFileIcon from "../../assets/icons/sharefile.svg";
import storageIcon from "../../assets/icons/storage.svg";
import { AvatarMedia } from "../ui/AvatarMedia";
import { AppExternalLink, AppLink } from "../ui/AppLink";
import { getBrowserFileUrl } from "../../utils/fileUrl";

function isAdmin() {
  const token = localStorage.getItem("token");
  if (!token) return false;
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    const roleClaim =
      payload.role ??
      payload["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"];
    return (Array.isArray(roleClaim) ? roleClaim : [roleClaim]).includes(
      "Admin",
    );
  } catch {
    return false;
  }
}

const navigationItems = [
  { label: "Архив", path: "/archive", icon: archiveIcon },
  { label: "Постишки", path: "/posts", icon: pencilIcon },
  { label: "Файлы", path: "/files", icon: storageIcon },
  { label: "Общие файлы", path: "/files/common", icon: shareFileIcon },
  { label: "Пинтерест", path: "/pinterest", icon: pinterestIcon },
];

export function MobileHamburgerMenu({
  onWelcomeOpen,
}: {
  onWelcomeOpen: () => void;
}) {
  const { user, logout } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const toggleLockRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const profileUrl = `/profile/${encodeURIComponent(user?.displayName ?? "")}`;

  useEffect(() => {
    if (!isMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.body.classList.add("mobile-menu-is-open");
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("mobile-menu-is-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    return () => {
      if (toggleLockRef.current !== null) {
        window.clearTimeout(toggleLockRef.current);
      }
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const openMenu = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsMenuVisible(true);
    setIsMenuOpen(true);
  };

  const closeMenu = () => {
    if (!isMenuOpen) return;
    setIsMenuOpen(false);
    closeTimerRef.current = window.setTimeout(() => {
      setIsMenuVisible(false);
      closeTimerRef.current = null;
    }, 320);
  };

  const handleNavigation = closeMenu;

  const menu = isMenuVisible
    ? createPortal(
        <div
          className={`mobile-menu-layer${isMenuOpen ? "" : " is-closing"}`}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMenu();
          }}
        >
          <nav
            id="mobile-navigation-drawer"
            className="mobile-menu-content"
            aria-label="Мобильная навигация"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mobile-menu-header">
              <div className="mobile-menu-user-info">
                {user?.avatarUrl ? (
                  <AvatarMedia
                    className="mobile-menu-avatar"
                    src={getBrowserFileUrl(user.avatarUrl)}
                    alt=""
                  />
                ) : (
                  <span className="mobile-menu-avatar mobile-menu-avatar-fallback">
                    {user?.displayName?.charAt(0).toUpperCase()}
                  </span>
                )}
                <div>
                  <strong style={{ color: user?.nicknameColor ?? "#f5f5f5" }}>
                    {user?.displayName}
                  </strong>
                  <p>{user?.email}</p>
                </div>
              </div>
            </div>

            <div className="mobile-menu-section">
              <AppLink
                to={profileUrl}
                className="mobile-menu-item"
                onClick={handleNavigation}
              >
                <img src={profileIcon} alt="" aria-hidden="true" />
                <span>Профиль</span>
              </AppLink>
              <AppLink
                to="/settings"
                className="mobile-menu-item"
                onClick={handleNavigation}
              >
                <img src={settingsIcon} alt="" aria-hidden="true" />
                <span>Настройки</span>
              </AppLink>
            </div>

            <div className="mobile-menu-section">
              {navigationItems.map((item) => (
                <AppLink
                  key={item.path}
                  to={item.path}
                  className="mobile-menu-item"
                  onClick={handleNavigation}
                >
                  <img src={item.icon} alt="" aria-hidden="true" />
                  <span>{item.label}</span>
                </AppLink>
              ))}
              {isAdmin() && (
                <AppLink
                  to="/admin"
                  className="mobile-menu-item"
                  onClick={handleNavigation}
                >
                  <img src={adminIcon} alt="" aria-hidden="true" />
                  <span>Админка</span>
                </AppLink>
              )}
            </div>

            <footer className="mobile-menu-footer">
              <div className="mobile-menu-footer-row">
                <AppExternalLink href="https://github.com/yawsvitere/pomoyka.inc/blob/main/README.md">
                  правила
                </AppExternalLink>
                <span aria-hidden="true">/</span>
                <AppExternalLink href="https://github.com/yawsvitere/pomoyka.inc/blob/main/README.md">
                  справка
                </AppExternalLink>
              </div>
              <div className="mobile-menu-footer-row">
                <button
                  type="button"
                  onClick={() => {
                    handleNavigation();
                    logout();
                  }}
                >
                  выйти
                </button>
                <span aria-hidden="true">/</span>
                <AppExternalLink href="https://github.com/yawsvitere/pomoyka.inc">
                  github
                </AppExternalLink>
              </div>
              <div className="mobile-menu-footer-row">
                <button type="button" onClick={onWelcomeOpen}>
                  о приложении
                </button>
              </div>
              <AppLink
                className="mobile-menu-footer-logo"
                to="/"
                onClick={handleNavigation}
              >
                помойка.inc
              </AppLink>
            </footer>
          </nav>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="mobile-hamburger-menu">
      <button
        className={`mobile-hamburger-button${isMenuOpen ? " is-open" : ""}`}
        onClick={() => {
          if (toggleLockRef.current !== null) return;
          if (isMenuOpen) {
            closeMenu();
          } else {
            openMenu();
          }
          toggleLockRef.current = window.setTimeout(() => {
            toggleLockRef.current = null;
          }, 360);
        }}
        aria-label={isMenuOpen ? "Закрыть меню" : "Открыть меню"}
        aria-expanded={isMenuOpen}
        aria-controls="mobile-navigation-drawer"
      >
        <span className="hamburger-line"></span>
        <span className="hamburger-line"></span>
        <span className="hamburger-line"></span>
      </button>
      {menu}
    </div>
  );
}
