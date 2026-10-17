import { createPortal } from "react-dom";
import homeIcon from "../../assets/icons/home.svg";
import pencilIcon from "../../assets/icons/pencil.svg";
import storageIcon from "../../assets/icons/storage.svg";
import { AppLink } from "../ui/AppLink";

const navigationItems = [
  { label: "Главная", path: "/", icon: homeIcon },
  { label: "Постишки", path: "/posts", icon: pencilIcon },
  { label: "Файлы", path: "/files", icon: storageIcon },
];

export function MobileBottomNavigation() {
  return createPortal(
    <nav className="mobile-bottom-navigation" aria-label="Основная навигация">
      {navigationItems.map((item) => (
        <AppLink
          key={item.path}
          className={({ isActive }) =>
            `mobile-bottom-navigation-link${isActive ? " active" : ""}`
          }
          to={item.path}
          end={item.path === "/"}
          aria-label={item.label}
          title={item.label}
        >
          <img src={item.icon} alt="" aria-hidden="true" />
        </AppLink>
      ))}
    </nav>,
    document.body,
  );
}
