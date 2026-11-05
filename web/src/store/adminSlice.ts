import { createSlice } from "@reduxjs/toolkit";
import { apiFetch, toReject } from "@/lib/api";
import type { ActivityEntry, AdminStats, AdminTour, AdminUser, Role } from "@/lib/types";
import { loggedOut } from "./authSlice";
import { createAppAsyncThunk } from "./thunk";
import { createTour, deleteTour, updateTour } from "./toursSlice";

// Data for the /admin pages. Every request here needs an admin; the API
// answers 403 otherwise, so the client-side guard is only for navigation.

interface AdminState {
  stats: AdminStats | null;
  tours: AdminTour[];
  users: AdminUser[];
  activity: ActivityEntry[];
  loading: Record<"stats" | "tours" | "users" | "activity", boolean>;
  busyUserId: number | null;
  error: string | null;
}

const initialState: AdminState = {
  stats: null,
  tours: [],
  users: [],
  activity: [],
  loading: { stats: false, tours: false, users: false, activity: false },
  busyUserId: null,
  error: null,
};

function get<T>(path: string) {
  return createAppAsyncThunk(`admin/get${path}`, async (_: void, { getState, rejectWithValue }) => {
    try {
      return await apiFetch<T>(path, { token: getState().auth.token });
    } catch (error) {
      return rejectWithValue(toReject(error));
    }
  });
}

export const fetchStats = get<AdminStats>("/admin/stats");
export const fetchAdminTours = get<AdminTour[]>("/admin/tours");
export const fetchUsers = get<AdminUser[]>("/admin/users");
export const fetchActivity = get<ActivityEntry[]>("/admin/activity?limit=100");

export const setUserRole = createAppAsyncThunk(
  "admin/setRole",
  async ({ id, role }: { id: number; role: Role }, { getState, rejectWithValue }) => {
    try {
      return await apiFetch<AdminUser>(`/admin/users/${id}/role`, {
        method: "PUT",
        body: { role },
        token: getState().auth.token,
      });
    } catch (error) {
      return rejectWithValue(toReject(error));
    }
  },
);

export const deleteUser = createAppAsyncThunk("admin/deleteUser", async (id: number, { getState, rejectWithValue }) => {
  try {
    await apiFetch(`/admin/users/${id}`, { method: "DELETE", token: getState().auth.token });
    return id;
  } catch (error) {
    return rejectWithValue(toReject(error));
  }
});

const adminSlice = createSlice({
  name: "admin",
  initialState,
  reducers: {
    clearAdminError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    const track = <K extends keyof AdminState["loading"]>(
      key: K,
      thunk: typeof fetchStats | typeof fetchAdminTours | typeof fetchUsers | typeof fetchActivity,
      store: (state: AdminState, payload: never) => void,
    ) => {
      builder
        .addCase(thunk.pending, (state) => {
          state.loading[key] = true;
        })
        .addCase(thunk.fulfilled, (state, action) => {
          state.loading[key] = false;
          store(state, action.payload as never);
        })
        .addCase(thunk.rejected, (state, action) => {
          state.loading[key] = false;
          state.error = action.payload?.message ?? "Could not load admin data";
        });
    };
    track("stats", fetchStats, (state, payload: AdminStats) => {
      state.stats = payload;
    });
    track("tours", fetchAdminTours, (state, payload: AdminTour[]) => {
      state.tours = payload;
    });
    track("users", fetchUsers, (state, payload: AdminUser[]) => {
      state.users = payload;
    });
    track("activity", fetchActivity, (state, payload: ActivityEntry[]) => {
      state.activity = payload;
    });

    builder
      .addCase(loggedOut, () => initialState)
      // Keep the tours table in step with edits made through the tours slice.
      .addCase(createTour.fulfilled, (state, action) => {
        state.tours.push({ ...action.payload, file_count: 0, scan_points: 0, models: 0, failed_files: 0, size_bytes: 0 });
      })
      .addCase(updateTour.fulfilled, (state, action) => {
        const row = state.tours.find((t) => t.id === action.payload.id);
        if (row) Object.assign(row, action.payload);
      })
      .addCase(deleteTour.fulfilled, (state, action) => {
        state.tours = state.tours.filter((t) => t.id !== action.payload);
      })
      .addCase(setUserRole.pending, (state, action) => {
        state.busyUserId = action.meta.arg.id;
        state.error = null;
      })
      .addCase(setUserRole.fulfilled, (state, action) => {
        state.busyUserId = null;
        const index = state.users.findIndex((u) => u.id === action.payload.id);
        if (index >= 0) state.users[index] = action.payload;
      })
      .addCase(setUserRole.rejected, (state, action) => {
        state.busyUserId = null;
        state.error = action.payload?.message ?? "Could not change the role";
      })
      .addCase(deleteUser.pending, (state, action) => {
        state.busyUserId = action.meta.arg;
        state.error = null;
      })
      .addCase(deleteUser.fulfilled, (state, action) => {
        state.busyUserId = null;
        state.users = state.users.filter((u) => u.id !== action.payload);
      })
      .addCase(deleteUser.rejected, (state, action) => {
        state.busyUserId = null;
        state.error = action.payload?.message ?? "Could not delete the user";
      });
  },
});

export const { clearAdminError } = adminSlice.actions;
export default adminSlice.reducer;
