"use client";

import { useState } from "react";
import type { Tour, TourInput, TourStatus } from "@/lib/types";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearTourError, createTour, updateTour } from "@/store/toursSlice";
import { Dialog } from "./Dialog";
import { Alert, Button, Field, Input, Select } from "./ui";

// One form for both "new tour" and "edit tour". When editing, the tour's
// version is sent back so the server can refuse a stale save (409).
export default function TourFormDialog({
  open,
  tour,
  onClose,
}: {
  open: boolean;
  tour: Tour | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={tour ? "Edit tour" : "New tour"}>
      {/* Keyed so the form resets each time it opens for a different tour. */}
      {open && <TourForm key={tour?.id ?? "new"} tour={tour} onDone={onClose} />}
    </Dialog>
  );
}

function TourForm({ tour, onDone }: { tour: Tour | null; onDone: () => void }) {
  const dispatch = useAppDispatch();
  const { saving, error } = useAppSelector((s) => s.tours);
  const [form, setForm] = useState<TourInput>({
    hospital: tour?.hospital ?? "",
    title: tour?.title ?? "",
    status: tour?.status ?? "draft",
  });
  const [touched, setTouched] = useState(false);

  const hospitalError = touched && !form.hospital.trim() ? "Hospital is required" : null;
  const titleError = touched && !form.title.trim() ? "Title is required" : null;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!form.hospital.trim() || !form.title.trim()) return;
    const input = { ...form, hospital: form.hospital.trim(), title: form.title.trim() };
    const result = tour
      ? await dispatch(updateTour({ id: tour.id, input, version: tour.version }))
      : await dispatch(createTour(input));
    if (result.meta.requestStatus === "fulfilled") onDone();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert onClose={() => dispatch(clearTourError())}>{error}</Alert>}
      <Field label="Hospital" error={hospitalError}>
        {(id) => (
          <Input
            id={id}
            value={form.hospital}
            maxLength={255}
            placeholder="e.g. Alder Hey"
            onChange={(e) => setForm({ ...form, hospital: e.target.value })}
            aria-invalid={!!hospitalError}
            autoFocus
          />
        )}
      </Field>
      <Field label="Title" error={titleError}>
        {(id) => (
          <Input
            id={id}
            value={form.title}
            maxLength={255}
            placeholder="e.g. Main entrance"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            aria-invalid={!!titleError}
          />
        )}
      </Field>
      <Field label="Status" hint="Published tours are visible to everyone.">
        {(id) => (
          <Select
            id={id}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as TourStatus })}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </Select>
        )}
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            dispatch(clearTourError());
            onDone();
          }}
        >
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {tour ? "Save changes" : "Create tour"}
        </Button>
      </div>
    </form>
  );
}
