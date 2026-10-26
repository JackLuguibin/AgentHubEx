import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { badgeClass, type BadgeTone } from "../ui.js";

export function Badge({
  tone = "default",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cn(badgeClass(tone), className)}>{children}</span>;
}
