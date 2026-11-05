import { configureStore, createListenerMiddleware } from "@reduxjs/toolkit";
import authReducer, { restoreSession, TOKEN_KEY } from "./authSlice";
import toursReducer from "./toursSlice";
import assetsReducer from "./assetsSlice";
import adminReducer from "./adminSlice";

// Keeps localStorage in step with the token in the store. Side effects live
// here, not in reducers, so reducers stay pure.
const listener = createListenerMiddleware();
listener.startListening({
  predicate: (_action, current, previous) =>
    (current as RootState).auth.token !== (previous as RootState).auth.token,
  effect: (_action, api) => {
    const token = (api.getState() as RootState).auth.token;
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Private mode or blocked storage: the session just will not survive a reload.
    }
  },
});

// A saved token the server rejected never entered the store, so the listener
// above sees no change. Remove it here so it is not retried on every visit.
listener.startListening({
  actionCreator: restoreSession.rejected,
  effect: () => {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore, as above
    }
  },
});

// A function, not a module-level singleton, so a server render never shares
// state between users. Each browser tab gets its own store.
export function makeStore() {
  return configureStore({
    reducer: { auth: authReducer, tours: toursReducer, assets: assetsReducer, admin: adminReducer },
    middleware: (getDefault) => getDefault().prepend(listener.middleware),
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
