import type { ActivityEntry } from "@/lib/types";

const VERB = { create: "created", update: "updated", delete: "deleted" } as const;
const DOT = { create: "bg-ok", update: "bg-info", delete: "bg-bad" } as const;

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  if (!entries.length) return <p className="px-5 py-8 text-center text-sm text-muted">No activity yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {entries.map((e) => (
        <li key={e.id} className="flex items-start gap-3 px-5 py-3">
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[e.action]}`} aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate">
              <span className="font-medium">{e.user_email}</span> {VERB[e.action]}{" "}
              {e.tour_title ? (
                <span className="font-medium">
                  {e.tour_hospital} / {e.tour_title}
                </span>
              ) : (
                <span className="text-muted">tour #{e.tour_id} (since deleted)</span>
              )}
            </p>
          </div>
          <time dateTime={e.created_at} className="shrink-0 text-xs tabular-nums text-faint">
            {formatWhen(e.created_at)}
          </time>
        </li>
      ))}
    </ul>
  );
}
