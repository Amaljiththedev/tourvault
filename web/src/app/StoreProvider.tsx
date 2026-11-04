"use client";

import { useEffect, useState } from "react";
import { Provider } from "react-redux";
import { makeStore } from "@/store/store";
import { restoreSession } from "@/store/authSlice";

export default function StoreProvider({ children }: { children: React.ReactNode }) {
  // The useState initialiser runs once, so the store survives re-renders.
  const [{ store, initialState }] = useState(() => {
    const store = makeStore();
    return { store, initialState: store.getState() };
  });

  // The session lives in localStorage, which only the browser has. The server
  // renders with the initial state ("restoring"). serverState makes React use
  // that same snapshot while hydrating, so the HTML always matches, even if
  // restoreSession has already finished by then.
  useEffect(() => {
    store.dispatch(restoreSession());
  }, [store]);

  return (
    <Provider store={store} serverState={initialState}>
      {children}
    </Provider>
  );
}
