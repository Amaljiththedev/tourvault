"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PageTitle, useAdminReady } from "@/components/AdminShell";
import AssetPanel from "@/components/AssetPanel";
import PlacementEditor from "@/components/PlacementEditor";
import ScanPointBuilder from "@/components/ScanPointBuilder";
import { Card, Field, Select, Spinner } from "@/components/ui";
import type { Asset } from "@/lib/types";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchTours, selectTour } from "@/store/toursSlice";

const EMPTY: Asset[] = [];

export default function AdminUploadPage() {
  const dispatch = useAppDispatch();
  const { items, selectedId, loaded } = useAppSelector((s) => s.tours);
  const assets = useAppSelector((s) => (selectedId === null ? EMPTY : s.assets.byTour[selectedId] ?? EMPTY));
  const tour = items.find((t) => t.id === selectedId) ?? null;

  const ready = useAdminReady();
  useEffect(() => {
    if (ready) dispatch(fetchTours());
  }, [ready, dispatch]);

  return (
    <>
      <PageTitle
        title="Uploads & scan points"
        subtitle="Add 3D models and 360 scan points to a tour, and place scan points so visitors can walk between them."
        actions={
          tour && (
            <Link
              href="/tours"
              className="inline-flex h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-sunken"
            >
              Open in viewer
            </Link>
          )
        }
      />

      {!loaded ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="size-4" /> Loading tours...
        </div>
      ) : !items.length ? (
        <Card className="p-8 text-center text-sm text-muted">
          There are no tours yet.{" "}
          <Link href="/admin/tours" className="font-medium text-brand-700 hover:underline">
            Create a tour
          </Link>{" "}
          first, then upload to it.
        </Card>
      ) : (
        <>
          <Card className="p-5">
            <Field label="Tour" hint="Everything below applies to this tour.">
              {(id) => (
                <Select
                  id={id}
                  value={selectedId ?? ""}
                  onChange={(e) => dispatch(selectTour(Number(e.target.value)))}
                  className="max-w-md"
                >
                  {items.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.hospital} / {t.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </Card>

          {tour && (
            <>
              <ScanPointBuilder
                key={tour.id}
                tourId={tour.id}
                nextNumber={assets.filter((a) => a.kind === "panorama").length + 1}
              />
              <AssetPanel tourId={tour.id} />
              <PlacementEditor tourId={tour.id} />
            </>
          )}
        </>
      )}
    </>
  );
}
