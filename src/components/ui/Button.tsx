import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

function classes(variant: Variant, size: Size, className?: string) {
  return ["button", `button--${variant}`, `button--${size}`, className].filter(Boolean).join(" ");
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  loading?: boolean;
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={classes(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="button__loader" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      <span>{loading ? "Working…" : children}</span>
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link className={classes(variant, size, className)} href={href}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </Link>
  );
}

export function IconButton({ label, icon, ...props }: Omit<ButtonProps, "children" | "icon"> & { label: string; icon: IconName }) {
  return (
    <Button className="button--icon" icon={icon} aria-label={label} title={label} {...props}>
      <span className="sr-only">{label}</span>
    </Button>
  );
}
