import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { ui } from "../ui.js";

export type AvatarTone = "default" | "green" | "blue" | "purple" | "orange";

const toneClass: Record<AvatarTone, string> = {
  default: "",
  green: ui.avatarGreen,
  blue: ui.avatarBlue,
  purple: ui.avatarPurple,
  orange: ui.avatarOrange,
};

export function Avatar({
  tone = "default",
  size = "md",
  className,
  children,
}: {
  tone?: AvatarTone;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        ui.avatar,
        toneClass[tone],
        size === "sm" && ui.avatarSmall,
        className,
      )}
    >
      {children}
    </span>
  );
}
