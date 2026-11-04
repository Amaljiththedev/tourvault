"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AuthShell from "@/components/AuthShell";
import { Alert, Button, Field, Input, PasswordInput } from "@/components/ui";
import { clearAuthError, register } from "@/store/authSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

// Mirrors the server rules in app/models.py (UserCreate).
const MIN_LENGTH = 8;
const MAX_BYTES = 72;

function passwordProblem(password: string): string | null {
  if (!password) return "Choose a password";
  if (!password.trim()) return "Password cannot be blank";
  if (password.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters`;
  if (new TextEncoder().encode(password).length > MAX_BYTES) return "Password is too long (72 bytes max)";
  return null;
}

export default function RegisterPage() {
  const dispatch = useAppDispatch();
  const { submitting, error } = useAppSelector((s) => s.auth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    dispatch(clearAuthError());
  }, [dispatch]);

  const emailError = touched && !/^\S+@\S+\.\S+$/.test(email.trim()) ? "Enter a valid email" : null;
  const passwordError = touched ? passwordProblem(password) : null;
  const confirmError = touched && confirm !== password ? "Passwords do not match" : null;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!/^\S+@\S+\.\S+$/.test(email.trim()) || passwordProblem(password) || confirm !== password) return;
    dispatch(register({ email: email.trim(), password }));
  }

  const strength = Math.min(4, Math.floor(password.length / 4) + (/[^a-zA-Z]/.test(password) ? 1 : 0));

  return (
    <AuthShell title="Create your account" subtitle="New accounts start as viewers. An admin can promote you.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <Alert onClose={() => dispatch(clearAuthError())}>{error}</Alert>}

        <Field label="Email" error={emailError}>
          {(id) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              placeholder="you@hospital.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!emailError}
              autoFocus
            />
          )}
        </Field>

        <Field label="Password" hint={`At least ${MIN_LENGTH} characters`} error={passwordError}>
          {(id) => (
            <>
              <PasswordInput
                id={id}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!passwordError}
              />
              <div className="mt-2 flex gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`h-1 flex-1 rounded-full ${i < strength ? (strength >= 3 ? "bg-ok" : "bg-warn") : "bg-line"}`}
                  />
                ))}
              </div>
            </>
          )}
        </Field>

        <Field label="Confirm password" error={confirmError}>
          {(id) => (
            <PasswordInput
              id={id}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={!!confirmError}
            />
          )}
        </Field>

        <Button type="submit" className="w-full" loading={submitting}>
          Create account
        </Button>

        <p className="text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
