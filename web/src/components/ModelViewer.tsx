"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { CUBE_FACES, type Asset, type CubeFace } from "@/lib/types";
import { getDownloadLinks } from "@/store/assetsSlice";
import { useAppDispatch } from "@/store/hooks";
import { Button, Spinner } from "./ui";

type Mode = "none" | "model" | "panorama";

interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  current: THREE.Object3D | null;
  home: { position: THREE.Vector3; target: THREE.Vector3 } | null;
  mode: Mode;
  hotspots: THREE.Group; // circles on the floor, one per nearby scan point
  fadeStart: number | null; // when the current panorama started fading in
}

// How far below the camera the floor is, in metres. Scan cameras sit at
// about this height; it only decides where the floor circles are drawn.
const EYE_HEIGHT = 1.5;
// Scan points further away than this are not shown as circles.
const MAX_HOTSPOT_DISTANCE = 25;
const FADE_MS = 250;
const CUBE_HALF = 10;

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.MeshBasicMaterial | THREE.MeshBasicMaterial[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      m.map?.dispose(); // panorama faces; GLB textures too
      m.dispose();
    }
  });
}

function replaceObject(view: Scene, object: THREE.Object3D) {
  if (view.current) {
    view.scene.remove(view.current);
    disposeObject(view.current);
  }
  view.current = object;
  view.scene.add(object);
}

function clearHotspots(view: Scene) {
  for (const child of [...view.hotspots.children]) {
    view.hotspots.remove(child);
    disposeObject(child);
  }
}

// For each cube face: the direction from the viewer to its centre, and which
// way is "up" in its image when you look at it from inside. Matterport's
// face0..face5 are mapped to these names on the server (app/panorama.py).
const FACE_LAYOUT: Record<CubeFace, { forward: [number, number, number]; up: [number, number, number] }> = {
  front: { forward: [0, 0, -1], up: [0, 1, 0] },
  right: { forward: [1, 0, 0], up: [0, 1, 0] },
  back: { forward: [0, 0, 1], up: [0, 1, 0] },
  left: { forward: [-1, 0, 0], up: [0, 1, 0] },
  up: { forward: [0, 1, 0], up: [0, 0, 1] },
  down: { forward: [0, -1, 0], up: [0, 0, -1] },
};

// Six squares facing inwards, one image each, exactly as the capture platform
// delivered them. Built by hand rather than with a CubeTexture so the
// orientation of every face is explicit.
async function buildCube(faces: Record<CubeFace, string>): Promise<THREE.Group> {
  const loader = new THREE.TextureLoader();
  const textures = await Promise.all(CUBE_FACES.map((face) => loader.loadAsync(faces[face])));
  const group = new THREE.Group();
  CUBE_FACES.forEach((face, i) => {
    const texture = textures[i];
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const forward = new THREE.Vector3(...FACE_LAYOUT[face].forward);
    const up = new THREE.Vector3(...FACE_LAYOUT[face].up);
    const right = new THREE.Vector3().crossVectors(forward, up);
    // A plane faces +Z with its image's right along +X and up along +Y. This
    // basis turns it so it faces the viewer at the centre.
    const plane = new THREE.Mesh(
      // Slightly oversized so no hairline gap shows along the cube's edges.
      new THREE.PlaneGeometry(CUBE_HALF * 2.002, CUBE_HALF * 2.002),
      new THREE.MeshBasicMaterial({ map: texture, depthWrite: false, transparent: true, opacity: 0 }),
    );
    plane.setRotationFromMatrix(new THREE.Matrix4().makeBasis(right, up, forward.clone().negate()));
    plane.position.copy(forward.multiplyScalar(CUBE_HALF));
    plane.name = face;
    group.add(plane);
  });
  return group;
}

// A flat ring on the floor where another scan point stands. It is drawn at
// its real offset from the camera, so nearer points look bigger, like
// footsteps; always on top of the cube, which is only a backdrop.
function makeHotspot(target: Asset, offset: THREE.Vector3, distance: number): THREE.Group {
  const group = new THREE.Group();
  group.userData.assetId = target.id;
  group.userData.label = target.filename;
  const scale = Math.max(1, distance / 6); // keep far points clickable
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.3 * scale, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthTest: false }),
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.24 * scale, 0.3 * scale, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }),
  );
  ring.name = "ring";
  for (const mesh of [disc, ring]) {
    mesh.rotation.x = -Math.PI / 2; // lie flat on the floor, facing up
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  group.position.copy(offset);
  return group;
}

// Orbit around a model: zoom and pan on, grid visible.
function showModel(view: Scene, object: THREE.Object3D) {
  replaceObject(view, object);
  clearHotspots(view);
  view.mode = "model";
  view.fadeStart = null;
  const { controls, camera } = view;
  controls.enableZoom = true;
  controls.enablePan = true;
  controls.rotateSpeed = 1;
  camera.fov = 50;

  // Centre the model, sit it on the grid, and back the camera off to fit it.
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const span = size.length() || 1;
  const centre = box.getCenter(new THREE.Vector3());
  const grid = view.scene.getObjectByName("grid");
  if (grid) {
    grid.visible = true;
    grid.position.set(centre.x, box.min.y, centre.z);
    grid.scale.setScalar(Math.max(span / 10, 0.1));
  }
  const position = centre.clone().add(new THREE.Vector3(span * 0.9, span * 0.6, span * 1.1));
  camera.near = span / 1000;
  camera.far = span * 100;
  camera.position.copy(position);
  camera.updateProjectionMatrix();
  controls.target.copy(centre);
  view.home = { position, target: centre };
}

// Stand inside a 360 scan point and look around. The camera sits a hair from
// the orbit target, and a negative rotate speed makes dragging feel like
// turning your head rather than spinning the room. Moving from one scan point
// to the next keeps the direction you are facing, because every cube is
// turned by its heading into the same world frame.
function showPanorama(view: Scene, cube: THREE.Object3D) {
  const wasPanorama = view.mode === "panorama";
  replaceObject(view, cube);
  view.mode = "panorama";
  view.fadeStart = performance.now();
  const { controls, camera } = view;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.rotateSpeed = -0.35;
  camera.fov = 75;
  camera.near = 0.01;
  camera.far = 200;
  const target = new THREE.Vector3(0, 0, 0);
  const position = new THREE.Vector3(0, 0, 0.01); // looking along -Z
  view.home = { position, target };
  if (!wasPanorama) {
    camera.position.copy(position);
    controls.target.copy(target);
  }
  camera.updateProjectionMatrix();
  const grid = view.scene.getObjectByName("grid");
  if (grid) grid.visible = false;
}

interface Props {
  asset: Asset | null;
  // The tour's ready 360 scan points, in order. Used for moving between them.
  points: Asset[];
  onSelect: (assetId: number) => void;
}

// Loaded only in the browser (see next/dynamic in TourDetail): WebGL has no
// server-side equivalent.
export default function ModelViewer({ asset, points, onSelect }: Props) {
  const dispatch = useAppDispatch();
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const pointsRef = useRef<Asset[]>(points);
  const onSelectRef = useRef(onSelect);
  const [state, setState] = useState<"idle" | "loading" | "shown" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    pointsRef.current = points;
    onSelectRef.current = onSelect;
  });

  // Set up the renderer once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(5, 10, 7);
    scene.add(sun);
    const grid = new THREE.GridHelper(20, 40, 0x2b3a55, 0x1b2638);
    grid.name = "grid";
    scene.add(grid);
    const hotspots = new THREE.Group();
    scene.add(hotspots);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    camera.position.set(3, 2.5, 4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const view: Scene = { renderer, scene, camera, controls, current: null, home: null, mode: "none", hotspots, fadeStart: null };
    sceneRef.current = view;

    renderer.setAnimationLoop((now) => {
      if (view.fadeStart !== null && view.current) {
        const t = Math.min((now - view.fadeStart) / FADE_MS, 1);
        view.current.traverse((child) => {
          const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
          if (material) material.opacity = t;
        });
        if (t === 1) view.fadeStart = null;
      }
      controls.update();
      renderer.render(scene, camera);
    });

    // Clicking a floor circle moves there. A drag (looking around) is not a click.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    let hoveredSpot: THREE.Object3D | null = null;
    const hit = (event: PointerEvent) => {
      if (view.mode !== "panorama" || !view.hotspots.children.length) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      let object: THREE.Object3D | null = raycaster.intersectObjects(view.hotspots.children, true)[0]?.object ?? null;
      while (object && object.userData.assetId === undefined) object = object.parent;
      return object;
    };
    const highlight = (spot: THREE.Object3D | null) => {
      if (spot === hoveredSpot) return;
      hoveredSpot?.scale.setScalar(1);
      spot?.scale.setScalar(1.2);
      hoveredSpot = spot;
      renderer.domElement.style.cursor = spot ? "pointer" : "";
      setHovered(spot ? String(spot.userData.label) : null);
    };
    const onDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const onMove = (event: PointerEvent) => {
      if (event.buttons === 0) highlight(hit(event));
    };
    const onUp = (event: PointerEvent) => {
      const moved = down ? Math.hypot(event.clientX - down.x, event.clientY - down.y) : Infinity;
      down = null;
      if (moved > 6) return;
      const spot = hit(event);
      if (spot) {
        highlight(null);
        onSelectRef.current(Number(spot.userData.assetId));
      }
    };
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      if (view.current) disposeObject(view.current);
      clearHotspots(view);
      renderer.dispose();
      canvas.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.controls.autoRotate = autoRotate;
      sceneRef.current.controls.autoRotateSpeed = 1.5;
    }
  }, [autoRotate]);

  // Load the chosen file. Keyed on id and filename, not the asset object:
  // status polling replaces the object and must not reload it.
  // `cancelled` stops a slow earlier load replacing one picked after it.
  const assetId = asset?.id ?? null;
  const filename = asset?.filename ?? null;
  const kind = asset?.kind ?? null;
  useEffect(() => {
    const view = sceneRef.current;
    if (!view) return;
    if (assetId === null || filename === null) {
      // Nothing selected (e.g. the user switched tour): clear the old file.
      if (view.current) {
        view.scene.remove(view.current);
        disposeObject(view.current);
        view.current = null;
        view.home = null;
      }
      clearHotspots(view);
      view.mode = "none";
      return;
    }
    const id = assetId;
    const name = filename;
    let cancelled = false;

    async function load() {
      setState("loading");
      setError(null);
      try {
        const links = await dispatch(getDownloadLinks(id)).unwrap();
        if (kind === "panorama" && links.faces) {
          const cube = await buildCube(links.faces);
          if (cancelled || !sceneRef.current) {
            disposeObject(cube);
            return;
          }
          showPanorama(sceneRef.current, cube);
          setState("shown");
          return;
        }
        const url = links.url;
        let object: THREE.Object3D;
        if (name.toLowerCase().endsWith(".glb")) {
          object = (await new GLTFLoader().loadAsync(url)).scene;
        } else {
          const geometry = await new PLYLoader().loadAsync(url);
          const colours = geometry.hasAttribute("color");
          if (geometry.index !== null) {
            geometry.computeVertexNormals();
            object = new THREE.Mesh(
              geometry,
              new THREE.MeshStandardMaterial({ vertexColors: colours, color: colours ? 0xffffff : 0xd7dee8 }),
            );
          } else {
            // A point cloud scan: no faces, so draw the points.
            geometry.computeBoundingSphere();
            const radius = geometry.boundingSphere?.radius ?? 1;
            object = new THREE.Points(
              geometry,
              new THREE.PointsMaterial({ size: radius / 60, vertexColors: colours, color: colours ? 0xffffff : 0x7fd8c6 }),
            );
          }
        }
        if (cancelled || !sceneRef.current) {
          disposeObject(object);
          return;
        }
        showModel(sceneRef.current, object);
        setState("shown");
      } catch (e) {
        if (cancelled) return;
        const message =
          typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Could not load the file";
        setError(
          message.includes("Failed to fetch") || message.includes("NetworkError")
            ? "The browser could not download the file. Check the storage CORS settings (see README)."
            : message,
        );
        setState("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [assetId, filename, kind, dispatch]);

  const display = assetId === null ? "idle" : state;

  // Turn the cube by its heading and put a circle on the floor for every
  // other placed scan point nearby. Re-run when any placement changes.
  const heading = asset?.heading ?? 0;
  const placementKey = points.map((p) => `${p.id}:${p.position?.join(",") ?? ""}:${p.heading ?? ""}`).join("|");
  useEffect(() => {
    const view = sceneRef.current;
    if (!view) return;
    clearHotspots(view);
    if (display !== "shown" || view.mode !== "panorama" || !view.current) return;
    view.current.rotation.y = THREE.MathUtils.degToRad(heading);
    const here = pointsRef.current.find((p) => p.id === assetId)?.position;
    if (!here) return;
    for (const other of pointsRef.current) {
      if (other.id === assetId || !other.position) continue;
      const [dx, dy, dz] = [0, 1, 2].map((i) => other.position![i] - here[i]);
      const distance = Math.hypot(dx, dz);
      if (distance < 0.2 || distance > MAX_HOTSPOT_DISTANCE) continue;
      view.hotspots.add(makeHotspot(other, new THREE.Vector3(dx, dy - EYE_HEIGHT, dz), distance));
    }
  }, [display, assetId, heading, placementKey]);

  function resetView() {
    const view = sceneRef.current;
    if (!view?.home) return;
    view.camera.position.copy(view.home.position);
    view.controls.target.copy(view.home.target);
  }

  const isPanorama = asset?.kind === "panorama";
  const index = asset ? points.findIndex((p) => p.id === asset.id) : -1;
  const step = (by: number) => {
    if (index < 0 || points.length < 2) return;
    onSelect(points[(index + by + points.length) % points.length].id);
  };
  const placed = isPanorama && asset?.position != null && points.some((p) => p.id !== asset.id && p.position);
  const overlayButton = "bg-white/10! text-white! border-white/20! hover:bg-white/20!";

  return (
    <div className="relative h-[420px] overflow-hidden rounded-xl bg-gradient-to-b from-night-2 to-night lg:h-[520px]">
      <div ref={containerRef} className="absolute inset-0" />

      {display !== "shown" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
          {display === "idle" && (
            <div className="space-y-2 text-white/60">
              <svg viewBox="0 0 24 24" className="mx-auto size-10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" strokeLinejoin="round" />
                <path d="m3 7 9 5 9-5M12 12v10" strokeLinejoin="round" />
              </svg>
              <p className="text-sm">Choose a ready file to view it in 3D</p>
            </div>
          )}
          {display === "loading" && (
            <div className="flex items-center gap-3 rounded-lg bg-night/70 px-4 py-2 text-white/80 backdrop-blur">
              <Spinner /> <span className="text-sm">Loading {asset?.filename}...</span>
            </div>
          )}
          {display === "error" && (
            <p className="max-w-sm rounded-lg bg-bad-bg px-4 py-3 text-sm text-bad">{error}</p>
          )}
        </div>
      )}

      {display === "shown" && asset && (
        <>
          <div className="absolute left-4 top-4 rounded-lg bg-night/70 px-3 py-2 text-white backdrop-blur">
            <p className="text-sm font-medium">{asset.filename}</p>
            {isPanorama ? (
              <p className="text-xs text-white/60">360 scan point · {asset.face_size}px cube faces</p>
            ) : (
              asset.vertex_count != null && (
                <p className="text-xs text-white/60">{asset.vertex_count.toLocaleString()} vertices</p>
              )
            )}
          </div>
          <div className="absolute right-4 top-4 flex gap-2">
            <Button size="sm" variant="secondary" className={overlayButton} onClick={() => setAutoRotate((v) => !v)}>
              {autoRotate ? "Stop rotating" : "Auto-rotate"}
            </Button>
            <Button size="sm" variant="secondary" className={overlayButton} onClick={resetView}>
              Reset view
            </Button>
          </div>
          {hovered && (
            <p className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-night/80 px-3 py-1 text-xs text-white">
              Go to {hovered}
            </p>
          )}
          <p className="absolute bottom-3 left-4 text-xs text-white/40">
            {!isPanorama
              ? "Drag to rotate, scroll to zoom, right-drag to pan"
              : placed
                ? "Drag to look around, click a circle on the floor to move"
                : "Drag to look around"}
          </p>
        </>
      )}

      {isPanorama && index >= 0 && points.length > 1 && display !== "idle" && (
        <nav
          aria-label="Scan points"
          className="absolute bottom-3 right-4 flex items-center gap-1 rounded-lg bg-night/70 p-1 text-white backdrop-blur"
        >
          <Button size="sm" variant="secondary" className={overlayButton} aria-label="Previous scan point" onClick={() => step(-1)}>
            ‹
          </Button>
          <span className="px-2 text-xs tabular-nums">
            Point {index + 1} of {points.length}
          </span>
          <Button size="sm" variant="secondary" className={overlayButton} aria-label="Next scan point" onClick={() => step(1)}>
            ›
          </Button>
        </nav>
      )}
    </div>
  );
}
