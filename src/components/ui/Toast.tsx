"use client";

// MODULAR: Toast notifications. Single provider + hook. Toasts
// mount in the corner, queue below each other (column-reverse),
// and self-dismiss after `durationMs`.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ToastType = "info" | "success" | "error" | "warning";

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

export interface ToastContextValue {
  showToast: (message: string, type?: ToastType, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "info", durationMs = 4000) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, type }]);
      const timer = setTimeout(() => dismiss(id), durationMs);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        className="fixed bottom-6 right-6 z-[100] flex flex-col-reverse gap-0 max-w-[360px] pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto font-mono text-[11px] uppercase tracking-[0.1em] px-4 py-3 mb-1",
              "bg-[var(--color-ink)] text-[var(--color-paper)] border-l-[3px]",
              t.type === "success" && "border-l-[#2d6a2d]",
              t.type === "error" && "border-l-[#b00020]",
              t.type === "warning" && "border-l-[var(--color-rust)]",
              t.type === "info" && "border-l-[var(--color-rust)]",
              "animate-[toastIn_0.18s_ease-out]",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
      <style jsx global>{`
        @keyframes toastIn {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0);   opacity: 1; }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Allow usage outside the provider during SSR; no-op fallback.
    return { showToast: () => undefined };
  }
  return ctx;
}
