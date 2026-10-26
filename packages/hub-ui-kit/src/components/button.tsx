import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-[7px] whitespace-nowrap rounded-[6px] border border-solid text-[11px] font-medium leading-[1.4] transition-[filter,background-color,border-color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ah-accent/45 disabled:pointer-events-none disabled:opacity-45 disabled:hover:filter-none",
  {
    variants: {
      variant: {
        default:
          "border-ah-accent bg-ah-accent px-[13px] py-[9px] text-white hover:bg-ah-accent-hover hover:filter-none",
        secondary:
          "border-[#d0d5dd] bg-white px-[13px] py-[9px] text-[#344054] hover:brightness-[0.97]",
        ghost:
          "border-transparent bg-transparent px-[13px] py-[9px] text-ah-muted hover:bg-[#f2f4f7] hover:filter-none",
        outline:
          "border-[#d0d5dd] bg-white px-[13px] py-[9px] text-[#344054] hover:bg-[#fafbfe]",
        danger:
          "border-[#d0d5dd] bg-white px-[13px] py-[9px] text-[#b42318] hover:bg-[#fef3f2] hover:filter-none",
      },
      size: {
        default: "",
        sm: "px-[9px] py-[6px] text-[10px]",
        lg: "px-4 py-2.5 text-xs",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
