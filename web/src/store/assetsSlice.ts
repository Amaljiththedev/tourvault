import { createSlice, nanoid, type PayloadAction } from "@reduxjs/toolkit";
import { apiFetch, toReject, uploadWithProgress } from "@/lib/api";
import type { Asset, DownloadLinks } from "@/lib/types";
import { loggedOut } from "./authSlice";
import { deleteTour } from "./toursSlice";
import { createAppAsyncThunk } from "./thunk";

export interface UploadJob {
  id: string;
  tourId: number;
  filename: string;
  progress: number; // 0..1
  error: string | null;
}

interface AssetsState {
  byTour: Record<number, Asset[]>;
  loading: Record<number, boolean>;
  uploads: UploadJob[];
  error: string | null;
  viewingId: number | null;
}

const initialState: AssetsState = { byTour: {}, loading: {}, uploads: [], error: null, viewingId: null };

// .zip = a 360 scan point: six cube-map faces (face0..face5 or front/back/...).
export const ALLOWED_EXTENSIONS = [".glb", ".ply", ".zip"];
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // must match MAX_UPLOAD_BYTES in app/main.py

export function isUnfinished(asset: Asset): boolean {
  return asset.status === "uploaded" || asset.status === "processing";
}

export const fetchAssets = createAppAsyncThunk(
  "assets/fetch",
  async (tourId: number, { getState, rejectWithValue }) => {
    try {
      const assets = await apiFetch<Asset[]>(`/tours/${tourId}/assets`, { token: getState().auth.token });
      return { tourId, assets };
    } catch (error) {
      return rejectWithValue(toReject(error));
    }
  },
);

export const uploadAsset = createAppAsyncThunk(
  "assets/upload",
  async ({ tourId, file }: { tourId: number; file: File }, { getState, dispatch, rejectWithValue }) => {
    const jobId = nanoid();
    dispatch(uploadStarted({ id: jobId, tourId, filename: file.name, progress: 0, error: null }));

    // Same checks as the server, so the user hears about a bad file before
    // waiting for it to upload. The server still checks everything again.
    const dot = file.name.lastIndexOf(".");
    const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
    let problem: string | null = null;
    if (!ALLOWED_EXTENSIONS.includes(ext)) problem = "Only .glb, .ply or .zip (360 cube map) files are allowed";
    else if (file.size === 0) problem = "File is empty";
    else if (file.size > MAX_UPLOAD_BYTES) problem = "File exceeds the 200 MB limit";
    if (problem) {
      dispatch(uploadFailed({ id: jobId, error: problem }));
      return rejectWithValue({ message: problem, status: 400 });
    }

    try {
      const asset = await uploadWithProgress<Asset>(`/tours/${tourId}/assets`, file, getState().auth.token, (p) =>
        dispatch(uploadProgress({ id: jobId, progress: p })),
      );
      dispatch(uploadFinished(jobId));
      return asset;
    } catch (error) {
      const reject = toReject(error);
      dispatch(uploadFailed({ id: jobId, error: reject.message }));
      return rejectWithValue(reject);
    }
  },
);

export const reprocessAsset = createAppAsyncThunk(
  "assets/reprocess",
  async (assetId: number, { getState, rejectWithValue }) => {
    try {
      return await apiFetch<Asset>(`/assets/${assetId}/reprocess`, { method: "POST", token: getState().auth.token });
    } catch (error) {
      return rejectWithValue(toReject(error));
    }
  },
);

export const deleteAsset = createAppAsyncThunk("assets/delete", async (asset: Asset, { getState, rejectWithValue }) => {
  try {
    await apiFetch(`/assets/${asset.id}`, { method: "DELETE", token: getState().auth.token });
    return asset;
  } catch (error) {
    return rejectWithValue(toReject(error));
  }
});

// Short-lived presigned links straight to storage (one per face for a
// panorama). Not kept in the store: they expire, so they are fetched each
// time a file is opened.
export const getDownloadLinks = createAppAsyncThunk(
  "assets/downloadLinks",
  async (assetId: number, { getState, rejectWithValue }) => {
    try {
      return await apiFetch<DownloadLinks>(`/assets/${assetId}/download`, {
        token: getState().auth.token,
      });
    } catch (error) {
      return rejectWithValue(toReject(error));
    }
  },
);

// Place a 360 scan point in the tour (or clear it with nulls) so the viewer
// can show the points around it and move between them.
export const setPlacement = createAppAsyncThunk(
  "assets/placement",
  async (
    { id, position, heading }: { id: number; position: [number, number, number] | null; heading: number | null },
    { getState, rejectWithValue },
  ) => {
    try {
      return await apiFetch<Asset>(`/assets/${id}/placement`, {
        method: "PUT",
        body: { position, heading },
        token: getState().auth.token,
      });
    } catch (error) {
      return rejectWithValue(toReject(error));
    }
  },
);

function upsert(state: AssetsState, asset: Asset) {
  const list = (state.byTour[asset.tour_id] ??= []);
  const index = list.findIndex((a) => a.id === asset.id);
  if (index >= 0) list[index] = asset;
  else list.push(asset);
}

const assetsSlice = createSlice({
  name: "assets",
  initialState,
  reducers: {
    uploadStarted(state, action: PayloadAction<UploadJob>) {
      state.uploads.push(action.payload);
    },
    uploadProgress(state, action: PayloadAction<{ id: string; progress: number }>) {
      const job = state.uploads.find((j) => j.id === action.payload.id);
      if (job) job.progress = action.payload.progress;
    },
    uploadFinished(state, action: PayloadAction<string>) {
      state.uploads = state.uploads.filter((j) => j.id !== action.payload);
    },
    uploadFailed(state, action: PayloadAction<{ id: string; error: string }>) {
      const job = state.uploads.find((j) => j.id === action.payload.id);
      if (job) job.error = action.payload.error;
    },
    dismissUpload(state, action: PayloadAction<string>) {
      state.uploads = state.uploads.filter((j) => j.id !== action.payload);
    },
    viewAsset(state, action: PayloadAction<number | null>) {
      state.viewingId = action.payload;
    },
    clearAssetError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loggedOut, () => initialState)
      .addCase(deleteTour.fulfilled, (state, action) => {
        delete state.byTour[action.payload];
      })
      .addCase(fetchAssets.pending, (state, action) => {
        // Only show a spinner on the first load, not on every background poll.
        if (!state.byTour[action.meta.arg]) state.loading[action.meta.arg] = true;
      })
      .addCase(fetchAssets.fulfilled, (state, action) => {
        state.loading[action.payload.tourId] = false;
        state.byTour[action.payload.tourId] = action.payload.assets;
      })
      .addCase(fetchAssets.rejected, (state, action) => {
        state.loading[action.meta.arg] = false;
        state.error = action.payload?.message ?? "Could not load files";
      })
      .addCase(uploadAsset.fulfilled, (state, action) => upsert(state, action.payload))
      .addCase(reprocessAsset.fulfilled, (state, action) => upsert(state, action.payload))
      .addCase(setPlacement.fulfilled, (state, action) => upsert(state, action.payload))
      .addCase(setPlacement.rejected, (state, action) => {
        state.error = action.payload?.message ?? "Could not save the placement";
      })
      .addCase(reprocessAsset.rejected, (state, action) => {
        state.error = action.payload?.message ?? "Could not reprocess the file";
      })
      .addCase(deleteAsset.fulfilled, (state, action) => {
        const list = state.byTour[action.payload.tour_id];
        if (list) state.byTour[action.payload.tour_id] = list.filter((a) => a.id !== action.payload.id);
        if (state.viewingId === action.payload.id) state.viewingId = null;
      })
      .addCase(deleteAsset.rejected, (state, action) => {
        state.error = action.payload?.message ?? "Could not delete the file";
      });
  },
});

export const {
  uploadStarted,
  uploadProgress,
  uploadFinished,
  uploadFailed,
  dismissUpload,
  viewAsset,
  clearAssetError,
} = assetsSlice.actions;
export default assetsSlice.reducer;
