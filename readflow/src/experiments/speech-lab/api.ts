import type { Language, Operation, Provider, Result } from "./types";
const base = "/api/speech-lab";
async function checked(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(`${payload.error?.code || response.status}: ${payload.error?.message || "Speech Lab request failed"}`);
  return payload;
}
export async function loadProviders(signal: AbortSignal): Promise<Provider[]> { return (await checked(await fetch(`${base}/providers`, { signal, credentials: "omit" }))).providers; }
export async function runExperiment(input: { provider: string; language: Language; operation: Operation; text: string; scenario: string; audio?: Blob }, signal: AbortSignal): Promise<Result> {
  const form = new FormData();
  form.set("provider", input.provider); form.set("language", input.language); form.set("text", input.text); form.set("scenario", input.scenario);
  if (input.operation !== "synthesize" && input.audio) form.set("audio", input.audio, "anonymous-test.wav");
  const started = performance.now();
  const result: Result = await checked(await fetch(`${base}/${input.operation}`, { method: "POST", body: form, signal, credentials: "omit", headers: { "X-Speech-Lab": "1" } }));
  result.timings.clientMs = performance.now() - started;
  return result;
}
