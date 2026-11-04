"use client";

import { forwardRef, useId, useState } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-surface text-ink border border-line hover:bg-sunken",
  ghost: "text-muted hover:bg-sunken hover:text-ink",
  danger: "bg-surface text-bad border border-line hover:bg-bad-bg",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
}) {
  const sizing = size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm";
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const inputBase =
  "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-100 aria-invalid:border-bad";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return <input ref={ref} className={`${inputBase} ${className}`} {...props} />;
  },
);

export function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${inputBase} pr-8 ${className}`} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-xs text-bad">{error}</p>
      ) : hint ? (
        <p className="text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="pr-16" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-xs font-medium text-muted hover:bg-sunken hover:text-ink"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}

export function Alert({
  tone = "bad",
  children,
  onClose,
}: {
  tone?: "bad" | "info" | "ok" | "warn";
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const tones = {
    bad: "bg-bad-bg text-bad border-bad/20",
    info: "bg-info-bg text-info border-info/20",
    ok: "bg-ok-bg text-ok border-ok/20",
    warn: "bg-warn-bg text-warn border-warn/20",
  };
  return (
    <div role="alert" className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${tones[tone]}`}>
      <div className="flex-1">{children}</div>
      {onClose && (
        <button onClick={onClose} className="text-current/70 hover:text-current" aria-label="Dismiss">
          &times;
        </button>
      )}
    </div>
  );
}

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <section className={`rounded-xl border border-line bg-surface shadow-card ${className}`}>{children}</section>;
}

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-brand-500 text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" strokeLinejoin="round" />
          <path d="m3 7 9 5 9-5M12 12v10" strokeLinejoin="round" />
        </svg>
      </span>
      <span className={`text-lg font-semibold tracking-tight ${dark ? "text-white" : "text-ink"}`}>TourVault</span>
    </span>
  );
}

export function FullScreenLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex items-center gap-3 text-muted">
        <Spinner />
        <span className="text-sm">{label}...</span>
      </div>
    </div>
  );
}
