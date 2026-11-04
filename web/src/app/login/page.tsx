"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AuthShell from "@/components/AuthShell";
import { Alert, Button, Field, Input, PasswordInput } from "@/components/ui";
import { clearAuthError, login, setNotice } from "@/store/authSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const { submitting, error, notice } = useAppSelector((s) => s.auth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    dispatch(clearAuthError());
  }, [dispatch]);

  // Both fields are required here AND on the server. The server check is the
  // one that matters; this one just saves a round trip.
  const emailError = touched && !email.trim() ? "Enter your email" : null;
  const passwordError = touched && !password ? "Enter your password" : null;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!email.trim() || !password) return;
    dispatch(login({ email: email.trim(), password }));
  }

  return (
    <AuthShell title="Welcome back" subtitle="Log in to manage your hospital tours.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {notice && (
          <Alert tone="info" onClose={() => dispatch(setNotice(null))}>
            {notice}
          </Alert>
        )}
        {error && <Alert onClose={() => dispatch(clearAuthError())}>{error}</Alert>}

        <Field label="Email" error={emailError}>
          {(id) => (
            <Input
              id={id}
              type="email"
              autoComplete="username"
              placeholder="you@hospital.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!emailError}
              autoFocus
            />
          )}
        </Field>

        <Field label="Password" error={passwordError}>
          {(id) => (
            <PasswordInput
              id={id}
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!passwordError}
            />
          )}
        </Field>

        <Button type="submit" className="w-full" loading={submitting}>
          Log in
        </Button>

        <p className="text-center text-sm text-muted">
          New to TourVault?{" "}
          <Link href="/register" className="font-medium text-brand-700 hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
