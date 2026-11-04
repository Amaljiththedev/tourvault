"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import type { Asset } from "@/lib/types";
import { getDownloadUrl } from "@/store/assetsSlice";
import { useAppDispatch } from "@/store/hooks";
import { Button, Spinner } from "./ui";

interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  current: THREE.Object3D | null;
  home: { position: THREE.Vector3; target: THREE.Vector3 } | null;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

function showObject(view: Scene, object: THREE.Object3D) {
  if (view.current) {
    view.scene.remove(view.current);
    disposeObject(view.current);
  }
  view.current = object;
  view.scene.add(object);

  // Centre the model, sit it on the grid, and back the camera off to fit it.
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const span = size.length() || 1;
  const centre = box.getCenter(new THREE.Vector3());
  const grid = view.scene.getObjectByName("grid");
  if (grid) {
    grid.position.set(centre.x, box.min.y, centre.z);
    grid.scale.setScalar(Math.max(span / 10, 0.1));
  }
  const position = centre.clone().add(new THREE.Vector3(span * 0.9, span * 0.6, span * 1.1));
  view.camera.near = span / 1000;
  view.camera.far = span * 100;
  view.camera.position.copy(position);
  view.camera.updateProjectionMatrix();
  view.controls.target.copy(centre);
  view.home = { position, target: centre };
}

// Loaded only in the browser (see next/dynamic in TourDetail): WebGL has no
// server-side equivalent.
export default function ModelViewer({ asset }: { asset: Asset | null }) {
  const dispatch = useAppDispatch();
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "shown" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);

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

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    sceneRef.current = { renderer, scene, camera, controls, current: null, home: null };

    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      if (sceneRef.current?.current) disposeObject(sceneRef.current.current);
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.controls.autoRotate = autoRotate;
      sceneRef.current.controls.autoRotateSpeed = 1.5;
    }
  }, [autoRotate]);

  // Load the chosen model. Keyed on id and filename, not the asset object:
  // status polling replaces the object and must not reload the model.
  // `cancelled` stops a slow earlier load replacing one picked after it.
  const assetId = asset?.id ?? null;
  const filename = asset?.filename ?? null;
  useEffect(() => {
    const view = sceneRef.current;
    if (!view) return;
    if (assetId === null || filename === null) {
      // Nothing selected (e.g. the user switched tour): clear the old model.
      if (view.current) {
        view.scene.remove(view.current);
        disposeObject(view.current);
        view.current = null;
        view.home = null;
      }
      return;
    }
    const id = assetId;
    const name = filename;
    let cancelled = false;

    async function load() {
      setState("loading");
      setError(null);
      try {
        const url = await dispatch(getDownloadUrl(id)).unwrap();
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
        showObject(sceneRef.current, object);
        setState("shown");
      } catch (e) {
        if (cancelled) return;
        const message =
          typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Could not load the model";
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
  }, [assetId, filename, dispatch]);

  const display = assetId === null ? "idle" : state;

  function resetView() {
    const view = sceneRef.current;
    if (!view?.home) return;
    view.camera.position.copy(view.home.position);
    view.controls.target.copy(view.home.target);
  }

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
            <div className="flex items-center gap-3 text-white/80">
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
            {asset.vertex_count != null && (
              <p className="text-xs text-white/60">{asset.vertex_count.toLocaleString()} vertices</p>
            )}
          </div>
          <div className="absolute right-4 top-4 flex gap-2">
            <Button size="sm" variant="secondary" className="bg-white/10! text-white! border-white/20! hover:bg-white/20!" onClick={() => setAutoRotate((v) => !v)}>
              {autoRotate ? "Stop rotating" : "Auto-rotate"}
            </Button>
            <Button size="sm" variant="secondary" className="bg-white/10! text-white! border-white/20! hover:bg-white/20!" onClick={resetView}>
              Reset view
            </Button>
          </div>
          <p className="absolute bottom-3 left-4 text-xs text-white/40">Drag to rotate, scroll to zoom, right-drag to pan</p>
        </>
      )}
    </div>
  );
}
