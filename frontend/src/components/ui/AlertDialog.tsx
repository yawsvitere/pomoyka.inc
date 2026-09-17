import { useEffect, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import "../../styles/core/alert-dialog.css";

interface AlertDialogProps {
  open: boolean;
  title: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function AlertDialog({
  open,
  title,
  description,
  onCancel,
  onConfirm,
  confirmLabel = "Удалить",
  cancelLabel = "Отмена",
}: AlertDialogProps) {
  useEffect(() => {
    if (!open) return;

    const root = document.documentElement;
    const previousRootOverflow = root.style.overflow;
    const previousRootScrollbarGutter = root.style.scrollbarGutter;
    const previousBodyOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;

    root.classList.add("alert-dialog-open");
    document.body.classList.add("alert-dialog-open");
    root.style.overflow = "hidden";
    root.style.scrollbarGutter = "stable";
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };

    document.addEventListener("keydown", handleEscape);

    return () => {
      root.classList.remove("alert-dialog-open");
      document.body.classList.remove("alert-dialog-open");
      root.style.overflow = previousRootOverflow;
      root.style.scrollbarGutter = previousRootScrollbarGutter;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.touchAction = previousTouchAction;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onCancel, open]);

  if (!open) return null;

  const stopPropagation = (event: MouseEvent<HTMLDivElement>) =>
    event.stopPropagation();

  return createPortal(
    <div className="alert-dialog-backdrop" onClick={onCancel}>
      <div
        className="alert-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
        onClick={stopPropagation}
      >
        <h2 id="alert-dialog-title">{title}</h2>
        <p id="alert-dialog-description">{description}</p>
        <div className="alert-dialog__actions">
          <button
            className="btn btn-secondary"
            type="button"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button className="btn btn-danger" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
