import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { ui } from "../ui.js";
import { Icon } from "./icon.js";

export function Banner({
  icon,
  trailing,
  className,
  children,
}: {
  icon?: LucideIcon;
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(ui.banner, className)}>
      {icon ? <Icon icon={icon} size="sm" /> : null}
      <span className="min-w-0 flex-1">{children}</span>
      {trailing}
    </div>
  );
}
