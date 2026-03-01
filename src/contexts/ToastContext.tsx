import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";

export type ToastType = "error" | "warning" | "success" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS: Record<ToastType, number> = {
  error: 5000,
  warning: 4000,
  info: 3000,
  success: 2000,
};

const MAX_TOASTS = 5;

const TYPE_STYLES: Record<ToastType, string> = {
  error: "bg-red-800 text-white",
  warning: "bg-yellow-700 text-white",
  info: "bg-gray-700 text-gray-100",
  success: "bg-green-700 text-white",
};

const TYPE_ICONS: Record<ToastType, string> = {
  error: "\u2718",
  warning: "\u26A0",
  info: "\u2139",
  success: "\u2714",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "error") => {
      const id = nextIdRef.current++;
      setToasts((prev) => {
        const updated = [...prev, { id, message, type }];
        // Keep only the last MAX_TOASTS
        return updated.slice(-MAX_TOASTS);
      });

      setTimeout(() => removeToast(id), AUTO_DISMISS_MS[type]);
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container */}
      {toasts.length > 0 && (
        <>
          <style>{`
            @keyframes toast-slide-in {
              from {
                transform: translateX(100%);
                opacity: 0;
              }
              to {
                transform: translateX(0);
                opacity: 1;
              }
            }
          `}</style>
          <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={`pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-md shadow-lg text-sm max-w-sm cursor-pointer ${TYPE_STYLES[toast.type]}`}
                style={{ animation: "toast-slide-in 0.25s ease-out" }}
                onClick={() => removeToast(toast.id)}
              >
                <span className="flex-shrink-0">{TYPE_ICONS[toast.type]}</span>
                <span className="flex-1">{toast.message}</span>
                <button
                  className="flex-shrink-0 ml-2 opacity-70 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeToast(toast.id);
                  }}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
