"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAppSelector } from "@/store/hooks";
import AppHeader from "./AppHeader";
import { Card, FullScreenLoader } from "./ui";

const NAV = [
  { href: "/admin", label: "Overview", icon: "M3 12h7V3H3v9Zm0 9h7v-6H3v6Zm11 0h7v-9h-7v9Zm0-18v6h7V3h-7Z" },
  { href: "/admin/tours", label: "Tours", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/admin/upload", label: "Uploads & scan points", icon: "M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" },
  { href: "/admin/users", label: "Users", icon: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm13 9v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" },
  { href: "/admin/activity", label: "Activity", icon: "M3 12h4l3-8 4 16 3-8h4" },
];

// True once the session is restored and belongs to an admin. Pages wait for
// it before loading data, because they are rendered (hidden) before that.
export function useAdminReady(): boolean {
  return useAppSelector((s) => s.auth.status === "authenticated" && s.auth.user?.role === "admin");
}

// Wraps every /admin page: sends anonymous visitors to log in and shows
// viewers a refusal. This guard is only for navigation; every /admin API
// call is checked on the server, which is the real protection.
//
// The page is always rendered, just hidden until the user is known to be an
// admin. Swapping it for a loader instead would drop the page segment from
// the tree, which Next's instant-navigation check reports as an error.
export default function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useAppSelector((s) => s.auth.status);
  const ready = useAdminReady();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  return (
    <div className="min-h-screen">
      {status !== "authenticated" && <FullScreenLoader />}
      {status === "authenticated" && <AppHeader />}
      {status === "authenticated" && !ready && (
        <div className="mx-auto max-w-lg px-4 py-20">
          <Card className="space-y-3 p-8 text-center">
            <h1 className="text-xl font-semibold tracking-tight">Admin access required</h1>
            <p className="text-sm text-muted">Your account is a viewer. Ask an admin to change your role.</p>
            <Link href="/tours" className="inline-block text-sm font-medium text-brand-700 hover:underline">
              Back to tours
            </Link>
          </Card>
        </div>
      )}
      {
        <div hidden={!ready} className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[232px_1fr]">
          <nav aria-label="Admin" className="lg:sticky lg:top-22 lg:self-start">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-faint">Admin portal</p>
            <ul className="flex gap-1 overflow-x-auto lg:flex-col">
              {NAV.map((item) => {
                const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                return (
                  <li key={item.href} className="shrink-0">
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active ? "bg-brand-50 text-brand-700" : "text-muted hover:bg-sunken hover:text-ink"
                      }`}
                    >
                      <svg viewBox="0 0 24 24" className="size-4.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <path d={item.icon} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <main className="min-w-0 space-y-6">{children}</main>
        </div>
      }
    </div>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
