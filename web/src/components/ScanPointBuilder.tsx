"use client";

import { useEffect, useRef, useState } from "react";
import type { CubeFace } from "@/lib/types";
import { zipStore } from "@/lib/zip";
import { uploadAsset } from "@/store/assetsSlice";
import { useAppDispatch } from "@/store/hooks";
import { Alert, Button, Card, Field, Input } from "./ui";

// Builds a 360 scan point in the browser: six cube-face images (as a capture
// platform such as Matterport serves them) plus an optional placement, zipped
// into the exact format POST /tours/{id}/assets accepts. The server checks
// everything again, so these checks are only for quick feedback.

interface Face {
  file: File;
  url: string; // object URL for the preview
  size: number; // width in pixels (faces must be square)
  square: boolean;
}

const MATTERPORT: Record<string, CubeFace> = { "0": "up", "1": "front", "2": "right", "3": "back", "4": "left", "5": "down" };
const NAMES: Record<string, CubeFace> = {
  front: "front", back: "back", left: "left", right: "right", up: "up", top: "up", down: "down", bottom: "down",
};
const IMAGE = /\.(jpe?g|png)$/i;

// Where each face sits in the cube's unfolded net (4 columns x 3 rows).
const NET: { face: CubeFace; col: number; row: number }[] = [
  { face: "up", col: 2, row: 1 },
  { face: "left", col: 1, row: 2 },
  { face: "front", col: 2, row: 2 },
  { face: "right", col: 3, row: 2 },
  { face: "back", col: 4, row: 2 },
  { face: "down", col: 2, row: 3 },
];

// "face1.jpg", "point3_face1.jpg", "Front.png", "atrium-top.jpg" ...
export function faceFromName(filename: string): CubeFace | null {
  const stem = filename.replace(/\.[^.]+$/, "").toLowerCase();
  const numbered = stem.match(/(?:^|[^a-z0-9])face([0-5])$/) ?? stem.match(/^face([0-5])$/);
  if (numbered) return MATTERPORT[numbered[1]];
  const named = stem.match(/(?:^|[^a-z])(front|back|left|right|up|top|down|bottom)$/);
  return named ? NAMES[named[1]] : null;
}

async function readFace(file: File): Promise<Face> {
  const bitmap = await createImageBitmap(file);
  const face = { file, url: URL.createObjectURL(file), size: bitmap.width, square: bitmap.width === bitmap.height };
  bitmap.close();
  return face;
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

export default function ScanPointBuilder({ tourId, nextNumber }: { tourId: number; nextNumber: number }) {
  const dispatch = useAppDispatch();
  const [faces, setFaces] = useState<Partial<Record<CubeFace, Face>>>({});
  const [name, setName] = useState("");
  const [position, setPosition] = useState(["", "", ""]);
  const [heading, setHeading] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLInputElement>(null);
  const slotFace = useRef<CubeFace | null>(null);
  const facesRef = useRef(faces);

  useEffect(() => {
    facesRef.current = faces;
  });
  // Free the preview images when leaving the page.
  useEffect(() => () => Object.values(facesRef.current).forEach((f) => f && URL.revokeObjectURL(f.url)), []);

  async function place(entries: [CubeFace, File][]) {
    const loaded = await Promise.all(
      entries.map(async ([face, file]) => [face, await readFace(file).catch(() => null)] as const),
    );
    const unreadable = loaded.filter(([, f]) => !f).map(([face]) => face);
    setFaces((current) => {
      const next = { ...current };
      for (const [face, f] of loaded) {
        if (!f) continue;
        if (next[face]) URL.revokeObjectURL(next[face]!.url);
        next[face] = f;
      }
      return next;
    });
    if (unreadable.length) setProblem(`Could not read the image for: ${unreadable.join(", ")}`);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    setProblem(null);
    setDone(null);
    const files = Array.from(list).filter((f) => IMAGE.test(f.name));
    const matched: [CubeFace, File][] = [];
    const unknown: string[] = [];
    for (const file of files) {
      const face = faceFromName(file.name);
      if (face) matched.push([face, file]);
      else unknown.push(file.name);
    }
    if (unknown.length) {
      setProblem(
        `Could not tell which face ${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"}. ` +
          "Name files face0 to face5 (Matterport order) or front/back/left/right/up/down, or drop each one on its square.",
      );
    }
    if (matched.length) place(matched);
  }

  function pickFor(face: CubeFace) {
    slotFace.current = face;
    slotRef.current?.click();
  }

  function clearAll() {
    Object.values(faces).forEach((f) => f && URL.revokeObjectURL(f.url));
    setFaces({});
    setName("");
    setPosition(["", "", ""]);
    setHeading("");
    setProblem(null);
  }

  const present = NET.map((n) => n.face).filter((f) => faces[f]);
  const sizes = new Set(present.map((f) => faces[f]!.size));
  const notSquare = present.filter((f) => !faces[f]!.square);
  const coords = position.map(parseNumber);
  const headingValue = parseNumber(heading);
  const placed = coords.every((c) => c !== null);
  const partlyPlaced = !placed && coords.some((c) => c !== null);
  const badNumber = coords.some((c) => Number.isNaN(c)) || Number.isNaN(headingValue);

  const blockers = [
    present.length < 6 && `${6 - present.length} face${present.length === 5 ? "" : "s"} still missing`,
    notSquare.length > 0 && `Not square: ${notSquare.join(", ")}`,
    sizes.size > 1 && "All six faces must be the same size",
    partlyPlaced && "Fill in all of x, y and z, or leave them all empty",
    badNumber && "Position and heading must be numbers",
  ].filter(Boolean) as string[];

  async function build() {
    if (blockers.length) return;
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      const entries = await Promise.all(
        NET.map(async ({ face }) => {
          const file = faces[face]!.file;
          const ext = file.name.toLowerCase().endsWith(".png") ? ".png" : ".jpg";
          return { name: `${face}${ext}`, data: new Uint8Array(await file.arrayBuffer()) };
        }),
      );
      if (placed || headingValue !== null) {
        const point = { position: placed ? coords : null, heading: headingValue };
        entries.push({ name: "point.json", data: new TextEncoder().encode(JSON.stringify(point, null, 2)) });
      }
      const label = (name.trim() || `scan-point-${nextNumber}`).replace(/[^\w.-]+/g, "-").replace(/\.zip$/i, "");
      const file = new File([zipStore(entries)], `${label}.zip`, { type: "application/zip" });
      const result = await dispatch(uploadAsset({ tourId, file }));
      if (uploadAsset.fulfilled.match(result)) {
        clearAll();
        setDone(`${file.name} uploaded. It appears in the file list below once processing finishes.`);
      } else {
        setProblem(result.payload?.message ?? "Upload failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div id="scan-point" className="scroll-mt-24 border-b border-line px-5 py-4">
        <h2 className="font-semibold">Build a 360 scan point</h2>
        <p className="text-xs text-muted">
          Six square images, one per side of a cube around the camera, the way Matterport and similar platforms deliver each
          scan point. Nothing is converted: the images are stored and shown as they are.
        </p>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`rounded-lg border-2 border-dashed p-4 transition-colors ${over ? "border-brand-500 bg-brand-50" : "border-line bg-canvas"}`}
        >
          <div className="mx-auto grid max-w-[440px] grid-cols-4 grid-rows-3 gap-1.5">
            {NET.map(({ face, col, row }) => {
              const f = faces[face];
              return (
                <button
                  key={face}
                  type="button"
                  style={{ gridColumn: col, gridRow: row, backgroundImage: f ? `url(${f.url})` : undefined }}
                  onClick={() => pickFor(face)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOver(false);
                    const file = Array.from(e.dataTransfer.files).find((x) => IMAGE.test(x.name));
                    if (file) place([[face, file]]);
                  }}
                  className={`group relative aspect-square overflow-hidden rounded-md border bg-cover bg-center text-xs font-medium capitalize ${
                    f ? (f.square ? "border-transparent" : "border-bad") : "border-line bg-surface text-faint hover:border-brand-500 hover:text-brand-700"
                  }`}
                  aria-label={f ? `${face}: ${f.file.name}. Click to replace` : `Choose the ${face} image`}
                >
                  <span className={`absolute inset-x-0 bottom-0 px-1 py-0.5 ${f ? "bg-night/60 text-white" : ""}`}>{face}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-center text-sm">
            <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => pickRef.current?.click()}>
              Choose all six images
            </button>{" "}
            or drop them here. Click a square to set one face.
          </p>
          <p className="mt-1 text-center text-xs text-faint">
            Names: face0 to face5 (0 up, 1 front, 2 right, 3 back, 4 left, 5 down) or front/back/left/right/up/down. JPG or PNG.
          </p>
          <input ref={pickRef} type="file" accept=".jpg,.jpeg,.png" multiple className="sr-only" aria-label="Choose face images" onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }} />
          <input ref={slotRef} type="file" accept=".jpg,.jpeg,.png" className="sr-only" aria-label="Choose one face image" onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && slotFace.current) place([[slotFace.current, file]]);
            e.target.value = "";
          }} />
        </div>

        <div className="space-y-4">
          <Field label="Name" hint={`Saved as ${(name.trim() || `scan-point-${nextNumber}`).replace(/\.zip$/i, "")}.zip`}>
            {(id) => <Input id={id} value={name} placeholder={`scan-point-${nextNumber}`} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Position (optional)</legend>
            <div className="grid grid-cols-3 gap-2">
              {["x", "y", "z"].map((axis, i) => (
                <Input
                  key={axis}
                  inputMode="decimal"
                  placeholder={axis}
                  aria-label={`Position ${axis} in metres`}
                  value={position[i]}
                  onChange={(e) => setPosition(position.map((v, j) => (j === i ? e.target.value : v)))}
                />
              ))}
            </div>
            <p className="text-xs text-faint">Metres, y up. Placed points link up so visitors can walk between them.</p>
          </fieldset>
          <Field label="Heading (optional)" hint="Degrees the cube is turned, counter-clockwise from above. Matterport: rotation.y minus 180.">
            {(id) => <Input id={id} inputMode="decimal" placeholder="0" value={heading} onChange={(e) => setHeading(e.target.value)} />}
          </Field>
        </div>
      </div>

      <div className="space-y-3 border-t border-line px-5 py-4">
        {problem && <Alert onClose={() => setProblem(null)}>{problem}</Alert>}
        {done && (
          <Alert tone="ok" onClose={() => setDone(null)}>
            {done}
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {blockers.length ? blockers.join(" · ") : `Ready: six ${[...sizes][0]}px faces${placed ? ", placed" : ""}.`}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={clearAll} disabled={busy || (!present.length && !name && !heading)}>
              Clear
            </Button>
            <Button onClick={build} loading={busy} disabled={blockers.length > 0}>
              Upload scan point
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
