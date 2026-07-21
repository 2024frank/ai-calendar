import type { HTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["surface", className].filter(Boolean).join(" ")} {...props} />;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__copy">
        {eyebrow && <div className="page-header__eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Icon name={icon} /></span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["alert", `alert--${tone}`, className].filter(Boolean).join(" ")} role={tone === "danger" ? "alert" : "status"} aria-live="polite">
      <Icon name={tone === "success" ? "check" : "alert"} />
      <div>{title && <strong>{title}</strong>}<div>{children}</div></div>
    </div>
  );
}

export function TableShell({ children, label }: { children: ReactNode; label: string }) {
  return <div className="table-shell" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["skeleton", className].filter(Boolean).join(" ")} aria-hidden="true" {...props} />;
}

export function LoadingState({ label = "Loading content…" }: { label?: string }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="skeleton--title" />
      <Skeleton className="skeleton--copy" />
      <div className="loading-state__grid">
        <Skeleton className="skeleton--card" />
        <Skeleton className="skeleton--card" />
        <Skeleton className="skeleton--card" />
      </div>
      <Skeleton className="skeleton--table" />
    </div>
  );
}
