import * as React from "react";
import { cn } from "../lib/cn.js";
import { ui } from "../ui.js";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  variant?: "filter" | "field";
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, variant = "filter", children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        variant === "field" ? ui.fieldControl : ui.select,
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";
