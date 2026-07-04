import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import './Toast.css';

/**
 * Minimal transient notices (playlist-editing 03). `useToast()` returns a
 * `show(message)` function; notices stack bottom-center and auto-dismiss.
 * Informational only — never interactive, never blocking.
 */

interface ToastItem {
  id: number;
  message: string;
}

const ToastContext = createContext<((message: string) => void) | undefined>(undefined);

const TOAST_DURATION_MS = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className="toast-notice">
              {t.message}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used within a ToastProvider');
  return show;
}
