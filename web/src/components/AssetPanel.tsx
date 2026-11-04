"use client";

import { useEffect, useRef, useState } from "react";
import { formatBytes, formatDate } from "@/lib/format";
import type { Asset } from "@/lib/types";
import {
  clearAssetError,
  deleteAsset,
  dismissUpload,
  fetchAssets,
  isUnfinished,
  reprocessAsset,
  uploadAsset,
  viewAsset,
} from "@/store/assetsSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { ConfirmDialog } from "./Dialog";
import StatusBadge from "./StatusBadge";
import { Alert, Button, Card, Spinner } from "./ui";

const POLL_MS = 1500;
const EMPTY: Asset[] = [];

export default function AssetPanel({ tourId }: { tourId: number }) {
  const dispatch = useAppDispatch();
  const assets = useAppSelector((s) => s.assets.byTour[tourId] ?? EMPTY);
  const loading = useAppSelector((s) => s.assets.loading[tourId] ?? false);
  // Select the whole array and filter here: filtering inside the selector
  // would return a new array every time and re-render on every action.
  const allUploads = useAppSelector((s) => s.assets.uploads);
  const uploads = allUploads.filter((u) => u.tourId === tourId);
  const viewingId = useAppSelector((s) => s.assets.viewingId);
  const error = useAppSelector((s) => s.assets.error);
  const isAdmin = useAppSelector((s) => s.auth.user?.role === "admin");
  const [toDelete, setToDelete] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    dispatch(fetchAssets(tourId));
  }, [dispatch, tourId]);

  // Processing runs on the server after the upload returns. While any file is
  // still queued or processing, poll until it settles.
  const pending = assets.some(isUnfinished);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => dispatch(fetchAssets(tourId)), POLL_MS);
    return () => window.clearInterval(timer);
  }, [pending, dispatch, tourId]);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    await dispatch(deleteAsset(toDelete));
    setDeleting(false);
    setToDelete(null);
  }

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h3 className="font-semibold">3D files</h3>
          <p className="text-xs text-muted">GLB models and PLY scans for this tour</p>
        </div>
        {pending && (
          <span className="flex items-center gap-2 text-xs text-info">
            <Spinner className="size-3.5" /> Processing
          </span>
        )}
      </div>

      <div className="space-y-4 p-5">
        {error && <Alert onClose={() => dispatch(clearAssetError())}>{error}</Alert>}

        {isAdmin && <Dropzone tourId={tourId} />}

        {uploads.map((job) => (
          <div key={job.id} className="rounded-lg border border-line p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-medium">{job.filename}</span>
              {job.error ? (
                <button className="text-xs text-muted hover:text-ink" onClick={() => dispatch(dismissUpload(job.id))}>
                  Dismiss
                </button>
              ) : (
                <span className="text-xs tabular-nums text-muted">{Math.round(job.progress * 100)}%</span>
              )}
            </div>
            {job.error ? (
              <p className="mt-1 text-xs text-bad">{job.error}</p>
            ) : (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
                <div
                  className="tv-striped h-full rounded-full bg-brand-500 transition-[width]"
                  style={{ width: `${Math.max(job.progress * 100, 3)}%` }}
                />
              </div>
            )}
          </div>
        ))}

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted">
            <Spinner className="size-4" /> Loading files...
          </div>
        ) : !assets.length && !uploads.length ? (
          <p className="py-6 text-center text-sm text-muted">
            {isAdmin ? "No files yet. Upload a .glb or .ply file above." : "No 3D files have been added to this tour yet."}
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {assets.map((asset) => {
              const ready = asset.status === "ready";
              const active = viewingId === asset.id;
              return (
                <li key={asset.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${active ? "bg-brand-50" : ""}`}>
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-lg text-[10px] font-bold uppercase ${
                      asset.filename.toLowerCase().endsWith(".glb") ? "bg-info-bg text-info" : "bg-brand-50 text-brand-700"
                    }`}
                  >
                    {asset.filename.split(".").pop()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{asset.filename}</p>
                    <p className="text-xs text-muted">
                      {formatBytes(asset.size_bytes)}
                      {asset.vertex_count != null && ` · ${asset.vertex_count.toLocaleString()} vertices`}
                      {` · ${formatDate(asset.created_at)}`}
                    </p>
                    {asset.error && <p className="mt-0.5 text-xs text-bad">{asset.error}</p>}
                  </div>
                  <StatusBadge status={asset.status} />
                  <div className="flex gap-1.5">
                    <Button size="sm" variant={active ? "primary" : "secondary"} disabled={!ready} onClick={() => dispatch(viewAsset(asset.id))}>
                      {active ? "Viewing" : "View"}
                    </Button>
                    {isAdmin && asset.status === "failed" && (
                      <Button size="sm" variant="secondary" onClick={() => dispatch(reprocessAsset(asset.id))}>
                        Retry
                      </Button>
                    )}
                    {isAdmin && (
                      <Button size="sm" variant="ghost" aria-label={`Delete ${asset.filename}`} onClick={() => setToDelete(asset)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete file?"
        message={
          <>
            <strong className="text-ink">{toDelete?.filename}</strong> will be removed from this tour and from storage.
          </>
        }
        busy={deleting}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </Card>
  );
}

function Dropzone({ tourId }: { tourId: number }) {
  const dispatch = useAppDispatch();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function send(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) dispatch(uploadAsset({ tourId, file }));
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        send(e.dataTransfer.files);
      }}
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors ${
        over ? "border-brand-500 bg-brand-50" : "border-line bg-canvas"
      }`}
    >
      <svg viewBox="0 0 24 24" className="size-7 text-brand-600" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-sm">
        <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => inputRef.current?.click()}>
          Choose files
        </button>{" "}
        or drag them here
      </p>
      <p className="text-xs text-faint">.glb or .ply, up to 200 MB each</p>
      <input
        ref={inputRef}
        type="file"
        accept=".glb,.ply"
        multiple
        className="sr-only"
        onChange={(e) => send(e.target.files)}
        aria-label="Upload 3D files"
      />
    </div>
  );
}
