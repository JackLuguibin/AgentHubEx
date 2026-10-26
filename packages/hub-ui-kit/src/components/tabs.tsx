import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { ui } from "../ui.js";

export type TabItem<T extends string = string> = {
  value: T;
  label: ReactNode;
};

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  "aria-label": ariaLabel,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  "aria-label"?: string;
  className?: string;
}) {
  return (
    <div className={cn(ui.tabs, className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          className={cn(ui.tab, value === item.value && ui.tabActive)}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
