import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type TouchEvent,
} from "react";
import { createPortal } from "react-dom";
import twemoji from "@twemoji/api";
import type { Post } from "../../api/types";
import { getBrowserFileUrl } from "../../utils/fileUrl";
import { AlertDialog } from "../ui/AlertDialog";
import "../../styles/components/context-menu.css";
import copyIcon from "../../assets/icons/copy.svg";
import deleteIcon from "../../assets/icons/delete.svg";
import downloadIcon from "../../assets/icons/download.svg";
import messageIcon from "../../assets/icons/message.svg";
import pencilIcon from "../../assets/icons/pencil.svg";

export interface ContextMenuAction {
  key?: string;
  label: string;
  icon?: string;
  onClick?: () => void | Promise<void>;
  href?: string;
  disabled?: boolean;
  danger?: boolean;
}

interface ContextMenuProps {
  post?: Post;
  canDelete?: boolean;
  children: ReactNode;
  onReaction?: (emoji: string) => void;
  onComment?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  customActions?: ContextMenuAction[];
  popoverClassName?: string;
  triggerPlacement?: "center" | "left" | "right";
}

const reactionOptions = ["🍓", "😭", "🤮", "🥺", "🥶", "😎"];

let activeMenuCloser: (() => void) | null = null;

function MenuIcon({ src }: { src: string }) {
  return (
    <span className="context-menu__icon">
      <img
        className="context-menu__icon-image"
        src={src}
        alt=""
        aria-hidden="true"
      />
    </span>
  );
}

export function ReactionIcon({ emoji }: { emoji: string }) {
  const codePoint = twemoji.convert.toCodePoint(emoji);
  return (
    <img
      className="context-menu-reaction-icon"
      src={`https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/${codePoint}.svg`}
      alt={emoji}
      draggable="false"
    />
  );
}

export function ContextMenu({
  post,
  canDelete,
  children,
  onReaction,
  onComment,
  onEdit,
  onDelete,
  customActions,
  popoverClassName,
  triggerPlacement = "center",
}: ContextMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const unlockScrollRef = useRef<(() => void) | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressOpenUntilRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const isTouchDevice = () =>
    window.matchMedia("(pointer: coarse)").matches ||
    navigator.maxTouchPoints > 0;

  const closeMenu = () => {
    suppressOpenUntilRef.current = Date.now() + 100;
    setPosition(null);
    if (activeMenuCloser === closeMenu) activeMenuCloser = null;
  };

  useEffect(() => {
    if (!position) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyPaddingRight = document.body.style.paddingRight;
    const previousHtmlPaddingRight =
      document.documentElement.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
      document.documentElement.style.paddingRight = `${scrollbarWidth}px`;
    }

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const preventScroll = (event: Event) => event.preventDefault();
    const preventKeyboardScroll = (event: KeyboardEvent) => {
      if (
        [
          "ArrowDown",
          "ArrowUp",
          "PageDown",
          "PageUp",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      ) {
        event.preventDefault();
      }
    };

    const unlockScroll = () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.paddingRight = previousBodyPaddingRight;
      document.documentElement.style.paddingRight = previousHtmlPaddingRight;
      document.removeEventListener("wheel", preventScroll);
      document.removeEventListener("touchmove", preventScroll);
      document.removeEventListener("keydown", preventKeyboardScroll);
      if (activeMenuCloser === closeMenu) activeMenuCloser = null;
    };
    unlockScrollRef.current = unlockScroll;

    activeMenuCloser?.();
    activeMenuCloser = closeMenu;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    const handleDocumentContextMenu = () => {
      closeMenu();
    };
    const blockBackgroundInteraction = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target)) return;

      event.preventDefault();
      event.stopPropagation();
    };

    let subscribed = false;
    const subscribeId = window.requestAnimationFrame(() => {
      subscribed = true;
      document.addEventListener("contextmenu", handleDocumentContextMenu, true);
    });

    document.addEventListener("wheel", preventScroll, { passive: false });
    document.addEventListener("touchmove", preventScroll, { passive: false });
    document.addEventListener("touchstart", blockBackgroundInteraction, {
      passive: false,
      capture: true,
    });
    document.addEventListener("pointerdown", blockBackgroundInteraction, {
      passive: false,
      capture: true,
    });
    document.addEventListener("mousedown", blockBackgroundInteraction, {
      passive: false,
      capture: true,
    });
    document.addEventListener("keydown", preventKeyboardScroll);
    document.addEventListener("keydown", handleEscape);

    return () => {
      window.cancelAnimationFrame(subscribeId);
      unlockScroll();
      if (unlockScrollRef.current === unlockScroll) {
        unlockScrollRef.current = null;
      }
      if (subscribed) {
        document.removeEventListener(
          "contextmenu",
          handleDocumentContextMenu,
          true,
        );
      }
      document.removeEventListener("touchstart", blockBackgroundInteraction, {
        capture: true,
      });
      document.removeEventListener("pointerdown", blockBackgroundInteraction, {
        capture: true,
      });
      document.removeEventListener("mousedown", blockBackgroundInteraction, {
        capture: true,
      });
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("keydown", preventKeyboardScroll);
    };
  }, [position]);

  useEffect(() => {
    if (position === null) unlockScrollRef.current?.();
  }, [position]);

  function handleHostClick(event: MouseEvent<HTMLDivElement>) {
    const trigger = (event.target as HTMLElement | null)?.closest(
      "[data-context-menu-trigger='true']",
    );
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();
    setPosition({
      x:
        triggerPlacement === "right"
          ? rect.right
          : triggerPlacement === "left"
            ? rect.left
            : rect.left + rect.width / 2,
      y: triggerPlacement === "center" ? rect.top + rect.height / 2 : rect.top,
    });
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (isTouchDevice()) {
      event.preventDefault();
      return;
    }

    if (Date.now() < suppressOpenUntilRef.current) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setPosition({ x: event.clientX, y: event.clientY });
  }

  function cancelLongPress() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (Date.now() < suppressOpenUntilRef.current) {
      event.preventDefault();
      cancelLongPress();
      return;
    }

    const touch = event.touches[0];
    if (!touch) return;

    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    cancelLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      event.preventDefault();
      setPosition({ x: touch.clientX, y: touch.clientY });
      cancelLongPress();
    }, 450);
  }

  function handleTouchMove(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    if (!touch || !touchStartRef.current) {
      cancelLongPress();
      return;
    }

    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      cancelLongPress();
      touchStartRef.current = null;
    }
  }

  function handleTouchEnd() {
    touchStartRef.current = null;
    cancelLongPress();
  }

  function handleTouchCancel() {
    touchStartRef.current = null;
    cancelLongPress();
  }

  async function run(action: () => any) {
    await action();
    closeMenu();
  }

  function closeDeleteDialog() {
    setDeleteDialogOpen(false);
  }

  function downloadFile(file: Post["files"][number]) {
    const link = document.createElement("a");
    link.href = getBrowserFileUrl(file.downloadUrl);
    link.download = file.fileName;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.click();
  }

  async function copyImage(file: Post["files"][number]) {
    try {
      const response = await fetch(getBrowserFileUrl(file.downloadUrl));
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type || file.contentType]: blob }),
      ]);
    } catch (error) {
      console.error("Не удалось скопировать изображение:", error);
    }
  }

  const imageFiles = post
    ? post.files.filter((file) => file.contentType.startsWith("image/"))
    : [];

  return (
    <div
      className="context-menu-host"
      onClick={handleHostClick}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {children}
      {position &&
        createPortal(
          <>
            <div
              className="context-menu-backdrop"
              style={{ pointerEvents: "auto" }}
              onPointerDownCapture={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onPointerUpCapture={(event) => {
                event.preventDefault();
                event.stopPropagation();
                closeMenu();
              }}
              onTouchStartCapture={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onTouchEndCapture={(event) => {
                event.preventDefault();
                event.stopPropagation();
                closeMenu();
              }}
              onClickCapture={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onContextMenuCapture={(event) => {
                event.preventDefault();
                event.stopPropagation();
                closeMenu();
              }}
            />
            <div
              className={`context-menu-popover${triggerPlacement === "left" ? " context-menu-popover--left" : ""}${popoverClassName ? ` ${popoverClassName}` : ""}`}
              ref={popoverRef}
              style={{
                left: position.x,
                top: position.y,
                pointerEvents: "auto",
              }}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {customActions ? (
                <div className="context-menu">
                  <div className="context-menu__section">
                    {customActions.map((action) => (
                      <button
                        key={action.key ?? action.label}
                        type="button"
                        className={`context-menu__item${
                          action.danger ? " context-menu__item--danger" : ""
                        }`}
                        disabled={action.disabled}
                        onClick={() =>
                          run(async () => {
                            if (action.href) {
                              const link = document.createElement("a");
                              link.href = action.href;
                              link.target = "_blank";
                              link.rel = "noreferrer";
                              link.click();
                              return;
                            }
                            if (action.onClick) {
                              await action.onClick();
                            }
                          })
                        }
                      >
                        {action.icon && <MenuIcon src={action.icon} />}
                        <span className="context-menu__label">
                          {action.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {onReaction && (
                    <div className="context-menu-reactions">
                      {reactionOptions.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => run(() => onReaction(emoji))}
                          title={emoji}
                        >
                          <ReactionIcon emoji={emoji} />
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="context-menu">
                    <div className="context-menu__section">
                      {onComment && (
                        <button
                          type="button"
                          className="context-menu__item"
                          onClick={() => run(onComment)}
                        >
                          <MenuIcon src={messageIcon} />
                          <span className="context-menu__label">
                            Комментарий
                          </span>
                        </button>
                      )}

                      <button
                        type="button"
                        className="context-menu__item"
                        disabled={!onEdit}
                        onClick={() => onEdit && run(onEdit)}
                      >
                        <MenuIcon src={pencilIcon} />
                        <span className="context-menu__label">
                          Редактировать
                        </span>
                      </button>
                    </div>

                    {post && post.files.length > 0 && (
                      <div className="context-menu__section">
                        {post.files.map((file) => (
                          <button
                            key={file.id}
                            type="button"
                            className="context-menu__item"
                            onClick={() => run(() => downloadFile(file))}
                          >
                            <MenuIcon src={downloadIcon} />
                            <span className="context-menu__label">
                              Скачать {file.fileName}
                            </span>
                          </button>
                        ))}

                        {imageFiles.map((file) => (
                          <button
                            key={`copy-${file.id}`}
                            type="button"
                            className="context-menu__item"
                            onClick={() => run(() => void copyImage(file))}
                          >
                            <MenuIcon src={copyIcon} />
                            <span className="context-menu__label">
                              Копировать изображение
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {canDelete && onDelete && (
                      <div className="context-menu__section">
                        <button
                          type="button"
                          className="context-menu__item context-menu__item--danger"
                          onClick={() => run(() => setDeleteDialogOpen(true))}
                        >
                          <MenuIcon src={deleteIcon} />
                          <span className="context-menu__label">Удалить</span>
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </>,
          document.body,
        )}
      {!customActions && (
        <AlertDialog
          open={deleteDialogOpen}
          title="Удалить пост?"
          description="Вы уверены, что хотите удалить этот пост? Это действие нельзя отменить."
          onCancel={closeDeleteDialog}
          onConfirm={() => {
            closeDeleteDialog();
            onDelete?.();
          }}
        />
      )}
    </div>
  );
}
