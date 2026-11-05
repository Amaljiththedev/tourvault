"use client";

import { useEffect, useState } from "react";
import { PageTitle, useAdminReady } from "@/components/AdminShell";
import { ConfirmDialog } from "@/components/Dialog";
import { Alert, Card, Select, Spinner, Button } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { AdminUser, Role } from "@/lib/types";
import { clearAdminError, deleteUser, fetchUsers, setUserRole } from "@/store/adminSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

export default function AdminUsersPage() {
  const dispatch = useAppDispatch();
  const { users, loading, error, busyUserId } = useAppSelector((s) => s.admin);
  const me = useAppSelector((s) => s.auth.user?.id);
  const [toDelete, setToDelete] = useState<AdminUser | null>(null);

  const ready = useAdminReady();
  useEffect(() => {
    if (ready) dispatch(fetchUsers());
  }, [ready, dispatch]);

  async function confirmDelete() {
    if (!toDelete) return;
    await dispatch(deleteUser(toDelete.id));
    setToDelete(null);
  }

  const admins = users.filter((u) => u.role === "admin").length;

  return (
    <>
      <PageTitle
        title="Users"
        subtitle="People register themselves at /register and start as viewers. Promote the ones who should manage tours."
      />
      {error && <Alert onClose={() => dispatch(clearAdminError())}>{error}</Alert>}

      <Card>
        {loading.users && !users.length ? (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted">
            <Spinner className="size-4" /> Loading users...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-canvas text-left text-xs uppercase tracking-wider text-faint">
                <tr>
                  <th className="px-5 py-2.5 font-medium">User</th>
                  <th className="px-3 py-2.5 font-medium">Role</th>
                  <th className="px-3 py-2.5 font-medium">Joined</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((user) => {
                  const self = user.id === me;
                  const lastAdmin = user.role === "admin" && admins <= 1;
                  return (
                    <tr key={user.id}>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="grid size-8 place-items-center rounded-full bg-brand-100 text-xs font-semibold uppercase text-brand-700" aria-hidden="true">
                            {user.email[0]}
                          </span>
                          <span className="font-medium">{user.email}</span>
                          {self && <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-muted">You</span>}
                          {!user.can_log_in && (
                            <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs text-warn" title="Saved without a password, so it cannot log in">
                              Cannot log in
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Select
                          value={user.role}
                          disabled={self || busyUserId === user.id || lastAdmin}
                          title={self ? "You cannot change your own role" : lastAdmin ? "There must always be one admin" : undefined}
                          onChange={(e) => dispatch(setUserRole({ id: user.id, role: e.target.value as Role }))}
                          className="h-8 w-28"
                          aria-label={`Role for ${user.email}`}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="admin">Admin</option>
                        </Select>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted">{formatDate(user.created_at)}</td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-bad!"
                          disabled={self || lastAdmin}
                          loading={busyUserId === user.id && toDelete?.id === user.id}
                          onClick={() => setToDelete(user)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-faint">
        Roles are read from the database on every request, so a change takes effect on the user&apos;s next action. Users with
        uploads or activity on record cannot be deleted; make them a viewer instead.
      </p>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete user?"
        message={
          <>
            <strong className="text-ink">{toDelete?.email}</strong> will no longer be able to log in.
          </>
        }
        busy={busyUserId === toDelete?.id}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </>
  );
}
