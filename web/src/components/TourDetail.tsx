"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import type { Asset, Tour } from "@/lib/types";
import { viewAsset } from "@/store/assetsSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { deleteTour } from "@/store/toursSlice";
import AssetPanel from "./AssetPanel";
import { ConfirmDialog } from "./Dialog";
import StatusBadge from "./StatusBadge";
import { Button, Card, Spinner } from "./ui";

const EMPTY: Asset[] = [];

// three.js needs WebGL and `window`, so the viewer is only rendered in the browser.
const ModelViewer = dynamic(() => import("./ModelViewer"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[420px] place-items-center rounded-xl bg-night text-white/70 lg:h-[520px]">
      <Spinner />
    </div>
  ),
});

export default function TourDetail({ tour, onEdit }: { tour: Tour; onEdit: () => void }) {
  const dispatch = useAppDispatch();
  const isAdmin = useAppSelector((s) => s.auth.user?.role === "admin");
  const assets = useAppSelector((s) => s.assets.byTour[tour.id] ?? EMPTY);
  const viewingId = useAppSelector((s) => s.assets.viewingId);
  const viewing = assets.find((a) => a.id === viewingId) ?? null;
  // The 360 scan points you can move between, in upload order.
  const points = useMemo(() => assets.filter((a) => a.kind === "panorama" && a.status === "ready"), [assets]);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function onDelete() {
    setDeleting(true);
    await dispatch(deleteTour(tour.id));
    setDeleting(false);
    setConfirming(false);
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-brand-700">{tour.hospital}</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">{tour.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
              <StatusBadge status={tour.status} />
              {tour.created_at && <span>Created {formatDate(tour.created_at)}</span>}
              <span>Version {tour.version}</span>
            </div>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={onEdit}>
                Edit
              </Button>
              <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
                Delete
              </Button>
            </div>
          )}
        </div>
      </Card>

      <ModelViewer asset={viewing} points={points} onSelect={(id) => dispatch(viewAsset(id))} />

      <AssetPanel tourId={tour.id} />

      <ConfirmDialog
        open={confirming}
        title="Delete tour?"
        message={
          <>
            <strong className="text-ink">{tour.title}</strong> and all of its 3D files will be removed. This cannot be
            undone.
          </>
        }
        busy={deleting}
        onConfirm={onDelete}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
