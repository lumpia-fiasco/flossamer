import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const MODEL = "claude-opus-5";

/**
 * Per-task model override. Mail classification runs on every undecided message,
 * so it's the first place to consider a cheaper model once quality is measured.
 */
export const modelFor = (task: "classify" | "extract" | "draft" | "voice" | "radar") =>
  process.env[`FLOSSAMER_MODEL_${task.toUpperCase()}`] ?? MODEL;

export type Effort = "low" | "medium" | "high";

let shared: Anthropic | undefined;

/** Resolves credentials from ANTHROPIC_API_KEY or an `ant auth login` profile. */
export function client(): Anthropic {
  shared ??= new Anthropic();
  return shared;
}

export class RefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`Model declined the request (${category ?? "unspecified"})`);
  }
}

export class UnparsedOutputError extends Error {}

/**
 * One structured call. Uses server-side refusal fallbacks ("default" routing),
 * so a declined request is retried on Anthropic's recommended model in the same call.
 * The system prompt is a stable constant per task so it caches across calls.
 */
export async function structured<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  input: string;
  effort: Effort;
  model?: string;
}): Promise<z.infer<S>> {
  const response = await client().beta.messages.parse({
    model: opts.model ?? MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    cache_control: { type: "ephemeral" },
    output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: "user", content: opts.input }],
  });

  if (response.stop_reason === "refusal") {
    throw new RefusalError(response.stop_details?.category ?? null);
  }
  if (response.parsed_output == null) {
    throw new UnparsedOutputError(`No parsed output (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}
