import "server-only";

import { AiProvider, KeyPreference } from "@/generated/prisma/enums";
import { getUserContext } from "@/lib/auth/user-context";
import { env, type Env } from "@/lib/env";
import { loadGlobalSettings, loadSettings } from "@/lib/settings-data";

import { API_KEY_UNREADABLE, ApiKeyUnreadable, apiKeyState, decryptApiKey } from "./api-key";
import type { AiSettingsView, KeyState } from "./provider-options";

// Which provider to use and how to reach it (E6-1): what's saved in Settings,
// or else the DOSSIER_AI_* variables, or else the defaults below.

export type AiConfig = {
  provider: AiProvider;
  baseUrl: string;
  model: string | null;
  apiKey: string | null;
  /** Why the saved key can't be used, e.g. DOSSIER_SECRET changed. */
  apiKeyProblem: string | null;
  timeoutMs: number;
};

export const PROVIDER_DEFAULTS: Record<AiProvider, { baseUrl: string; model: string | null; timeoutSeconds: number }> = {
  // Generous: a local model on a laptop can take minutes for a cover letter.
  [AiProvider.LOCAL]: { baseUrl: "http://localhost:11434", model: null, timeoutSeconds: 300 },
  [AiProvider.OPENAI]: { baseUrl: "https://api.openai.com/v1", model: null, timeoutSeconds: 120 },
  [AiProvider.ANTHROPIC]: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5", timeoutSeconds: 120 },
  [AiProvider.MISTRAL]: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-medium-latest", timeoutSeconds: 120 },
  // As generous as a local model, and loading one can take a while too.
  [AiProvider.LMSTUDIO]: { baseUrl: "http://host.docker.internal:1234", model: null, timeoutSeconds: 300 },
};

const FROM_ENV: Record<NonNullable<Env["DOSSIER_AI_PROVIDER"]>, AiProvider> = {
  local: AiProvider.LOCAL,
  openai: AiProvider.OPENAI,
  anthropic: AiProvider.ANTHROPIC,
  mistral: AiProvider.MISTRAL,
  lmstudio: AiProvider.LMSTUDIO,
};

type SavedSettings = {
  provider: AiProvider | null;
  baseUrl: string | null;
  model: string | null;
  apiKeyEnc: string | null;
};

type AiEnv = Pick<
  Env,
  "DOSSIER_AI_PROVIDER" | "DOSSIER_AI_URL" | "DOSSIER_AI_MODEL" | "DOSSIER_AI_KEY" | "DOSSIER_AI_TIMEOUT_SECONDS"
>;

/**
 * Settings win once a provider is saved there; until then the environment
 * decides. The two are never mixed, except that an env key still serves a
 * saved provider of the same kind that has no key of its own.
 */
export function resolveAiConfig(saved: SavedSettings | null, source: AiEnv, secret?: string): AiConfig {
  const envProvider = source.DOSSIER_AI_PROVIDER ? FROM_ENV[source.DOSSIER_AI_PROVIDER] : null;
  const useSaved = Boolean(saved?.provider);
  const provider = (useSaved ? saved!.provider : envProvider) ?? AiProvider.LOCAL;
  const defaults = PROVIDER_DEFAULTS[provider];

  let apiKey: string | null = null;
  let apiKeyProblem: string | null = null;
  if (useSaved && saved!.apiKeyEnc) {
    try {
      apiKey = decryptApiKey(saved!.apiKeyEnc, secret);
    } catch (error) {
      if (!(error instanceof ApiKeyUnreadable)) throw error;
      apiKeyProblem = API_KEY_UNREADABLE;
    }
  } else if (!useSaved || envProvider === provider) {
    apiKey = source.DOSSIER_AI_KEY ?? null;
  }

  return {
    provider,
    baseUrl: (useSaved ? saved!.baseUrl : source.DOSSIER_AI_URL) || defaults.baseUrl,
    model: (useSaved ? saved!.model : source.DOSSIER_AI_MODEL) || defaults.model,
    apiKey,
    apiKeyProblem,
    timeoutMs: (source.DOSSIER_AI_TIMEOUT_SECONDS ?? defaults.timeoutSeconds) * 1000,
  };
}

/**
 * Resolves an ordered `[primary, secondary]` AI configuration chain for a user,
 * honoring `allowGlobalKeys` and `keyPreference` (`USER_FIRST` vs `GLOBAL_FIRST`).
 */
export function resolveAiConfigChain(
  userSettings: SavedSettings | null,
  globalSettings: (SavedSettings & { keyPreference?: KeyPreference }) | null,
  source: AiEnv,
  options: {
    allowGlobalKeys?: boolean;
    keyPreference?: KeyPreference | null;
    secret?: string;
  } = {},
): AiConfig[] {
  const allowGlobalKeys = options.allowGlobalKeys ?? true;
  const preference = options.keyPreference ?? globalSettings?.keyPreference ?? KeyPreference.USER_FIRST;
  const noKeyEnv: AiEnv = { DOSSIER_AI_TIMEOUT_SECONDS: source.DOSSIER_AI_TIMEOUT_SECONDS };

  // When global keys are forbidden for this user, only their own saved settings apply.
  if (!allowGlobalKeys) {
    return [resolveAiConfig(userSettings, noKeyEnv, options.secret)];
  }

  const globalConfig = resolveAiConfig(globalSettings, source, options.secret);
  const hasGlobalCandidate = Boolean(
    globalSettings?.provider ||
      source.DOSSIER_AI_PROVIDER ||
      globalConfig.apiKey,
  );

  const hasUserKey = Boolean(
    userSettings?.apiKeyEnc ||
      userSettings?.provider === AiProvider.LOCAL ||
      userSettings?.provider === AiProvider.LMSTUDIO,
  );

  if (hasUserKey) {
    const effectiveUserSaved: SavedSettings = {
      provider: userSettings?.provider ?? globalConfig.provider,
      baseUrl: userSettings?.baseUrl ?? (userSettings?.provider && userSettings.provider !== globalConfig.provider ? null : globalSettings?.baseUrl ?? null),
      model: userSettings?.model ?? (userSettings?.provider && userSettings.provider !== globalConfig.provider ? null : globalConfig.model),
      apiKeyEnc: userSettings?.apiKeyEnc ?? null,
    };
    const userConfig = resolveAiConfig(effectiveUserSaved, noKeyEnv, options.secret);

    if (!hasGlobalCandidate) return [userConfig];
    const ordered = preference === KeyPreference.GLOBAL_FIRST ? [globalConfig, userConfig] : [userConfig, globalConfig];
    if (
      ordered[0].provider === ordered[1].provider &&
      ordered[0].baseUrl === ordered[1].baseUrl &&
      ordered[0].model === ordered[1].model &&
      ordered[0].apiKey === ordered[1].apiKey
    ) {
      return [ordered[0]];
    }
    return ordered;
  }

  if (userSettings?.provider) {
    // User selected a provider/model without setting a personal key: lend the global/env key if compatible.
    const mergedSaved: SavedSettings = {
      provider: userSettings.provider,
      baseUrl: userSettings.baseUrl ?? (globalSettings?.provider === userSettings.provider ? globalSettings.baseUrl : null),
      model: userSettings.model ?? (globalSettings?.provider === userSettings.provider ? globalSettings.model : null),
      apiKeyEnc: globalSettings?.provider === userSettings.provider ? globalSettings.apiKeyEnc : null,
    };
    return [resolveAiConfig(mergedSaved, source, options.secret)];
  }

  return [globalConfig];
}

async function safeLoadGlobalSettings(): Promise<(SavedSettings & { keyPreference?: KeyPreference }) | null> {
  try {
    return await loadGlobalSettings();
  } catch {
    return null;
  }
}

/** Loads the ordered `[primary, secondary]` AI configuration chain for the active user context. */
export async function loadAiConfigChain(): Promise<AiConfig[]> {
  const ctx = getUserContext();
  const userSettings = await loadSettings();
  if (!ctx.userId) {
    return [resolveAiConfig(userSettings, env)];
  }
  const globalSettings = await safeLoadGlobalSettings();
  return resolveAiConfigChain(userSettings, globalSettings, env, {
    allowGlobalKeys: ctx.allowGlobalKeys,
    keyPreference: ctx.keyPreference,
  });
}

/** The primary AI configuration in effect right now. */
export async function loadAiConfig(): Promise<AiConfig> {
  const [primary] = await loadAiConfigChain();
  return primary;
}

/**
 * The AI settings as the settings screen shows them: what's in effect,
 * whether it comes from Settings or DOSSIER_AI_*, and never the key.
 */
export async function loadAiSettingsView(): Promise<AiSettingsView> {
  const ctx = getUserContext();
  const saved = await loadSettings();
  const config = await loadAiConfig();
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model ?? "",
    keyState: !ctx.allowGlobalKeys && !saved.apiKeyEnc ? "none" : keyStateOf(saved, config),
  };
}

/** Whether a key is in play for the provider in effect, and where it comes from. */
export function keyStateOf(saved: { provider: AiProvider | null; apiKeyEnc: string | null } | null, config: AiConfig): KeyState {
  if (saved?.provider && saved.apiKeyEnc) return apiKeyState(saved.apiKeyEnc);
  return config.apiKey ? "env" : "none";
}

/** Whether an AI provider has been chosen, in Settings or with DOSSIER_AI_PROVIDER. */
export async function isAiConfigured(): Promise<boolean> {
  const ctx = getUserContext();
  const userSettings = await loadSettings();
  if (userSettings.provider) return true;
  if (!ctx.allowGlobalKeys) return false;
  if (env.DOSSIER_AI_PROVIDER) return true;
  if (!ctx.userId) return false;
  const globalSettings = await safeLoadGlobalSettings();
  return Boolean(globalSettings?.provider);
}

/**
 * Whether Dossier's own AI model can be called: a provider with its model,
 * and a key for the hosted ones that always need one.
 */
export async function isAiUsable(): Promise<boolean> {
  if (!(await isAiConfigured())) return false;
  const chain = await loadAiConfigChain();
  return chain.some((config) => {
    if (!config.model || config.apiKeyProblem) return false;
    const needsKey = config.provider === AiProvider.ANTHROPIC || config.provider === AiProvider.MISTRAL;
    return !needsKey || Boolean(config.apiKey);
  });
}
