import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ToastContext } from "./ToastContext";
import type { ToastMessage, ToastType } from "./ToastContext";
import checkIcon from "../../assets/icons/check.svg";
import closeIcon from "../../assets/icons/x.svg";
import "../../styles/core/toast.css";

const TOAST_LIFETIME_MS = 3500;
const TOAST_EXIT_MS = 180;

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
}) {
  const [closing, setClosing] = useState(false);

  const close = useCallback(() => setClosing(true), []);

  useEffect(() => {
    if (closing) return;
    const timeoutId = window.setTimeout(close, TOAST_LIFETIME_MS);
    return () => window.clearTimeout(timeoutId);
  }, [closing, close]);

  useEffect(() => {
    if (!closing) return;
    const timeoutId = window.setTimeout(
      () => onDismiss(toast.id),
      TOAST_EXIT_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [closing, onDismiss, toast.id]);

  return (
    <div
      className={`toast-item${closing ? " toast-item--closing" : ""}`}
      style={{ "--toast-exit": `${TOAST_EXIT_MS}ms` } as CSSProperties}
    >
      <div className="toast-item__inner">
        <div
          className={`toast toast--${toast.type}`}
          role={toast.type === "error" ? "alert" : "status"}
          aria-live={toast.type === "error" ? "assertive" : "polite"}
        >
          <span className="toast__icon" aria-hidden="true">
            <img
              src={toast.type === "success" ? checkIcon : closeIcon}
              alt=""
            />
          </span>
          <span className="toast__message">{toast.message}</span>
          <button
            className="toast__dismiss"
            type="button"
            aria-label="Закрыть уведомление"
            onClick={close}
          >
            <img src={closeIcon} alt="" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(0);

  const notify = useCallback((type: ToastType, message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, type, message }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="toast-region" role="region" aria-label="Уведомления">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
