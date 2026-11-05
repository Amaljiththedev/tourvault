"use client";

import { useEffect, useState } from "react";
import ActivityList from "@/components/ActivityList";
import { PageTitle, useAdminReady } from "@/components/AdminShell";
import { Alert, Button, Card, Select, Spinner } from "@/components/ui";
import type { ActivityEntry } from "@/lib/types";
import { clearAdminError, fetchActivity } from "@/store/adminSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

export default function AdminActivityPage() {
  const dispatch = useAppDispatch();
  const { activity, loading, error } = useAppSelector((s) => s.admin);
  const [action, setAction] = useState<"all" | ActivityEntry["action"]>("all");

  const ready = useAdminReady();
  useEffect(() => {
    if (ready) dispatch(fetchActivity());
  }, [ready, dispatch]);

  const shown = action === "all" ? activity : activity.filter((e) => e.action === action);

  return (
    <>
      <PageTitle
        title="Activity"
        subtitle="Every tour an admin created, edited or deleted, newest first. Written in the same transaction as the change."
        actions={
          <Button variant="secondary" loading={loading.activity} onClick={() => dispatch(fetchActivity())}>
            Refresh
          </Button>
        }
      />
      {error && <Alert onClose={() => dispatch(clearAdminError())}>{error}</Alert>}
      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <Select value={action} onChange={(e) => setAction(e.target.value as typeof action)} className="h-9 w-40" aria-label="Filter by action">
            <option value="all">All actions</option>
            <option value="create">Created</option>
            <option value="update">Updated</option>
            <option value="delete">Deleted</option>
          </Select>
          <span className="text-xs text-muted">Last {activity.length} entries</span>
        </div>
        {loading.activity && !activity.length ? (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted">
            <Spinner className="size-4" /> Loading...
          </div>
        ) : (
          <ActivityList entries={shown} />
        )}
      </Card>
    </>
  );
}
