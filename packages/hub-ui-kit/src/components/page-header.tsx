import type { ReactNode } from "react";
import { ui } from "../ui.js";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={ui.pageHead}>
      <div className="min-w-0">
        {eyebrow ? <p className={ui.eyebrow}>{eyebrow}</p> : null}
        <h1 className={ui.pageHeadTitle}>{title}</h1>
        {description ? <p className={ui.pageHeadDesc}>{description}</p> : null}
      </div>
      {actions ? <div className={ui.pageHeadActions}>{actions}</div> : null}
    </div>
  );
}
