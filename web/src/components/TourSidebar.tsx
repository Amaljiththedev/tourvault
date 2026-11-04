"use client";

import { useMemo, useState } from "react";
import type { TourStatus } from "@/lib/types";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { selectTour } from "@/store/toursSlice";
import StatusBadge from "./StatusBadge";
import { Button, Card, Input, Spinner } from "./ui";

type Filter = "all" | TourStatus;

export default function TourSidebar({ onNewTour }: { onNewTour: () => void }) {
  const dispatch = useAppDispatch();
  const { items, loading, loaded, selectedId } = useAppSelector((s) => s.tours);
  const isAdmin = useAppSelector((s) => s.auth.user?.role === "admin");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (t) =>
        (filter === "all" || t.status === filter) &&
        (!q || t.title.toLowerCase().includes(q) || t.hospital.toLowerCase().includes(q)),
    );
  }, [items, query, filter]);

  return (
    <Card className="flex max-h-[calc(100vh-7rem)] flex-col lg:sticky lg:top-22">
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            Tours <span className="ml-1 text-sm font-normal text-faint">{items.length}</span>
          </h2>
          {isAdmin && (
            <Button size="sm" onClick={onNewTour}>
              <span aria-hidden="true">+</span> New tour
            </Button>
          )}
        </div>
        <Input
          type="search"
          placeholder="Search tours or hospitals"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search tours"
        />
        <div className="flex gap-1 rounded-lg bg-sunken p-1 text-xs font-medium" role="tablist">
          {(["all", "published", "draft"] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`flex-1 rounded-md px-2 py-1.5 capitalize transition-colors ${
                filter === f ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <ul className="flex-1 overflow-y-auto p-2">
        {loading && !loaded && (
          <li className="flex items-center gap-2 p-4 text-sm text-muted">
            <Spinner className="size-4" /> Loading tours...
          </li>
        )}
        {loaded && !visible.length && (
          <li className="p-6 text-center text-sm text-muted">
            {items.length ? "No tours match your search." : isAdmin ? "No tours yet. Create the first one." : "No tours yet."}
          </li>
        )}
        {visible.map((tour) => {
          const active = tour.id === selectedId;
          return (
            <li key={tour.id}>
              <button
                onClick={() => dispatch(selectTour(tour.id))}
                aria-current={active}
                className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                  active ? "bg-brand-50 ring-1 ring-brand-100" : "hover:bg-sunken"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`truncate text-sm font-medium ${active ? "text-brand-700" : ""}`}>{tour.title}</span>
                  <StatusBadge status={tour.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-muted">{tour.hospital}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
