import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@agenthub/hub-ui-kit";

type ToastContextValue = {
  toast: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  const toast = useCallback((text: string) => {
    setMessage(text);
    setVisible(true);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setVisible(false), 3200);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed bottom-6 left-1/2 z-[80] max-w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-lg border border-ah-line bg-[#182230] px-4 py-2.5 text-center text-[11px] leading-relaxed text-white shadow-[0_8px_28px_#10182833] transition-[opacity,transform]",
          visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        )}
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}
