import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { ui } from "../ui.js";

export function EmptyState({
  surface = false,
  className,
  children,
}: {
  surface?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(surface && ui.surface, ui.empty, className)}>{children}</div>
  );
}
