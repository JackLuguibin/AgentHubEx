import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { ui } from "../ui.js";

export function Field({
  label,
  hint,
  full = false,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  full?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn(ui.field, full && ui.fieldFull, className)}>
      {label}
      {children}
      {hint != null ? <small>{hint}</small> : null}
    </label>
  );
}
