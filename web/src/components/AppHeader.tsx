"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { loggedOut } from "@/store/authSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { Button, Logo } from "./ui";

export default function AppHeader() {
  const dispatch = useAppDispatch();
  const pathname = usePathname();
  const user = useAppSelector((s) => s.auth.user);
  const links = [
    { href: "/tours", label: "Tours" },
    ...(user?.role === "admin" ? [{ href: "/admin", label: "Admin portal" }] : []),
  ];

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/tours" aria-label="TourVault home">
            <Logo />
          </Link>
          {user && (
            <nav aria-label="Main" className="flex gap-1">
              {links.map((link) => {
                const active = pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      active ? "bg-sunken text-ink" : "text-muted hover:bg-sunken hover:text-ink"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
        {user && (
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="max-w-[16rem] truncate text-sm font-medium">{user.email}</p>
              <p className="text-xs capitalize text-faint">{user.role}</p>
            </div>
            <span
              className="grid size-9 place-items-center rounded-full bg-brand-100 text-sm font-semibold uppercase text-brand-700"
              aria-hidden="true"
            >
              {user.email[0]}
            </span>
            <Button variant="secondary" size="sm" onClick={() => dispatch(loggedOut())}>
              Log out
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
