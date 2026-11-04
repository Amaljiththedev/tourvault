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
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}
