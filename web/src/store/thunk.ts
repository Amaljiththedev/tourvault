import { createAsyncThunk } from "@reduxjs/toolkit";
import type { RejectPayload } from "@/lib/api";
import type { AppDispatch, RootState } from "./store";

// createAsyncThunk pre-typed with this app's state, dispatch and error shape.
export const createAppAsyncThunk = createAsyncThunk.withTypes<{
  state: RootState;
  dispatch: AppDispatch;
  rejectValue: RejectPayload;
}>();
