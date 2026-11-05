"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageTitle, useAdminReady } from "@/components/AdminShell";
import { ConfirmDialog } from "@/components/Dialog";
import StatusBadge from "@/components/StatusBadge";
import TourFormDialog from "@/components/TourFormDialog";
import { Alert, Button, Card, Input, Spinner } from "@/components/ui";
import { formatBytes, formatDate } from "@/lib/format";
import type { AdminTour } from "@/lib/types";
import { clearAdminError, fetchAdminTours } from "@/store/adminSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearTourError, deleteTour, selectTour, updateTour } from "@/store/toursSlice";

export default function AdminToursPage() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { tours, loading, error } = useAppSelector((s) => s.admin);
  const tourError = useAppSelector((s) => s.tours.error);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<{ open: boolean; tour: AdminTour | null }>({ open: false, tour: null });
  const [toDelete, setToDelete] = useState<AdminTour | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const ready = useAdminReady();
  useEffect(() => {
    if (ready) dispatch(fetchAdminTours());
  }, [ready, dispatch]);

  const q = query.trim().toLowerCase();
  const shown = q ? tours.filter((t) => `${t.hospital} ${t.title}`.toLowerCase().includes(q)) : tours;

  async function togglePublished(tour: AdminTour) {
    setBusyId(tour.id);
    const status = tour.status === "published" ? "draft" : "published";
    const result = await dispatch(
      updateTour({ id: tour.id, input: { hospital: tour.hospital, title: tour.title, status }, version: tour.version }),
    );
    // A 409 means someone else changed it: reload to get the new version.
    if (updateTour.rejected.match(result)) dispatch(fetchAdminTours());
    setBusyId(null);
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setBusyId(toDelete.id);
    await dispatch(deleteTour(toDelete.id));
    setBusyId(null);
    setToDelete(null);
  }

  function manageFiles(tour: AdminTour) {
    dispatch(selectTour(tour.id));
    router.push("/admin/upload");
  }

  return (
    <>
      <PageTitle
        title="Tours"
        subtitle="Every hospital tour, how many files it has, and whether visitors can see it."
        actions={<Button onClick={() => setForm({ open: true, tour: null })}>New tour</Button>}
      />
      {error && <Alert onClose={() => dispatch(clearAdminError())}>{error}</Alert>}
      {tourError && !form.open && <Alert onClose={() => dispatch(clearTourError())}>{tourError}</Alert>}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <Input
            type="search"
            placeholder="Search hospital or title"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-xs"
            aria-label="Search tours"
          />
          <span className="text-xs text-muted">
            {shown.length} of {tours.length} tour{tours.length === 1 ? "" : "s"}
          </span>
        </div>

        {loading.tours && !tours.length ? (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted">
            <Spinner className="size-4" /> Loading tours...
          </div>
        ) : !shown.length ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            {tours.length ? "No tours match your search." : "No tours yet. Create one to start uploading."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-canvas text-left text-xs uppercase tracking-wider text-faint">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Tour</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Files</th>
                  <th className="px-3 py-2.5 font-medium">Size</th>
                  <th className="px-3 py-2.5 font-medium">Created</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((tour) => (
                  <tr key={tour.id} className="hover:bg-canvas/60">
                    <td className="px-5 py-3">
                      <p className="font-medium">{tour.title}</p>
                      <p className="text-xs text-muted">{tour.hospital}</p>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={tour.status} />
                    </td>
                    <td className="px-3 py-3 text-xs text-muted">
                      <span className="font-medium text-ink tabular-nums">{tour.file_count}</span>
                      {tour.file_count > 0 && ` (${tour.scan_points} 360, ${tour.models} 3D)`}
                      {tour.failed_files > 0 && <span className="ml-1 text-bad">{tour.failed_files} failed</span>}
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-muted">{formatBytes(tour.size_bytes)}</td>
                    <td className="px-3 py-3 text-xs text-muted">{formatDate(tour.created_at)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => manageFiles(tour)}>
                          Files
                        </Button>
                        <Button size="sm" variant="secondary" loading={busyId === tour.id && !toDelete} onClick={() => togglePublished(tour)}>
                          {tour.status === "published" ? "Unpublish" : "Publish"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setForm({ open: true, tour })}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" className="text-bad!" onClick={() => setToDelete(tour)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <TourFormDialog open={form.open} tour={form.tour} onClose={() => setForm({ open: false, tour: null })} />
      <ConfirmDialog
        open={toDelete !== null}
        title="Delete tour?"
        message={
          <>
            <strong className="text-ink">
              {toDelete?.hospital} / {toDelete?.title}
            </strong>{" "}
            and its {toDelete?.file_count ?? 0} file{toDelete?.file_count === 1 ? "" : "s"} will be removed from the database
            and storage. This cannot be undone.
          </>
        }
        busy={busyId === toDelete?.id}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </>
  );
}
