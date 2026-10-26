import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { ui } from "../ui.js";

export function StatGrid({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn(ui.stats, className)}>{children}</div>;
}

export function Stat({
  label,
  value,
  note,
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <article className={cn(ui.stat, className)}>
      <div className={ui.statTop}>
        <span>{label}</span>
        {icon}
      </div>
      <div className={ui.statValue}>{value}</div>
      {note != null ? <div className={ui.statNote}>{note}</div> : null}
    </article>
  );
}
