"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import TourDetail from "@/components/TourDetail";
import TourFormDialog from "@/components/TourFormDialog";
import TourSidebar from "@/components/TourSidebar";
import { Alert, Button, Card, FullScreenLoader } from "@/components/ui";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearTourError, fetchTours } from "@/store/toursSlice";
import { viewAsset } from "@/store/assetsSlice";

export default function ToursPage() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const status = useAppSelector((s) => s.auth.status);
  const isAdmin = useAppSelector((s) => s.auth.user?.role === "admin");
  const { items, selectedId, error, loaded } = useAppSelector((s) => s.tours);
  const selected = items.find((t) => t.id === selectedId) ?? null;
  const [form, setForm] = useState<{ open: boolean; editing: boolean }>({ open: false, editing: false });

  // Client-side guard for navigation only. The API refuses every request
  // without a valid token, which is the real protection.
  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
    if (status === "authenticated") dispatch(fetchTours());
  }, [status, router, dispatch]);

  // Switching tour closes the model from the previous one.
  useEffect(() => {
    dispatch(viewAsset(null));
  }, [selectedId, dispatch]);

  if (status !== "authenticated") return <FullScreenLoader />;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[320px_1fr]">
        <TourSidebar onNewTour={() => setForm({ open: true, editing: false })} />

        <main className="min-w-0 space-y-4">
          {error && !form.open && <Alert onClose={() => dispatch(clearTourError())}>{error}</Alert>}

          {selected ? (
            <TourDetail tour={selected} onEdit={() => setForm({ open: true, editing: true })} />
          ) : (
            loaded && (
              <Card className="grid place-items-center px-6 py-20 text-center">
                <div className="max-w-sm space-y-3">
                  <h1 className="text-xl font-semibold tracking-tight">No tour selected</h1>
                  <p className="text-sm text-muted">
                    {isAdmin
                      ? "Create a tour for a hospital, then upload its 3D models and scans."
                      : "There are no tours to show yet. Ask an admin to add one."}
                  </p>
                  {isAdmin && <Button onClick={() => setForm({ open: true, editing: false })}>Create a tour</Button>}
                </div>
              </Card>
            )
          )}
        </main>
      </div>

      <TourFormDialog
        open={form.open}
        tour={form.editing ? selected : null}
        onClose={() => setForm({ open: false, editing: false })}
      />
    </div>
  );
}
