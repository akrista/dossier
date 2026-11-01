import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { KeyPreference, UserRole } from "@/generated/prisma/enums";

export type UserContext = {
  userId: string;
  role: UserRole;
  allowGlobalKeys: boolean;
  keyPreference: KeyPreference | null;
  /** When true, bypasses automatic userId scoping in Prisma (for admin/bootstrap/global settings). */
  unscoped?: boolean;
};

const DEFAULT_CONTEXT: UserContext = {
  userId: "",
  role: UserRole.ADMIN,
  allowGlobalKeys: true,
  keyPreference: null,
};

const storage = new AsyncLocalStorage<UserContext>();

/** Returns the active user context, or the default root context when none is bound. */
export function getUserContext(): UserContext {
  return storage.getStore() ?? DEFAULT_CONTEXT;
}

/** Returns the active user's ID ("" when running in the root/global context). */
export function currentUserId(): string {
  return getUserContext().userId;
}

/** Runs `fn` within the given user context. */
export function runWithUserContext<T>(context: UserContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** Runs `fn` scoped to a specific `userId` (with optional role/key flags). */
export function runWithUserId<T>(
  userId: string,
  fn: () => T,
  options: Partial<Omit<UserContext, "userId">> = {},
): T {
  const parent = getUserContext();
  return storage.run(
    {
      userId,
      role: options.role ?? parent.role,
      allowGlobalKeys: options.allowGlobalKeys ?? parent.allowGlobalKeys,
      keyPreference: options.keyPreference !== undefined ? options.keyPreference : parent.keyPreference,
      unscoped: options.unscoped ?? false,
    },
    fn,
  );
}

/** Runs `fn` with unscoped database access (for admin user management, bootstrap, or global sweeps). */
export function runUnscoped<T>(fn: () => T): T {
  const current = getUserContext();
  return storage.run({ ...current, unscoped: true }, fn);
}

/** Enters the given user context for the remainder of the current async execution context. */
export function enterUserContext(context: UserContext): void {
  storage.enterWith(context);
}
