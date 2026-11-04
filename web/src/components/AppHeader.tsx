"use client";

import { loggedOut } from "@/store/authSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { Button, Logo } from "./ui";

export default function AppHeader() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        {user && (
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="max-w-[16rem] truncate text-sm font-medium">{user.email}</p>
              <p className="text-xs capitalize text-faint">{user.role}</p>
            </div>
            <span
              className="grid size-9 place-items-center rounded-full bg-brand-100 text-sm font-semibold uppercase text-brand-700"
              aria-hidden="true"
            >
              {user.email[0]}
            </span>
            <Button variant="secondary" size="sm" onClick={() => dispatch(loggedOut())}>
              Log out
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
