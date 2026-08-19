/**
 * Shared building blocks.
 *
 * The interface is mostly panels and tables, so those two get proper
 * components and everything else is composed from them. Attribute colouring
 * lives here as well: a number's colour has to mean the same thing on every
 * screen or it stops being readable at a glance.
 */

import type { ReactNode } from "react";

export function Panel({
  title,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`rounded-md border border-[var(--border)] bg-[var(--bg-raised)] ${className}`}
    >
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/**
 * Colour scale for a 1 to 100 attribute. The bands are wide enough that a
 * reader learns them quickly: red is a weakness, green is a strength.
 */
export function attrColor(value: number): string {
  if (value >= 85) return "var(--elite)";
  if (value >= 70) return "var(--good)";
  if (value >= 55) return "var(--ok)";
  return "var(--bad)";
}

export function Attr({ value, wide = false }: { value: number; wide?: boolean }) {
  return (
    <span
      className={`numeric inline-block text-right font-medium ${wide ? "w-8" : "w-6"}`}
      style={{ color: attrColor(value) }}
    >
      {value}
    </span>
  );
}

/** Attribute with its label, as used on the player page. */
export function AttrRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2 py-[3px]">
      <span className="text-[var(--text-muted)]">{label}</span>
      <div className="flex items-center gap-2">
        <span className="h-1 w-16 overflow-hidden rounded-full bg-[var(--border)]">
          <span
            className="block h-full rounded-full"
            style={{ width: `${value}%`, background: attrColor(value) }}
          />
        </span>
        <Attr value={value} />
      </div>
    </div>
  );
}

/** A fitness bar. Colour shifts as a player tires. */
export function FitnessBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 85 ? "var(--good)" : pct >= 65 ? "var(--ok)" : "var(--bad)";
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-[var(--border)]">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="numeric w-6 text-right text-[11px]" style={{ color }}>
        {Math.round(pct)}
      </span>
    </div>
  );
}

/** Recent-form figure, rendered as a rating out of ten. */
export function FormBadge({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-[var(--text-dim)]">-</span>;
  }
  const color =
    value >= 7.5 ? "var(--elite)" : value >= 6.8 ? "var(--good)" : value >= 6.2 ? "var(--ok)" : "var(--bad)";
  return (
    <span
      className="numeric rounded px-1.5 py-0.5 text-[11px] font-semibold"
      style={{ color, background: "color-mix(in srgb, currentColor 12%, transparent)" }}
    >
      {value.toFixed(1)}
    </span>
  );
}

/** Win, draw or loss chip for a form guide. */
export function ResultChip({ result }: { result: "W" | "D" | "L" }) {
  const map = {
    W: { bg: "rgba(63,185,80,0.18)", fg: "var(--good)" },
    D: { bg: "rgba(210,153,34,0.18)", fg: "var(--ok)" },
    L: { bg: "rgba(248,81,73,0.18)", fg: "var(--bad)" },
  }[result];

  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] text-[10px] font-bold"
      style={{ background: map.bg, color: map.fg }}
    >
      {result}
    </span>
  );
}

/**
 * Club colour marker. The ring is light rather than dark: several clubs play
 * in near-black, which would otherwise vanish against the background.
 */
export function ClubDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/25"
      style={{ background: color }}
    />
  );
}

export function Button({
  children,
  variant = "default",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md";
}) {
  const variants = {
    default:
      "bg-[var(--bg-hover)] border-[var(--border-strong)] text-[var(--text)] hover:bg-[var(--border)]",
    primary:
      "bg-[var(--accent-dim)] border-[var(--accent)] text-white hover:bg-[var(--accent)]",
    ghost:
      "bg-transparent border-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]",
    danger: "bg-transparent border-[var(--bad)] text-[var(--bad)] hover:bg-[rgba(248,81,73,0.12)]",
  };
  const sizes = { sm: "px-2 py-1 text-[11px]", md: "px-3 py-1.5 text-[12px]" };

  return (
    <button
      className={`rounded border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-3 py-8 text-center text-[var(--text-muted)]">{children}</p>;
}

/** Availability marker shown beside a player's name. */
export function AvailabilityIcon({
  reason,
}: {
  reason: "injured" | "suspended" | null;
}) {
  if (!reason) return null;
  const label = reason === "injured" ? "INJ" : "SUS";
  const color = reason === "injured" ? "var(--bad)" : "var(--ok)";
  return (
    <span
      className="rounded px-1 text-[9px] font-bold"
      style={{ color, background: "color-mix(in srgb, currentColor 15%, transparent)" }}
      title={reason === "injured" ? "Injured" : "Suspended"}
    >
      {label}
    </span>
  );
}
