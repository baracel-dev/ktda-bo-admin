import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";
import { Link } from "react-router-dom";
import { InfoTip } from "./InfoTip";

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline" | "inverted" | "outline-inverted";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      type={props.type ?? "button"}
      // Styling hooks a theme layer can target (the investor app's does).
      // Attributes only — they change nothing for apps that don't target them.
      data-variant={variant}
      data-size={size}
      className={clsx(
        "inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 ease-out rounded-md disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-[15px]",
        variant === "primary" &&
          "bg-primary-600 text-[var(--text-on-primary)] shadow-sm hover:bg-primary-700",
        variant === "secondary" &&
          "bg-surface-sunken text-text hover:bg-border border border-border",
        variant === "outline" &&
          "border border-border-strong text-text bg-surface hover:bg-surface-sunken",
        variant === "ghost" && "text-text-soft hover:text-text hover:bg-surface-sunken",
        variant === "danger" && "bg-danger text-white hover:opacity-90 shadow-sm",
        // For use on colored/dark backgrounds (e.g. a CTA banner) — deliberately
        // not composed via className overrides on the "primary"/"outline"
        // variants, since two classes targeting the same CSS property fight
        // based on Tailwind's generated stylesheet order, not attribute order,
        // and silently produce invisible text depending on which wins.
        variant === "inverted" && "bg-white text-primary-700 shadow-sm hover:bg-primary-50",
        variant === "outline-inverted" && "border border-white/30 text-white bg-transparent hover:bg-white/10",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  className,
  interactive,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={clsx(
        "bg-surface border border-border rounded-xl shadow-sm",
        interactive && "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-primary-300/60 cursor-pointer",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "accent";
  children: ReactNode;
  className?: string;
}) {
  const toneClasses: Record<string, string> = {
    neutral: "bg-surface-sunken text-text-soft border-border",
    success: "bg-success-bg text-success border-transparent",
    warning: "bg-warning-bg text-warning border-transparent",
    danger: "bg-danger-bg text-danger border-transparent",
    info: "bg-info-bg text-info border-transparent",
    accent: "bg-accent-300/25 text-accent-700 border-transparent",
  };
  return (
    <span
      data-tone={tone}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  trend,
  icon,
  tooltip,
  chart,
  to,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  trend?: { value: string; positive?: boolean };
  icon?: ReactNode;
  /** Plain-English explanation for jargon labels (NAV, AUM, etc.) — shown via a small (i) icon. */
  tooltip?: string;
  /** Optional trend shape under the number — a sparkline, not a full chart.
   * The number stays the value; this only carries direction. */
  chart?: ReactNode;
  /** Makes the whole tile a link target. Purely additive: without it the tile
   * renders and behaves exactly as before. */
  to?: string;
}) {
  return (
    <Card className="p-5 flex flex-col gap-3 animate-fade-in relative">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-faint">
          {label}
          {tooltip && <InfoTip text={tooltip} />}
        </span>
        {icon && (
          <span className="h-8 w-8 rounded-lg bg-primary-50 text-primary-600 ring-1 ring-primary-500/20 flex items-center justify-center shrink-0">
            {icon}
          </span>
        )}
      </div>
      <div className="text-2xl font-display font-semibold tabular text-text">{value}</div>
      {chart}
      <div className="flex items-center gap-2 text-xs">
        {trend && (
          <span className={clsx("font-semibold", trend.positive ? "text-success" : "text-danger")}>
            {trend.positive ? "▲" : "▼"} {trend.value}
          </span>
        )}
        {hint && <span className="text-text-faint">{hint}</span>}
      </div>
      {to && (
        <Link
          to={to}
          aria-label={label}
          className="absolute inset-0 rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
        />
      )}
    </Card>
  );
}

export function ProgressBar({ value, tone = "primary" }: { value: number; tone?: "primary" | "warning" | "danger" }) {
  const bar = { primary: "bg-primary-600", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div className="h-2 w-full rounded-full bg-surface-sunken overflow-hidden">
      <div
        className={clsx("h-full rounded-full transition-all duration-500", bar)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 text-center py-16 px-6">
      {icon && <div className="h-12 w-12 rounded-full bg-surface-sunken flex items-center justify-center text-text-faint">{icon}</div>}
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {body && <p className="text-sm text-text-soft max-w-sm">{body}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        "rounded-md bg-[linear-gradient(90deg,var(--surface-sunken)_25%,var(--border)_37%,var(--surface-sunken)_63%)] bg-[length:200%_100%] animate-shimmer",
        className,
      )}
    />
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  tooltip,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Plain-English explanation for an acronym-heavy title (NAV, KYC, etc.) — shown via a small (i) icon. */
  tooltip?: string;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
      <div>
        {eyebrow && <div className="text-xs font-semibold uppercase tracking-wide text-primary-600 mb-1">{eyebrow}</div>}
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-semibold text-text">
          {title}
          {tooltip && <InfoTip text={tooltip} />}
        </h1>
        {subtitle && <p className="text-sm text-text-soft mt-1 max-w-xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
