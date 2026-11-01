import "server-only";

import { AiProvider } from "@/generated/prisma/enums";

import { loadAiConfigChain, type AiConfig } from "./config";
import { AiError, type AiErrorKind } from "./errors";
import { providerOption } from "./provider-options";
import type { AIProvider, CompletionRequest, JsonCompletionRequest } from "./provider";
import { AnthropicProvider } from "./providers/anthropic";
import { LocalProvider } from "./providers/local";
import { LmStudioProvider } from "./providers/lmstudio";
import { MistralProvider } from "./providers/mistral";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";

export { AiError } from "./errors";
export type { AIProvider, ChatMessage, CompletionRequest, JsonCompletionRequest } from "./provider";

const FAILOVER_ERROR_KINDS = new Set<AiErrorKind>([
  "auth",
  "rate-limited",
  "busy",
  "unreachable",
  "provider",
  "timeout",
]);

function shouldFailover(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  return error instanceof AiError && FAILOVER_ERROR_KINDS.has(error.kind);
}

/**
 * Wraps a primary and secondary `AIProvider` and automatically retries once
 * with the secondary provider when the primary fails with auth, quota/rate-limit,
 * or transient availability errors.
 */
export class FailoverAIProvider implements AIProvider {
  readonly kind: AIProvider["kind"];
  readonly model: string | null;

  constructor(
    private readonly primary: AIProvider,
    private readonly secondary: AIProvider,
  ) {
    this.kind = primary.kind;
    this.model = primary.model;
  }

  complete(request: CompletionRequest): Promise<string>;
  complete<T>(request: JsonCompletionRequest<T>): Promise<T>;
  async complete<T>(request: CompletionRequest | JsonCompletionRequest<T>): Promise<string | T> {
    try {
      return await (this.primary.complete as (req: typeof request) => Promise<string | T>)(request);
    } catch (error) {
      if (!shouldFailover(error, request.signal)) throw error;
      return await (this.secondary.complete as (req: typeof request) => Promise<string | T>)(request);
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    try {
      return await this.primary.listModels(signal);
    } catch (error) {
      if (!shouldFailover(error, signal)) throw error;
      return await this.secondary.listModels(signal);
    }
  }

  async test(signal?: AbortSignal): Promise<{ model: string; latencyMs: number }> {
    try {
      return await this.primary.test(signal);
    } catch (error) {
      if (!shouldFailover(error, signal)) throw error;
      return await this.secondary.test(signal);
    }
  }
}

/** A provider for `config`. A saved key that can't be read stops hosted providers with a clear message. */
export function createProvider(config: AiConfig): AIProvider {
  const { provider, baseUrl, model, apiKey, apiKeyProblem, timeoutMs } = config;
  if (apiKeyProblem && providerOption(provider).apiKey) throw AiError.config(apiKeyProblem);
  switch (provider) {
    case AiProvider.LOCAL:
      return new LocalProvider(baseUrl, model, timeoutMs);
    case AiProvider.OPENAI:
      return new OpenAICompatibleProvider("OPENAI", baseUrl, apiKey, model, timeoutMs);
    case AiProvider.ANTHROPIC:
      return new AnthropicProvider(baseUrl, apiKey, model, timeoutMs);
    case AiProvider.MISTRAL:
      return new MistralProvider(baseUrl, apiKey, model, timeoutMs);
    case AiProvider.LMSTUDIO:
      return new LmStudioProvider(baseUrl, apiKey, model, timeoutMs);
  }
}

/**
 * The provider configured in Settings or by the DOSSIER_AI_* variables,
 * wrapped with automatic failover when both user BYOK and global keys are active.
 */
export async function getAiProvider(): Promise<AIProvider> {
  const chain = await loadAiConfigChain();
  if (chain.length <= 1) return createProvider(chain[0]);

  const providers: AIProvider[] = [];
  let firstError: unknown;
  for (const config of chain) {
    try {
      providers.push(createProvider(config));
    } catch (error) {
      firstError ??= error;
    }
  }
  if (providers.length === 0) throw firstError;
  if (providers.length === 1) return providers[0];
  return new FailoverAIProvider(providers[0], providers[1]);
}
