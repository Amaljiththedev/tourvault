import type { AssetStatus, TourStatus } from "@/lib/types";

const styles: Record<AssetStatus | TourStatus, string> = {
  ready: "bg-ok-bg text-ok",
  published: "bg-ok-bg text-ok",
  failed: "bg-bad-bg text-bad",
  processing: "bg-info-bg text-info",
  uploaded: "bg-warn-bg text-warn",
  draft: "bg-sunken text-muted",
};

const labels: Record<AssetStatus | TourStatus, string> = {
  ready: "Ready",
  published: "Published",
  failed: "Failed",
  processing: "Processing",
  uploaded: "Queued",
  draft: "Draft",
};

export default function StatusBadge({ status }: { status: AssetStatus | TourStatus }) {
  const busy = status === "processing" || status === "uploaded";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      <span className={`size-1.5 rounded-full bg-current ${busy ? "animate-pulse" : ""}`} />
      {labels[status]}
    </span>
  );
}
