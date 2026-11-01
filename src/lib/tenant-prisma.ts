import { getUserContext } from "@/lib/auth/user-context";

/** Models that carry a `userId` column and are strictly isolated per user. */
export const TENANT_MODELS = new Set([
  "profileField",
  "skill",
  "language",
  "experience",
  "project",
  "education",
  "publication",
  "reference",
  "fact",
  "setting",
  "application",
  "posting",
  "claudePaste",
  "agentCandidate",
  "postingScore",
  "postingSearch",
  "startup",
  "startupBlock",
  "emailMessage",
  "job",
]);

const READ_MANY_OPS = new Set(["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
const UNIQUE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);
const MUTATE_MANY_OPS = new Set(["updateMany", "deleteMany"]);
const CREATE_OPS = new Set(["create"]);
const CREATE_MANY_OPS = new Set(["createMany", "createManyAndReturn"]);

type AnyRecord = Record<string, unknown>;

/**
 * Normalizes shorthand unique `where` filters (e.g. `{ key }` -> `{ userId_key: { userId, key } }`)
 * and injects `userId` so composite primary/unique keys and id lookups stay scoped to `userId`.
 */
function scopeUniqueWhere(model: string, where: AnyRecord | undefined, userId: string): AnyRecord | undefined {
  if (!where) return where;
  const next: AnyRecord = { ...where };

  if ((model === "profileField" || model === "setting") && typeof next.key === "string" && !("userId_key" in next)) {
    const key = next.key;
    delete next.key;
    next.userId_key = { userId, key };
  } else if ((model === "profileField" || model === "setting") && next.userId_key && typeof next.userId_key === "object") {
    const compound = next.userId_key as AnyRecord;
    if (!compound.userId) next.userId_key = { ...compound, userId };
  }

  if ((model === "skill" || model === "language") && typeof next.name === "string" && !("userId_name" in next)) {
    const name = next.name;
    delete next.name;
    next.userId_name = { userId, name };
  } else if ((model === "skill" || model === "language") && next.userId_name && typeof next.userId_name === "object") {
    const compound = next.userId_name as AnyRecord;
    if (!compound.userId) next.userId_name = { ...compound, userId };
  }

  if (
    (model === "posting" || model === "postingScore" || model === "startup" || model === "agentCandidate") &&
    next.source_externalId &&
    typeof next.source_externalId === "object" &&
    !("userId_source_externalId" in next)
  ) {
    const compound = next.source_externalId as AnyRecord;
    delete next.source_externalId;
    next.userId_source_externalId = { userId, ...compound };
  } else if (next.userId_source_externalId && typeof next.userId_source_externalId === "object") {
    const compound = next.userId_source_externalId as AnyRecord;
    if (!compound.userId) next.userId_source_externalId = { ...compound, userId };
  }

  if (model === "agentCandidate" && typeof next.dedupeKey === "string" && !("userId_dedupeKey" in next)) {
    const dedupeKey = next.dedupeKey;
    delete next.dedupeKey;
    next.userId_dedupeKey = { userId, dedupeKey };
  } else if (model === "agentCandidate" && next.userId_dedupeKey && typeof next.userId_dedupeKey === "object") {
    const compound = next.userId_dedupeKey as AnyRecord;
    if (!compound.userId) next.userId_dedupeKey = { ...compound, userId };
  }

  if (model === "emailMessage" && typeof next.gmailId === "string" && !("userId_gmailId" in next)) {
    const gmailId = next.gmailId;
    delete next.gmailId;
    next.userId_gmailId = { userId, gmailId };
  } else if (model === "emailMessage" && next.userId_gmailId && typeof next.userId_gmailId === "object") {
    const compound = next.userId_gmailId as AnyRecord;
    if (!compound.userId) next.userId_gmailId = { ...compound, userId };
  }

  if (model === "startupBlock" && typeof next.hash === "string" && !("userId_hash" in next)) {
    const hash = next.hash;
    delete next.hash;
    next.userId_hash = { userId, hash };
  } else if (model === "startupBlock" && next.userId_hash && typeof next.userId_hash === "object") {
    const compound = next.userId_hash as AnyRecord;
    if (!compound.userId) next.userId_hash = { ...compound, userId };
  }

  const hasCompound =
    "userId_key" in next ||
    "userId_name" in next ||
    "userId_source_externalId" in next ||
    "userId_dedupeKey" in next ||
    "userId_gmailId" in next ||
    "userId_hash" in next;

  if (!hasCompound && !("userId" in next)) {
    next.userId = userId;
  }

  return next;
}

function scopeModelArgs(model: string, op: string, rawArgs: unknown): unknown {
  const { userId, unscoped } = getUserContext();

  // Even when unscoped, normalize shorthand compound unique keys with userId="" if needed.
  if (unscoped) {
    if (TENANT_MODELS.has(model) && UNIQUE_OPS.has(op) && rawArgs && typeof rawArgs === "object") {
      const args = { ...(rawArgs as AnyRecord) };
      if (args.where && typeof args.where === "object") {
        const where = { ...(args.where as AnyRecord) };
        if ((model === "profileField" || model === "setting") && typeof where.key === "string" && !("userId_key" in where)) {
          const key = where.key;
          delete where.key;
          where.userId_key = { userId: typeof where.userId === "string" ? where.userId : userId, key };
          delete where.userId;
          args.where = where;
        }
      }
      return args;
    }
    return rawArgs;
  }

  if (model === "googleAccount") {
    const effectiveId = userId || "google";
    const args = rawArgs ? { ...(rawArgs as AnyRecord) } : {};
    if (args.where && typeof args.where === "object") {
      const where = { ...(args.where as AnyRecord) };
      if (where.id === "google") where.id = effectiveId;
      args.where = where;
    }
    if (args.create && typeof args.create === "object") {
      const create = { ...(args.create as AnyRecord) };
      if (!create.id || create.id === "google") create.id = effectiveId;
      args.create = create;
    }
    if (args.data && typeof args.data === "object" && !Array.isArray(args.data)) {
      const data = { ...(args.data as AnyRecord) };
      if (data.id === "google") data.id = effectiveId;
      args.data = data;
    }
    return args;
  }

  if (model === "theme") {
    if (!userId) return rawArgs;
    const args = rawArgs ? { ...(rawArgs as AnyRecord) } : {};
    if (READ_MANY_OPS.has(op)) {
      const accessFilter = { OR: [{ builtIn: true }, { userId }] };
      args.where = args.where ? { AND: [args.where, accessFilter] } : accessFilter;
      return args;
    }
    if (op === "findUnique" || op === "findUniqueOrThrow") {
      if (args.where && typeof args.where === "object") {
        args.where = { ...(args.where as AnyRecord), OR: [{ builtIn: true }, { userId }] };
      }
      return args;
    }
    if (op === "create" && args.data && typeof args.data === "object") {
      const data = { ...(args.data as AnyRecord) };
      if (!data.builtIn && !data.userId) data.userId = userId;
      args.data = data;
      return args;
    }
    if (CREATE_MANY_OPS.has(op) && args.data) {
      if (Array.isArray(args.data)) {
        args.data = args.data.map((row: AnyRecord) => (row.builtIn || row.userId ? row : { ...row, userId }));
      } else if (typeof args.data === "object") {
        const data = { ...(args.data as AnyRecord) };
        if (!data.builtIn && !data.userId) data.userId = userId;
        args.data = data;
      }
      return args;
    }
    if (op === "update" || op === "delete" || MUTATE_MANY_OPS.has(op)) {
      args.where = { ...(args.where as AnyRecord | undefined), userId };
      return args;
    }
    return rawArgs;
  }

  if (!TENANT_MODELS.has(model)) return rawArgs;

  const args = rawArgs ? { ...(rawArgs as AnyRecord) } : {};

  if (READ_MANY_OPS.has(op) || MUTATE_MANY_OPS.has(op)) {
    const existingWhere = (args.where as AnyRecord | undefined) ?? {};
    args.where = "userId" in existingWhere ? existingWhere : { ...existingWhere, userId };
    return args;
  }

  if (UNIQUE_OPS.has(op)) {
    if (args.where && typeof args.where === "object") {
      args.where = scopeUniqueWhere(model, args.where as AnyRecord, userId);
    }
    if (op === "upsert" && args.create && typeof args.create === "object") {
      const create = { ...(args.create as AnyRecord) };
      if (!create.userId) create.userId = userId;
      args.create = create;
    }
    return args;
  }

  if (CREATE_OPS.has(op) && args.data && typeof args.data === "object") {
    const data = { ...(args.data as AnyRecord) };
    if (!data.userId) data.userId = userId;
    args.data = data;
    return args;
  }

  if (CREATE_MANY_OPS.has(op) && args.data) {
    if (Array.isArray(args.data)) {
      args.data = args.data.map((row: AnyRecord) => (row.userId ? row : { ...row, userId }));
    } else if (typeof args.data === "object") {
      const data = { ...(args.data as AnyRecord) };
      if (!data.userId) data.userId = userId;
      args.data = data;
    }
    return args;
  }

  return args;
}

/** Wraps a PrismaClient or TransactionClient so tenant-owned models are scoped to the active user context. */
export function wrapTenantClient<T extends object>(target: T): T {
  const modelProxies = new Map<PropertyKey, unknown>();
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === "$transaction") {
        const txFn = Reflect.get(obj, prop, obj) as (...args: unknown[]) => unknown;
        return (first: unknown, ...rest: unknown[]) => {
          if (typeof first === "function") {
            return txFn.call(obj, (tx: object) => (first as (client: object) => unknown)(wrapTenantClient(tx)), ...rest);
          }
          return txFn.call(obj, first, ...rest);
        };
      }

      const value = Reflect.get(obj, prop, receiver);
      if (typeof prop === "string" && (TENANT_MODELS.has(prop) || prop === "theme" || prop === "googleAccount") && value && typeof value === "object") {
        let delegateProxy = modelProxies.get(prop);
        if (!delegateProxy) {
          delegateProxy = new Proxy(value as object, {
            get(delegate, op) {
              const method = Reflect.get(delegate, op, delegate);
              if (typeof method !== "function" || typeof op !== "string") return method;
              return (args?: unknown) => method.call(delegate, scopeModelArgs(prop, op, args));
            },
          });
          modelProxies.set(prop, delegateProxy);
        }
        return delegateProxy;
      }

      return typeof value === "function" ? value.bind(obj) : value;
    },
  });
}
