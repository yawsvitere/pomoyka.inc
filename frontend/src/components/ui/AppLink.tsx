import type { ButtonHTMLAttributes, MouseEvent } from "react";
import {
  useHref,
  useMatch,
  useNavigate,
  useResolvedPath,
  type To,
} from "react-router-dom";

type AppLinkClassName = string | ((options: { isActive: boolean }) => string);

interface AppLinkProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> {
  to: To;
  className?: AppLinkClassName;
  end?: boolean;
}

function openInNewTab(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}

// Buttons avoid the native browser URL preview shown for links with an href.
export function AppLink({
  to,
  className,
  end = false,
  onClick,
  onAuxClick,
  ...props
}: AppLinkProps) {
  const navigate = useNavigate();
  const href = useHref(to);
  const resolvedPath = useResolvedPath(to);
  const isActive = useMatch({ path: resolvedPath.pathname, end }) !== null;
  const resolvedClassName =
    typeof className === "function" ? className({ isActive }) : className;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      openInNewTab(href);
      return;
    }
    navigate(to);
  };

  const handleAuxClick = (event: MouseEvent<HTMLButtonElement>) => {
    onAuxClick?.(event);
    if (event.defaultPrevented || event.button !== 1) return;
    event.preventDefault();
    openInNewTab(href);
  };

  return (
    <button
      {...props}
      type="button"
      role="link"
      aria-current={isActive ? "page" : undefined}
      className={`app-link${resolvedClassName ? ` ${resolvedClassName}` : ""}`}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
    />
  );
}

interface AppExternalLinkProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> {
  href: string;
  className?: string;
}

export function AppExternalLink({
  href,
  className,
  onClick,
  onAuxClick,
  ...props
}: AppExternalLinkProps) {
  const handleOpen = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented) openInNewTab(href);
  };

  const handleAuxClick = (event: MouseEvent<HTMLButtonElement>) => {
    onAuxClick?.(event);
    if (event.defaultPrevented || event.button !== 1) return;
    event.preventDefault();
    openInNewTab(href);
  };

  return (
    <button
      {...props}
      type="button"
      role="link"
      className={`app-link${className ? ` ${className}` : ""}`}
      onClick={handleOpen}
      onAuxClick={handleAuxClick}
    />
  );
}
