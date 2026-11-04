import { createSlice, isRejected, type PayloadAction } from "@reduxjs/toolkit";
import { apiFetch, toReject, type RejectPayload } from "@/lib/api";
import type { TokenResponse, User } from "@/lib/types";
import { createAppAsyncThunk } from "./thunk";

export const TOKEN_KEY = "tourvault.token";

type SessionStatus = "restoring" | "anonymous" | "authenticated";

interface AuthState {
  token: string | null;
  user: User | null;
  status: SessionStatus;
  submitting: boolean;
  error: string | null;
  notice: string | null; // e.g. "Your session expired"
}

const initialState: AuthState = {
  token: null,
  user: null,
  status: "restoring",
  submitting: false,
  error: null,
  notice: null,
};

interface Credentials {
  email: string;
  password: string;
}

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// On page load: if a token was saved, ask the server who it belongs to.
// The server is the only judge of whether it is still valid, and the role
// comes from /me (the database), never from decoding the token here.
export const restoreSession = createAppAsyncThunk("auth/restore", async (_: void, { rejectWithValue }) => {
  const token = readStoredToken();
  if (!token) return null;
  try {
    const user = await apiFetch<User>("/me", { token });
    return { token, user };
  } catch (error) {
    return rejectWithValue(toReject(error));
  }
});

export const login = createAppAsyncThunk("auth/login", async (credentials: Credentials, { rejectWithValue }) => {
  try {
    const { access_token } = await apiFetch<TokenResponse>("/login", { method: "POST", body: credentials });
    const user = await apiFetch<User>("/me", { token: access_token });
    return { token: access_token, user };
  } catch (error) {
    return rejectWithValue(toReject(error));
  }
});

export const register = createAppAsyncThunk(
  "auth/register",
  async (credentials: Credentials, { dispatch, rejectWithValue }) => {
    try {
      await apiFetch<User>("/register", { method: "POST", body: credentials });
    } catch (error) {
      return rejectWithValue(toReject(error));
    }
    // Account created: log straight in with the same credentials.
    const result = await dispatch(login(credentials));
    if (login.rejected.match(result)) {
      return rejectWithValue(result.payload ?? { message: "Login failed", status: 0 });
    }
    return result.payload;
  },
);

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    loggedOut(state) {
      state.token = null;
      state.user = null;
      state.status = "anonymous";
      state.notice = null;
    },
    clearAuthError(state) {
      state.error = null;
    },
    setNotice(state, action: PayloadAction<string | null>) {
      state.notice = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(restoreSession.fulfilled, (state, action) => {
        if (action.payload) {
          state.token = action.payload.token;
          state.user = action.payload.user;
          state.status = "authenticated";
        } else {
          state.status = "anonymous";
        }
      })
      .addCase(restoreSession.rejected, (state) => {
        state.token = null;
        state.user = null;
        state.status = "anonymous";
      })
      .addCase(login.pending, (state) => {
        state.submitting = true;
        state.error = null;
        state.notice = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.submitting = false;
        state.token = action.payload.token;
        state.user = action.payload.user;
        state.status = "authenticated";
      })
      .addCase(login.rejected, (state, action) => {
        state.submitting = false;
        state.error = action.payload?.message ?? "Login failed";
      })
      .addCase(register.pending, (state) => {
        state.submitting = true;
        state.error = null;
      })
      .addCase(register.fulfilled, (state) => {
        state.submitting = false;
      })
      .addCase(register.rejected, (state, action) => {
        state.submitting = false;
        state.error = action.payload?.message ?? "Registration failed";
      })
      // Any other request that comes back 401 means the token expired or was
      // revoked: drop the session so the app sends the user back to log in.
      .addMatcher(
        (action) => isRejected(action) && !action.type.startsWith("auth/"),
        (state, action) => {
          const payload = (action as { payload?: RejectPayload }).payload;
          if (payload?.status === 401 && state.status === "authenticated") {
            state.token = null;
            state.user = null;
            state.status = "anonymous";
            state.notice = "Your session expired. Please log in again.";
          }
        },
      );
  },
});

export const { loggedOut, clearAuthError, setNotice } = authSlice.actions;
export default authSlice.reducer;
