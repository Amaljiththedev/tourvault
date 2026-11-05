"use client";

import Link from "next/link";
import { useEffect } from "react";
import ActivityList from "@/components/ActivityList";
import { PageTitle, useAdminReady } from "@/components/AdminShell";
import { Alert, Card, Spinner } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import { clearAdminError, fetchActivity, fetchStats } from "@/store/adminSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

export default function AdminOverview() {
  const dispatch = useAppDispatch();
  const { stats, activity, error, loading } = useAppSelector((s) => s.admin);
  const ready = useAdminReady();

  useEffect(() => {
    if (!ready) return;
    dispatch(fetchStats());
    dispatch(fetchActivity());
  }, [ready, dispatch]);

  const cards = stats
    ? [
        { label: "Tours", value: stats.tours, note: `${stats.published_tours} published`, href: "/admin/tours" },
        { label: "360 scan points", value: stats.scan_points, note: `${stats.models} 3D models`, href: "/admin/upload" },
        { label: "Storage used", value: formatBytes(stats.storage_bytes), note: `${stats.files} files`, href: "/admin/upload" },
        { label: "Users", value: stats.users, note: `${stats.admins} admin${stats.admins === 1 ? "" : "s"}`, href: "/admin/users" },
      ]
    : [];

  return (
    <>
      <PageTitle title="Overview" subtitle="What is in TourVault right now, and what changed recently." />
      {error && <Alert onClose={() => dispatch(clearAdminError())}>{error}</Alert>}

      {!stats ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="size-4" /> Loading...
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <Link key={card.label} href={card.href} className="group">
                <Card className="h-full p-5 transition-shadow group-hover:shadow-pop">
                  <p className="text-sm text-muted">{card.label}</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{card.value}</p>
                  <p className="mt-1 text-xs text-faint">{card.note}</p>
                </Card>
              </Link>
            ))}
          </div>

          {(stats.failed_files > 0 || stats.processing_files > 0) && (
            <Alert tone={stats.failed_files ? "warn" : "info"}>
              {stats.failed_files > 0 && `${stats.failed_files} file${stats.failed_files === 1 ? "" : "s"} failed processing. `}
              {stats.processing_files > 0 && `${stats.processing_files} still processing. `}
              <Link href="/admin/upload" className="font-medium underline">
                Review uploads
              </Link>
            </Alert>
          )}
        </>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-semibold">Recent activity</h2>
            <Link href="/admin/activity" className="text-sm font-medium text-brand-700 hover:underline">
              View all
            </Link>
          </div>
          {loading.activity && !activity.length ? (
            <p className="px-5 py-8 text-sm text-muted">Loading...</p>
          ) : (
            <ActivityList entries={activity.slice(0, 8)} />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Quick actions</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {[
              { href: "/admin/tours", label: "Create or edit a tour" },
              { href: "/admin/upload", label: "Upload 3D files" },
              { href: "/admin/upload#scan-point", label: "Build a 360 scan point from six images" },
              { href: "/admin/users", label: "Change who is an admin" },
            ].map((a) => (
              <li key={a.href}>
                <Link href={a.href} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-sunken">
                  {a.label} <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
