import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { apiFetch, toReject } from "@/lib/api";
import type { Tour, TourInput } from "@/lib/types";
import { loggedOut } from "./authSlice";
import { createAppAsyncThunk } from "./thunk";

interface ToursState {
  items: Tour[];
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  selectedId: number | null;
}

const initialState: ToursState = {
  items: [],
  loaded: false,
  loading: false,
  saving: false,
  error: null,
  selectedId: null,
};

export const fetchTours = createAppAsyncThunk("tours/fetch", async (_: void, { getState, rejectWithValue }) => {
  try {
    return await apiFetch<Tour[]>("/tours?limit=100", { token: getState().auth.token });
  } catch (error) {
    return rejectWithValue(toReject(error));
  }
});

export const createTour = createAppAsyncThunk(
  "tours/create",
  async (input: TourInput, { getState, rejectWithValue }) => {
    try {
      return await apiFetch<Tour>("/tours", { method: "POST", body: input, token: getState().auth.token });
    } catch (error) {
      return rejectWithValue(toReject(error));
    }
  },
);

// Sends the version the user was looking at. If someone else saved in the
// meantime the API answers 409 and nothing is overwritten.
export const updateTour = createAppAsyncThunk(
  "tours/update",
  async (
    { id, input, version }: { id: number; input: TourInput; version: number },
    { getState, dispatch, rejectWithValue },
  ) => {
    try {
      return await apiFetch<Tour>(`/tours/${id}`, {
        method: "PUT",
        body: { ...input, version },
        token: getState().auth.token,
      });
    } catch (error) {
      const reject = toReject(error);
      if (reject.status === 409) dispatch(fetchTours()); // load the newer version
      return rejectWithValue(reject);
    }
  },
);

export const deleteTour = createAppAsyncThunk("tours/delete", async (id: number, { getState, rejectWithValue }) => {
  try {
    await apiFetch(`/tours/${id}`, { method: "DELETE", token: getState().auth.token });
    return id;
  } catch (error) {
    return rejectWithValue(toReject(error));
  }
});

const toursSlice = createSlice({
  name: "tours",
  initialState,
  reducers: {
    selectTour(state, action: PayloadAction<number | null>) {
      state.selectedId = action.payload;
    },
    clearTourError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loggedOut, () => initialState)
      .addCase(fetchTours.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchTours.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.error = null;
        state.items = action.payload;
        if (state.selectedId !== null && !action.payload.some((t) => t.id === state.selectedId)) {
          state.selectedId = null;
        }
        if (state.selectedId === null && action.payload.length) state.selectedId = action.payload[0].id;
      })
      .addCase(fetchTours.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message ?? "Could not load tours";
      })
      .addCase(createTour.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(createTour.fulfilled, (state, action) => {
        state.saving = false;
        state.items.push(action.payload);
        state.selectedId = action.payload.id;
      })
      .addCase(createTour.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload?.message ?? "Could not create the tour";
      })
      .addCase(updateTour.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(updateTour.fulfilled, (state, action) => {
        state.saving = false;
        const index = state.items.findIndex((t) => t.id === action.payload.id);
        if (index >= 0) state.items[index] = action.payload;
      })
      .addCase(updateTour.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload?.message ?? "Could not save the tour";
      })
      .addCase(deleteTour.fulfilled, (state, action) => {
        state.items = state.items.filter((t) => t.id !== action.payload);
        if (state.selectedId === action.payload) state.selectedId = state.items[0]?.id ?? null;
      })
      .addCase(deleteTour.rejected, (state, action) => {
        state.error = action.payload?.message ?? "Could not delete the tour";
      });
  },
});

export const { selectTour, clearTourError } = toursSlice.actions;
export default toursSlice.reducer;
