import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn.js";

const sizes = {
  xs: "h-3 w-3",
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-[17px] w-[17px]",
} as const;

export function Icon({
  icon: Lucide,
  size = "sm",
  className,
  strokeWidth = 1.75,
}: {
  icon: LucideIcon;
  size?: keyof typeof sizes;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <Lucide
      className={cn("shrink-0", sizes[size], className)}
      strokeWidth={strokeWidth}
      aria-hidden
    />
  );
}
