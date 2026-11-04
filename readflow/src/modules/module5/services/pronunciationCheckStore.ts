import type { PronunciationCheckStep, PronunciationSummary } from "./pronunciationSummary";

/**
 * One English pronunciation check per saved oral-reading attempt, shared by the
 * F2 (feedback), F3 (accuracy) and F4 (words) result panels. It lives outside
 * React components, so closing a panel, switching panels or the result page
 * remounting (for example while the session is re-checked) never discards a
 * result or a check that is still running.
 *
 * Rules:
 *  - a check starts only when the learner presses the button (start());
 *  - while one is running, start() returns the same request: no parallel or
 *    duplicate paid requests;
 *  - a finished check is never restarted; only a failed one may be retried;
 *  - entries are keyed by account and attempt, so another reading or another
 *    account never sees this result.
 * Results are kept in memory for this browser tab only. They are not saved:
 * a page refresh starts from the unchecked state.
 */
export type PronunciationCheckStatus = "idle" | "checking" | "done" | "error";

export interface PronunciationCheckState {
  status: PronunciationCheckStatus;
  step: PronunciationCheckStep;
  summary?: PronunciationSummary;
  error?: string;
}

export type PronunciationCheckRunner = (
  attemptId: string,
  options: { signal: AbortSignal; onStep: (step: PronunciationCheckStep) => void },
) => Promise<PronunciationSummary>;

interface Entry {
  state: PronunciationCheckState;
  running?: Promise<void>;
}

export const IDLE_CHECK: PronunciationCheckState = Object.freeze({ status: "idle", step: "loading" }) as PronunciationCheckState;
const FALLBACK_ERROR = "The pronunciation check is unavailable right now. Please try again.";

export function pronunciationCheckKey(userId: string | null | undefined, attemptId: string | null | undefined) {
  return userId && attemptId ? `${userId}:${attemptId}` : null;
}

export function createPronunciationCheckStore() {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();

  function set(key: string, state: PronunciationCheckState) {
    const entry = entries.get(key) ?? ({} as Entry);
    entry.state = state;
    entries.set(key, entry);
    listeners.forEach((listener) => listener());
  }

  return {
    get(key: string | null): PronunciationCheckState {
      return (key && entries.get(key)?.state) || IDLE_CHECK;
    },

    /** Starts the check for this attempt unless it is already running or finished. */
    start(key: string | null, attemptId: string, run: PronunciationCheckRunner): Promise<void> {
      if (!key) return Promise.resolve();
      const entry = entries.get(key);
      if (entry?.running) return entry.running;
      if (entry?.state.status === "done") return Promise.resolve();

      const controller = new AbortController();
      set(key, { status: "checking", step: "loading" });
      const running = run(attemptId, {
        signal: controller.signal,
        onStep: (step) => {
          const current = entries.get(key)?.state;
          if (current?.status === "checking") set(key, { ...current, step });
        },
      }).then(
        (summary) => set(key, { status: "done", step: "assessing", summary }),
        (failure: unknown) => set(key, {
          status: "error",
          step: "loading",
          // A failed check never carries a summary, so it is never shown as a result.
          error: failure instanceof Error && failure.message && failure.message.length <= 300 ? failure.message : FALLBACK_ERROR,
        }),
      ).finally(() => {
        const current = entries.get(key);
        if (current) delete current.running;
      });
      entries.get(key)!.running = running;
      return running;
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    /** Forgets every result (e.g. tests); a running request finishes into a fresh entry. */
    clear() {
      entries.clear();
      listeners.forEach((listener) => listener());
    },
  };
}

export type PronunciationCheckStore = ReturnType<typeof createPronunciationCheckStore>;

/** The app-wide store for this tab. */
export const pronunciationChecks = createPronunciationCheckStore();
