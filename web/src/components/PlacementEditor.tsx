"use client";

import { useState } from "react";
import type { Asset } from "@/lib/types";
import { setPlacement } from "@/store/assetsSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { Button, Card, Input } from "./ui";

const EMPTY: Asset[] = [];

// Where each 360 scan point of a tour sits. Points with a position appear on
// the map and link up in the viewer (floor circles); this is where an admin
// fixes or adds positions for scans that came without a point.json.
export default function PlacementEditor({ tourId }: { tourId: number }) {
  const assets = useAppSelector((s) => s.assets.byTour[tourId] ?? EMPTY);
  const points = assets.filter((a) => a.kind === "panorama" && a.status === "ready");

  return (
    <Card>
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-semibold">Scan point placement</h2>
        <p className="text-xs text-muted">
          Points with a position link up in the viewer: visitors see a circle on the floor for each nearby point and can walk
          to it.
        </p>
      </div>
      {!points.length ? (
        <p className="px-5 py-8 text-center text-sm text-muted">This tour has no ready 360 scan points yet.</p>
      ) : (
        <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-faint">
                <tr>
                  <th className="py-2 pr-3 font-medium">Point</th>
                  <th className="px-1 py-2 font-medium">x</th>
                  <th className="px-1 py-2 font-medium">y</th>
                  <th className="px-1 py-2 font-medium">z</th>
                  <th className="px-1 py-2 font-medium">Heading</th>
                  <th className="py-2 pl-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {points.map((p, i) => (
                  // Keyed on the saved values, so the inputs reset after a save.
                  <PlacementRow key={`${p.id}:${p.position?.join(",")}:${p.heading}`} asset={p} index={i} />
                ))}
              </tbody>
            </table>
          </div>
          <PointMap points={points} />
        </div>
      )}
    </Card>
  );
}

const round = (n: number | null | undefined) => (n == null ? "" : String(Math.round(n * 1000) / 1000));

function PlacementRow({ asset, index }: { asset: Asset; index: number }) {
  const dispatch = useAppDispatch();
  const [values, setValues] = useState([...[0, 1, 2].map((i) => round(asset.position?.[i])), round(asset.heading)]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const original = [...[0, 1, 2].map((i) => round(asset.position?.[i])), round(asset.heading)];
  const dirty = values.some((v, i) => v.trim() !== original[i]);
  const nums = values.map((v) => (v.trim() ? Number(v) : null));
  const xyz = nums.slice(0, 3);
  const valid =
    nums.every((n) => n === null || Number.isFinite(n)) && (xyz.every((n) => n === null) || xyz.every((n) => n !== null));

  async function save(clear = false) {
    setSaving(true);
    setError(null);
    const position = clear || xyz.some((n) => n === null) ? null : (xyz as [number, number, number]);
    const result = await dispatch(setPlacement({ id: asset.id, position, heading: clear ? null : nums[3] }));
    if (setPlacement.rejected.match(result)) setError(result.payload?.message ?? "Could not save");
    setSaving(false);
  }

  return (
    <tr>
      <td className="py-2 pr-3">
        <p className="flex items-center gap-2 font-medium">
          <span className="grid size-5 place-items-center rounded-full bg-night text-[10px] text-white">{index + 1}</span>
          <span className="max-w-[12rem] truncate">{asset.filename}</span>
        </p>
        {error && <p className="mt-0.5 text-xs text-bad">{error}</p>}
        {!valid && <p className="mt-0.5 text-xs text-bad">Numbers only; x, y and z together</p>}
      </td>
      {values.map((v, i) => (
        <td key={i} className="px-1 py-2">
          <Input
            value={v}
            inputMode="decimal"
            className="h-8 w-20 px-2 tabular-nums"
            aria-label={`${["x", "y", "z", "Heading"][i]} for ${asset.filename}`}
            onChange={(e) => setValues(values.map((old, j) => (j === i ? e.target.value : old)))}
          />
        </td>
      ))}
      <td className="py-2 pl-2">
        <div className="flex justify-end gap-1">
          <Button size="sm" onClick={() => save()} disabled={!dirty || !valid} loading={saving}>
            Save
          </Button>
          {(asset.position || asset.heading != null) && (
            <Button size="sm" variant="ghost" onClick={() => save(true)} disabled={saving}>
              Clear
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// Top-down view: +x to the right, +z towards the bottom. The tick on each dot
// shows where that point's front face looks once its heading is applied.
function PointMap({ points }: { points: Asset[] }) {
  const placed = points.map((p, i) => ({ p, i })).filter(({ p }) => p.position);
  if (!placed.length) {
    return (
      <div className="grid place-items-center rounded-lg bg-canvas p-6 text-center text-xs text-muted">
        No point has a position yet, so there is nothing to map.
      </div>
    );
  }
  const xs = placed.map(({ p }) => p.position![0]);
  const zs = placed.map(({ p }) => p.position![2]);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const span = Math.max(maxX - minX, maxZ - minZ, 2);
  const size = 260;
  const pad = 30;
  const scale = (size - pad * 2) / span;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const at = (x: number, z: number) => [size / 2 + (x - cx) * scale, size / 2 + (z - cz) * scale];
  const metre = Math.max(1, Math.round(span / 4));

  return (
    <figure className="rounded-lg bg-night p-2">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full" role="img" aria-label="Map of placed scan points, seen from above">
        {placed.map(({ p, i }) => {
          const [x, y] = at(p.position![0], p.position![2]);
          const h = ((p.heading ?? 0) * Math.PI) / 180;
          // The front face looks along -z, turned by the heading.
          const [dx, dy] = [-Math.sin(h) * 16, -Math.cos(h) * 16];
          return (
            <g key={p.id}>
              <line x1={x} y1={y} x2={x + dx} y2={y + dy} stroke="#7fd8c6" strokeWidth="2" strokeLinecap="round" />
              <circle cx={x} cy={y} r="9" fill="#14a38b" stroke="white" strokeWidth="1.5" />
              <text x={x} y={y + 3.5} textAnchor="middle" fontSize="10" fontWeight="600" fill="white">
                {i + 1}
              </text>
            </g>
          );
        })}
        <g transform={`translate(${pad - 10} ${size - 12})`}>
          <line x1="0" y1="0" x2={metre * scale} y2="0" stroke="white" strokeOpacity="0.6" strokeWidth="2" />
          <text x={metre * scale + 6} y="4" fontSize="10" fill="white" fillOpacity="0.6">
            {metre} m
          </text>
        </g>
      </svg>
      <figcaption className="px-1 pb-1 text-[11px] text-white/50">Seen from above. The line shows where each point&apos;s front face looks.</figcaption>
    </figure>
  );
}
