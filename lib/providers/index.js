// Provider chain. Tries each configured backend in order and falls through on
// rate limits and upstream failures. Free tiers die without notice (Cerebras
// removed its permanent free tier in July 2026), so swapping the order or
// adding a backend should never touch anything outside this folder.

import { cloudflare } from "./cloudflare.js";
import { groq } from "./groq.js";
import { openrouter } from "./openrouter.js";

const CHAIN = [cloudflare, groq, openrouter];
const TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS || 20000);

export function configuredProviders() {
  return CHAIN.filter((p) => p.configured).map((p) => p.name);
}

export async function generate({ system, user }) {
  const available = CHAIN.filter((p) => p.configured);

  if (!available.length) {
    const err = new Error("No rephrase provider is configured on the server.");
    err.code = "NO_PROVIDER";
    throw err;
  }

  const failures = [];

  for (const provider of available) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const { text, model } = await provider.run({ system, user, signal: ac.signal });
      if (!text.trim()) throw new Error("empty response");
      return { text, provider: provider.name, model, failures };
    } catch (e) {
      const reason = e.name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : e.message;
      failures.push({ provider: provider.name, status: e.status ?? null, reason, kind: classify(e) });
      console.error(`[rephrase] ${provider.name} failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }

  const err = new Error("Every provider failed.");
  err.code = "ALL_FAILED";
  err.failures = failures;
  throw err;
}

// Turning an upstream status into a cause matters because the fixes are
// completely different: a retired model ID and a genuinely saturated free
// tier both surface as "it stopped working", and a message that guesses
// "busy" for a dead model sends you looking in the wrong place. Groq retires
// model IDs with no grace period, so this is not a hypothetical.
function classify(e) {
  if (e.name === "AbortError") return "timeout";
  if (e.status === 401 || e.status === 403) return "auth";
  if (e.status === 429) return "rate_limit";
  if (e.status === 404) return "bad_model";
  // Some providers report an unknown model as 400 rather than 404.
  if (e.status === 400 && /model|not.{0,10}found|decommission|deprecat/i.test(e.message)) return "bad_model";
  if (e.status >= 500) return "upstream_down";
  return "unknown";
}

// One sentence naming the actual cause and the actual fix.
export function explainFailures(failures = []) {
  const kinds = new Set(failures.map((f) => f.kind));
  const names = failures.map((f) => f.provider).join(", ");

  if (kinds.size === 1) {
    const [only] = kinds;
    if (only === "auth") return `API key rejected by ${names}. Check the key is correct and has no stray whitespace.`;
    if (only === "bad_model") return `The configured model is not available on ${names}. Providers retire model IDs without warning \u2014 set GROQ_MODEL or CF_MODEL to a current one.`;
    if (only === "rate_limit") return `Free-tier limit reached on ${names}. It resets on the provider's own schedule.`;
    if (only === "timeout") return `${names} did not respond in time. Try again.`;
    if (only === "upstream_down") return `${names} is having an outage. Try again shortly.`;
  }
  return `Every backend failed: ${failures.map((f) => `${f.provider} (${f.kind})`).join(", ")}.`;
}
