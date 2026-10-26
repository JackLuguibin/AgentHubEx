import { useEffect, type ReactNode } from "react";
import { Button, cn, ui } from "@agenthub/hub-ui-kit";

export function Modal({
  open,
  title,
  children,
  footer,
  onClose,
  wide,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-[#10182866] p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          ui.surface,
          "max-h-[min(90vh,720px)] w-full overflow-auto p-0 shadow-[0_16px_48px_#1018282e]",
          wide ? "max-w-[640px]" : "max-w-[480px]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ah-line px-5 py-4">
          <h2 className="m-0 text-sm font-semibold text-[#182230]">{title}</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            ×
          </Button>
        </div>
        <div className="px-5 py-4 text-[11px] leading-[1.7] text-[#667085]">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ah-line px-5 py-3.5">
            <Button type="button" variant="secondary" onClick={onClose}>
              取消
            </Button>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
