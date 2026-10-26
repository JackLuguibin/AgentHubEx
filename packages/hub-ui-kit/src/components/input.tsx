import * as React from "react";
import { cn } from "../lib/cn.js";
import { ui } from "../ui.js";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  variant?: "default" | "filter" | "field";
};

const variantClass = {
  default:
    "flex h-9 w-full rounded-[6px] border border-solid border-[#d0d5dd] bg-white px-3 py-2 text-xs text-[#475467] placeholder:text-[#7b8797] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8ca2f1]",
  filter: ui.searchInput,
  field: ui.fieldControl,
} as const;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = "default", ...props }, ref) => (
    <input
      type={type}
      className={cn(variantClass[variant], className)}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";
