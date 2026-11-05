// Shapes returned by the TourVault API (see app/models.py in the backend).

export type Role = "admin" | "viewer";

export interface User {
  id: number;
  email: string;
  role: Role;
  created_at: string;
}

export type TourStatus = "draft" | "published";

export interface Tour {
  id: number;
  hospital: string;
  title: string;
  status: TourStatus;
  version: number;
  created_at: string | null;
}

export interface TourInput {
  hospital: string;
  title: string;
  status: TourStatus;
}

export type AssetStatus = "uploaded" | "processing" | "ready" | "failed";

export interface Asset {
  id: number;
  tour_id: number;
  filename: string;
  object_key: string;
  content_type: string | null;
  size_bytes: number;
  status: AssetStatus;
  vertex_count: number | null;
  error: string | null;
  kind: "model" | "panorama" | null;
  face_size: number | null;
  // 360 scan points only: where the camera stood ([x, y, z] metres, y up) and
  // how far the cube is turned about the vertical (degrees). Used to move
  // between points.
  position: [number, number, number] | null;
  heading: number | null;
  created_at: string;
}

// Cube-map faces in the order the API returns them (app/panorama.py FACE_ORDER).
export const CUBE_FACES = ["front", "right", "back", "left", "up", "down"] as const;
export type CubeFace = (typeof CUBE_FACES)[number];

export interface DownloadLinks {
  url: string;
  expires_in_seconds: number;
  faces?: Record<CubeFace, string>; // only for panoramas
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ---------- Admin portal (GET /admin/...) ----------

export interface AdminStats {
  tours: number;
  published_tours: number;
  files: number;
  scan_points: number;
  models: number;
  processing_files: number;
  failed_files: number;
  storage_bytes: number;
  users: number;
  admins: number;
}

export interface AdminTour extends Tour {
  file_count: number;
  scan_points: number;
  models: number;
  failed_files: number;
  size_bytes: number;
}

export interface AdminUser {
  id: number;
  email: string;
  role: Role;
  created_at: string;
  can_log_in: boolean; // false for old accounts saved without a password
}

export interface ActivityEntry {
  id: number;
  action: "create" | "update" | "delete";
  tour_id: number;
  tour_title: string | null; // null once the tour has been deleted
  tour_hospital: string | null;
  user_email: string;
  created_at: string;
}
