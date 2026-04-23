/**
 * Tiny toast system. Call showToast(message, kind?) from anywhere under
 * <ToastProvider/>. Toasts auto-dismiss after ~3s and stack in the
 * lower-left corner. No dependencies, no animations beyond a CSS fade.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  showToast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_TTL_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = nextIdRef.current++;
      setToasts((prev) => [...prev, { id, message, kind }]);
      setTimeout(() => dismiss(id), DEFAULT_TTL_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div style={viewportStyle} aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onDismiss(t.id)}
          style={{ ...toastBaseStyle, ...kindStyle(t.kind) }}
          aria-label={`Dismiss notification: ${t.message}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}

function kindStyle(kind: ToastKind): React.CSSProperties {
  switch (kind) {
    case 'success':
      return { background: '#16a34a', color: '#fff' };
    case 'error':
      return { background: '#dc2626', color: '#fff' };
    case 'info':
    default:
      return { background: '#1e293b', color: '#fff' };
  }
}

const viewportStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 20,
  left: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  zIndex: 9999,
  pointerEvents: 'none',
};

const toastBaseStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  padding: '10px 16px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.2)',
  textAlign: 'left',
  maxWidth: 360,
  animation: 'toast-in 180ms ease-out',
};
