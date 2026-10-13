import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { ToastContext } from "./ToastContext";
import type { ToastMessage, ToastType } from "./ToastContext";
import "../../styles/core/toast.css";

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timeoutId = window.setTimeout(() => onDismiss(toast.id), 4500);
    return () => window.clearTimeout(timeoutId);
  }, [onDismiss, toast.id]);

  return (
    <div
      className={`toast toast--${toast.type}`}
      role={toast.type === "error" ? "alert" : "status"}
      aria-live={toast.type === "error" ? "assertive" : "polite"}
    >
      <span className="toast__icon" aria-hidden="true">
        {toast.type === "success" ? "✓" : "!"}
      </span>
      <span className="toast__message">{toast.message}</span>
      <button
        className="toast__dismiss"
        type="button"
        aria-label="Закрыть уведомление"
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
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
