import "server-only";

import { randomUUID } from "node:crypto";

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ReasoningEffort } from "openai/resources/shared";

import { appVersion } from "@/lib/version";

import { BaseProvider, withJsonSchema, type ChatAnswer, type ChatCall } from "../provider";
import { keyGuardedFetch } from "./guarded-fetch";

/** How to ask for JSON, strongest first (E6-4). */
const JSON_MODES = ["schema", "object", "prompt"] as const;
type JsonMode = (typeof JSON_MODES)[number];

/** Room for a model that thinks before it writes; the thinking counts towards `max_tokens`. */
const THINKING_TOKENS = 12_000;

type Quirks = { noTemperature: boolean; maxCompletionTokens: boolean; noEffort: boolean; thinks: boolean; json: JsonMode };

// What each server and model turned out to accept, so it's only learnt once:
// newer OpenAI models refuse `temperature` and `max_tokens`, many compatible
// servers only know `max_tokens`, not all of them do JSON schemas, and not
// every model takes a reasoning effort.
const quirks = new Map<string, Quirks>();

// Schemas the API refused as too complex (union-typed and optional parameters,
// grammar size), by server, model and schema name: large ones, such as a whole
// profile, go in the prompt instead while simpler ones keep structured output (#230).
const promptSchemas = new Set<string>();
const SCHEMA_REFUSED = /grammar is too large|parameters with union types|optional parameters|schema is too complex/i;
const JSON_REFUSED = /response_format|json_schema|json_object|structured|invalid schema|support the provided parameters|provider returned error/i;

/**
 * The answer's text. Some servers, Mistral's among them, send a model that
 * thinks as a list of chunks: the text ones are the answer, the thinking
 * isn't.
 */
export function answerText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((chunk: { type?: unknown; text?: unknown }) => (chunk?.type === "text" && typeof chunk.text === "string" ? [chunk.text] : []))
    .join("");
}

/** Whether a chat completion included reasoning tokens that counted towards `max_tokens`. */
function hasReasoning(completion: OpenAI.Chat.Completions.ChatCompletion): boolean {
  if ((completion.usage?.completion_tokens_details?.reasoning_tokens ?? 0) > 0) return true;
  const message = completion.choices[0]?.message as unknown as Record<string, unknown> | undefined;
  if (!message) return false;
  if (typeof message.reasoning_content === "string" && message.reasoning_content.length > 0) return true;
  if (typeof message.reasoning === "string" && message.reasoning.length > 0) return true;
  return Array.isArray(message.content) && message.content.some((chunk: { type?: unknown }) => chunk?.type === "thinking" || chunk?.type === "reasoning");
}

function hostname(baseURL: string): string {
  return URL.canParse(baseURL) ? new URL(baseURL).hostname : "";
}

/**
 * DeepSeek's API, by the server's host rather than the model's name (#189):
 * its models think before they answer unless told not to, and the thinking
 * counts towards `max_tokens`, so longer answers ran out of room.
 */
export function isDeepSeek(baseURL: string): boolean {
  const host = hostname(baseURL);
  return host === "deepseek.com" || host.endsWith(".deepseek.com");
}

/** OpenCode's inference gateway, which requires a session header and serves `/models` at `/v1`. */
export function isOpenCode(baseURL: string): boolean {
  const host = hostname(baseURL);
  return host === "opencode.ai" || host.endsWith(".opencode.ai");
}

/** OpenRouter's gateway, whose OpenAI-compatible root is `/api/v1` rather than `/v1`. */
export function isOpenRouter(baseURL: string): boolean {
  const host = hostname(baseURL);
  return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
}

/** Normalises known gateway addresses so both `/models` and `/chat/completions` resolve. */
export function normalizeBaseURL(address: string): string {
  const trimmed = address.trim().replace(/\/+$/, "");
  if (!URL.canParse(trimmed)) return trimmed;
  const url = new URL(trimmed);
  const path = url.pathname.replace(/\/+$/, "");
  if (isOpenRouter(trimmed) && (path === "" || path === "/v1" || path === "/api")) {
    url.pathname = "/api/v1";
    return url.toString().replace(/\/+$/, "");
  }
  if (isOpenCode(trimmed)) {
    const prefix = path.replace(/\/(?:openai\/v1|openai|v1)$/, "") || "/inference";
    url.pathname = `${prefix}/v1`;
    return url.toString().replace(/\/+$/, "");
  }
  return trimmed;
}

/** Any server that speaks the OpenAI chat completions API, including llama.cpp's server. */
export class OpenAICompatibleProvider extends BaseProvider {
  protected readonly client: OpenAI;
  protected readonly baseURL: string;
  private readonly noThinking: boolean;

  constructor(
    readonly kind: "OPENAI" | "LOCAL" | "MISTRAL" | "LMSTUDIO",
    baseURL: string,
    apiKey: string | null,
    model: string | null,
    timeoutMs: number,
  ) {
    super(model, timeoutMs);
    this.baseURL = normalizeBaseURL(baseURL);
    const openCodeHeaders = isOpenCode(this.baseURL)
      ? {
          "User-Agent": `Dossier/${appVersion} (+https://github.com/AienTech/dossier)`,
          "x-opencode-session": `ses_${randomUUID()}`,
        }
      : {};
    // Local servers often need no key, but the SDK insists on one; omit the
    // dummy bearer header so public model lists don't reject it as invalid.
    this.client = new OpenAI({
      baseURL: this.baseURL,
      apiKey: apiKey || "not-needed",
      timeout: timeoutMs,
      maxRetries: 1,
      defaultHeaders: {
        ...(apiKey ? {} : { Authorization: null }),
        ...openCodeHeaders,
      },
      // With a key attached, no redirects to other hosts (E11-5).
      ...(apiKey ? { fetch: keyGuardedFetch() } : {}),
    });
    this.noThinking = isDeepSeek(this.baseURL);
  }

  protected async chat(call: ChatCall): Promise<ChatAnswer> {
    const key = `${this.baseURL} ${call.model}`;
    const schemaKey = call.json ? `${key} ${call.json.name}` : "";
    let known: Quirks = quirks.get(key) ?? { noTemperature: false, maxCompletionTokens: false, noEffort: false, thinks: false, json: "schema" };
    // A 400, 422 or gateway 404 naming a parameter this model doesn't take:
    // adapt and remember, once per parameter.
    for (;;) {
      try {
        const effective: Quirks = promptSchemas.has(schemaKey) ? { ...known, json: "prompt" } : known;
        const { answer, reasoned } = await this.send(call, effective);
        if (reasoned && !known.thinks) {
          known = { ...known, thinks: true };
          quirks.set(key, known);
          if (answer.cutOff) continue;
        }
        return answer;
      } catch (error) {
        const status = error instanceof OpenAI.APIError ? error.status : undefined;
        const message = error instanceof OpenAI.APIError && (status === 400 || status === 404 || status === 422) ? error.message : "";
        if (call.json !== undefined && (status === 400 || status === 422) && SCHEMA_REFUSED.test(message) && !promptSchemas.has(schemaKey)) {
          promptSchemas.add(schemaKey);
          continue;
        }
        const jsonRefused =
          call.json !== undefined &&
          (status === 400 || status === 422
            ? JSON_REFUSED.test(message)
            : status === 404 && /response_format|json_schema|json_object|structured|support the provided parameters/i.test(message));
        const adapted: Quirks = {
          noTemperature: known.noTemperature || (call.temperature !== undefined && /temperature/i.test(message)),
          maxCompletionTokens: known.maxCompletionTokens || /max_tokens/.test(message),
          noEffort: known.noEffort || (this.reasoningEffort(call) !== undefined && /reasoning_effort/i.test(message)),
          thinks: known.thinks,
          json: jsonRefused ? (JSON_MODES[JSON_MODES.indexOf(known.json) + 1] ?? known.json) : known.json,
        };
        if (
          adapted.noTemperature === known.noTemperature &&
          adapted.maxCompletionTokens === known.maxCompletionTokens &&
          adapted.noEffort === known.noEffort &&
          adapted.json === known.json
        ) {
          throw error;
        }
        known = adapted;
        quirks.set(key, known);
      }
    }
  }

  /** The `reasoning_effort` to send for `call`, if any; none by default, as servers differ in what they take. */
  protected reasoningEffort(call: ChatCall): ReasoningEffort | undefined {
    void call;
    return undefined;
  }

  private async send(
    call: ChatCall,
    { noTemperature, maxCompletionTokens, noEffort, thinks, json }: Quirks,
  ): Promise<{ answer: ChatAnswer; reasoned: boolean }> {
    const effort = noEffort ? undefined : this.reasoningEffort(call);
    const maxTokens = call.maxTokens + (thinks ? THINKING_TOKENS : 0);
    // Without schema support, the schema goes into the instructions instead.
    const system = call.json && json !== "schema" ? withJsonSchema(call.system, call.json.schema) : call.system;
    const responseFormat = !call.json
      ? {}
      : json === "schema"
        ? { response_format: zodResponseFormat(call.json.schema, call.json.name) }
        : json === "object"
          ? { response_format: { type: "json_object" as const } }
          : {};
    const completion = await this.client.chat.completions.create(
      {
        model: call.model,
        messages: [{ role: "system", content: system }, ...call.messages],
        ...(noTemperature || call.temperature === undefined ? {} : { temperature: call.temperature }),
        ...(maxCompletionTokens ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
        ...(effort ? { reasoning_effort: effort } : {}),
        ...(this.noThinking ? { thinking: { type: "disabled" } } : {}),
        ...responseFormat,
      },
      { signal: call.signal },
    );
    const choice = completion.choices[0];
    // Mistral says `model_length` when the context ran out instead.
    const finish: string | undefined = choice?.finish_reason;
    return {
      answer: { text: answerText(choice?.message?.content), cutOff: finish === "length" || finish === "model_length" },
      reasoned: hasReasoning(completion),
    };
  }

  protected async fetchModels(signal: AbortSignal): Promise<string[]> {
    const ids: string[] = [];
    for await (const model of this.client.models.list({ signal })) ids.push(model.id);
    return ids.sort();
  }
}
