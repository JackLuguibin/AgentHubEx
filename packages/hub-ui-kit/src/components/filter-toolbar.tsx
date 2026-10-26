import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { ui } from "../ui.js";

export function FilterToolbar({
  count,
  leading,
  className,
  children,
}: {
  count?: ReactNode;
  leading?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn(ui.toolbar, className)}>
      {leading}
      {count != null ? <span className={ui.managementCount}>{count}</span> : null}
      {children != null ? <div className={ui.filters}>{children}</div> : null}
    </div>
  );
}
