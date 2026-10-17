import archiveIcon from "../../assets/icons/archive.svg";
import homeIcon from "../../assets/icons/home.svg";
import pencilIcon from "../../assets/icons/pencil.svg";
import storageIcon from "../../assets/icons/storage.svg";
import { useAuth } from "../../context/AuthContext";
import { AppExternalLink, AppLink } from "../ui/AppLink";

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
  { label: "Главная", path: "/", icon: homeIcon },
  { label: "Архив", path: "/archive", icon: archiveIcon },
  { label: "Постишки", path: "/posts", icon: pencilIcon },
  { label: "Файлы", path: "/files", icon: storageIcon },
  { label: "Общие файлы", path: "/files/common", icon: storageIcon },
  { label: "Пинтерест", path: "/pinterest", icon: storageIcon },
];

export function NavigationSidebar({
  onWelcomeOpen,
}: {
  onWelcomeOpen: () => void;
}) {
  const { logout } = useAuth();

  return (
    <aside
      className="navigation-sidebar navigation-sidebar-desktop"
      aria-label="Основная навигация"
    >
      <nav className="navigation-sidebar-list">
        {navigationItems.map((item) => (
          <AppLink
            key={item.path}
            className={({ isActive }) =>
              `navigation-sidebar-link${isActive ? " active" : ""}`
            }
            to={item.path}
            end={item.path === "/"}
          >
            <img
              className="navigation-sidebar-icon"
              src={item.icon}
              alt=""
              aria-hidden="true"
            />
            <span>{item.label}</span>
          </AppLink>
        ))}
        {isAdmin() && (
          <AppLink
            className={({ isActive }) =>
              `navigation-sidebar-link${isActive ? " active" : ""}`
            }
            to="/admin"
          >
            <span>Админка</span>
          </AppLink>
        )}
      </nav>
      <div className="navigation-sidebar-footer">
        <div className="navigation-sidebar-footer-row">
          <AppExternalLink href="https://github.com/yawsvitere/pomoyka.inc/blob/main/README.md">
            правила
          </AppExternalLink>
          <span aria-hidden="true">/</span>
          <AppExternalLink href="https://github.com/yawsvitere/pomoyka.inc/blob/main/README.md">
            справка
          </AppExternalLink>
        </div>
        <div className="navigation-sidebar-footer-row">
          <button type="button" onClick={logout}>
            выйти
          </button>
          <span aria-hidden="true">/</span>
          <AppExternalLink href="https://github.com/yawsvitere/pomoyka.inc">
            github
          </AppExternalLink>
        </div>
        <div className="navigation-sidebar-footer-row">
          <button type="button" onClick={onWelcomeOpen}>
            о приложении
          </button>
        </div>
        <AppLink
          className="navigation-sidebar-logo"
          to="/"
          aria-label="На главную"
        >
          <span>помойка.inc</span>
        </AppLink>
      </div>
    </aside>
  );
}
