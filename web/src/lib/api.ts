// Thin HTTP client for the FastAPI backend. All auth and permission checks
// happen on the server; this only attaches the token and turns errors into
// readable messages.

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ApiError";
  }
}

// What a rejected thunk carries, so reducers can react to a 401.
export interface RejectPayload {
  message: string;
  status: number;
}

export function toReject(error: unknown): RejectPayload {
  if (error instanceof ApiError) return { message: error.message, status: error.status };
  if (error instanceof Error) return { message: error.message, status: 0 };
  return { message: "Something went wrong", status: 0 };
}

// FastAPI returns `detail` as a string for HTTPException and as a list of
// field errors for validation (422). Both become one sentence here.
export function errorMessage(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(d.loc) ? String(d.loc[d.loc.length - 1]) : "";
        const msg = (d.msg ?? "is invalid").replace(/^Value error, /, "");
        return field && field !== "body" ? `${field}: ${msg}` : msg;
      })
      .join("; ");
  }
  if (status === 0) return "Cannot reach the server. Is the API running?";
  return `Request failed (${status})`;
}

async function parse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") ?? "";
  return type.includes("json") ? response.json() : response.text();
}

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(errorMessage(null, 0), 0);
  }

  const body = await parse(response);
  if (!response.ok) throw new ApiError(errorMessage(body, response.status), response.status);
  return body as T;
}

// fetch() cannot report upload progress, so uploads use XMLHttpRequest.
// The browser sets Content-Length for FormData, which the API requires.
export function uploadWithProgress<T>(
  path: string,
  file: File,
  token: string | null,
  onProgress: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new ApiError(errorMessage(body, xhr.status), xhr.status));
    };
    xhr.onerror = () => reject(new ApiError(errorMessage(null, 0), 0));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
