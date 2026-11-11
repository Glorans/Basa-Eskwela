import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import "./dashboard.css";

/** One independently loaded dashboard source: a failure never blocks the other cards. */
export type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

export function useLoad<T>(loader: (() => Promise<T>) | null, deps: unknown[]): Load<T> {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  useEffect(() => {
    if (!loader) return;
    let active = true;
    setState({ status: "loading" });
    loader().then(
      (data) => { if (active) setState({ status: "ready", data }); },
      (error: unknown) => { if (active) setState({ status: "error", message: error instanceof Error && error.message ? error.message : "Unable to load." }); },
    );
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** A card value from a source: "…" while loading, "—" when unavailable (never a made-up number). */
export function valueOf<T>(load: Load<T>, pick: (data: T) => number | string | null | undefined): string {
  if (load.status === "loading") return "…";
  if (load.status === "error") return "—";
  const value = pick(load.data);
  return value === null || value === undefined ? "—" : String(value);
}

export function DashboardHero({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="rd-hero">
      <p className="rd-hero-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}

export function StatCard({ icon: Icon, value, label, to }: { icon: LucideIcon; value: string; label: string; to?: string }) {
  const body = (
    <>
      <span className="rd-stat-icon" aria-hidden="true"><Icon size={22} /></span>
      <span className="rd-stat-body">
        <span className="rd-stat-value">{value}</span>
        <span className="rd-stat-label">{label}</span>
      </span>
    </>
  );
  return to ? <Link className="rd-stat" to={to} aria-label={`${label}: ${value}`}>{body}</Link> : <div className="rd-stat">{body}</div>;
}

export function DashboardSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rd-section" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export type QuickAction = { label: string; to: string; icon?: LucideIcon; secondary?: boolean };

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="rd-actions">
      {actions.map(({ label, to, icon: Icon, secondary }) => (
        <Link key={label} className={`rd-action${secondary ? " rd-action--secondary" : ""}`} to={to}>
          {Icon && <Icon size={17} aria-hidden="true" />}
          {label}
        </Link>
      ))}
    </div>
  );
}

export function EmptyState({ children, actions }: { children: ReactNode; actions?: QuickAction[] }) {
  return (
    <div className="rd-empty">
      {children}
      {actions?.length ? <QuickActions actions={actions} /> : null}
    </div>
  );
}

/** Renders a list source with consistent loading, error and empty states. */
export function LoadedList<T>({ load, render, empty, errorText }: {
  load: Load<T[]>; render: (item: T) => ReactNode; empty: ReactNode; errorText: string;
}) {
  if (load.status === "loading") return <p className="rd-muted" role="status">Loading...</p>;
  if (load.status === "error") return <p className="rd-error" role="alert">{errorText}</p>;
  if (!load.data.length) return <>{empty}</>;
  return <ul className="rd-list">{load.data.map(render)}</ul>;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(date);
}
