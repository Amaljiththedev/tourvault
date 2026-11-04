"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FullScreenLoader, Logo } from "./ui";
import { useAppSelector } from "@/store/hooks";

// Split-screen layout shared by the login and register pages. Already
// signed-in users are sent on to the app.
export default function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const status = useAppSelector((s) => s.auth.status);
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/tours");
  }, [status, router]);

  if (status !== "anonymous") return <FullScreenLoader />;

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-night p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(600px 400px at 20% 20%, rgb(20 163 139 / 0.35), transparent 60%), radial-gradient(500px 400px at 90% 90%, rgb(47 111 222 / 0.3), transparent 60%)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative">
          <Logo dark />
        </div>
        <div className="relative max-w-md space-y-6">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Every ward, corridor and entrance, ready to explore in 3D.
          </h2>
          <p className="text-base text-white/70">
            Upload GLB models and PLY scans for each hospital tour. TourVault checks every file in the background
            and serves it straight from secure storage.
          </p>
          <ul className="space-y-3 text-sm text-white/80">
            {[
              "Role-based access: admins publish, viewers explore",
              "Files validated after upload, with clear errors",
              "Short-lived signed links, never public buckets",
            ].map((line) => (
              <li key={line} className="flex items-center gap-3">
                <span className="grid size-5 place-items-center rounded-full bg-brand-500/20 text-brand-100">
                  <svg viewBox="0 0 20 20" className="size-3" fill="currentColor" aria-hidden="true">
                    <path d="M7.5 13.6 3.9 10l-1.4 1.4 5 5 10-10-1.4-1.4z" />
                  </svg>
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">TourVault</p>
      </aside>

      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
