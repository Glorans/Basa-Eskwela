import {
  PronunciationCheckInProgressError,
  type PronunciationCheckResult,
  type PronunciationCheckStep,
  type PronunciationSummary,
  type SavedPronunciationCheck,
} from "./pronunciationSummary.ts";

/**
 * One English pronunciation check per saved oral-reading attempt, shared by the
 * F2 (feedback), F3 (accuracy) and F4 (words) result panels. It lives outside
 * React components, so closing a panel, switching panels or the result page
 * remounting never discards a result or a check that is still running.
 *
 * Rules:
 *  - opening a reading only reads the saved result (load()); that is free and
 *    never runs a new check;
 *  - a check starts only when the learner presses the button (start()), and
 *    the server returns the saved result instead of re-checking if one exists;
 *  - while one is running, start() returns the same request: no parallel or
 *    duplicate paid requests; a check running elsewhere (another tab, or before
 *    a refresh) is shown as "pending" and only re-read, never re-run;
 *  - a finished check is never restarted; only a failed one may be retried;
 *  - entries are keyed by account and attempt, so another reading or another
 *    account never sees this result.
 * Saved results come back after a refresh or a new sign-in. A result the server
 * could not save is marked saved: false and kept for this tab only.
 */
export type PronunciationCheckStatus = "loading" | "idle" | "checking" | "pending" | "done" | "error";

export interface PronunciationCheckState {
  status: PronunciationCheckStatus;
  step: PronunciationCheckStep;
  summary?: PronunciationSummary;
  /** Only with status "done": true when the server confirmed the result is saved. */
  saved?: boolean;
  checkedAt?: string | null;
  /** Why a finished result was not saved. */
  notice?: string;
  error?: string;
  /** The saved result could not be read; the learner may still press the button. */
  loadError?: string;
}

export type PronunciationCheckRunner = (
  attemptId: string,
  options: { signal: AbortSignal; onStep: (step: PronunciationCheckStep) => void },
) => Promise<PronunciationCheckResult>;

export type SavedPronunciationLoader = (attemptId: string) => Promise<SavedPronunciationCheck>;

interface Entry {
  state: PronunciationCheckState;
  running?: Promise<void>;
  loading?: Promise<void>;
}

export const IDLE_CHECK: PronunciationCheckState = Object.freeze({ status: "idle", step: "loading" }) as PronunciationCheckState;
/** Before the saved result has been read. */
export const LOADING_CHECK: PronunciationCheckState = Object.freeze({ status: "loading", step: "loading" }) as PronunciationCheckState;
const FALLBACK_ERROR = "The pronunciation check is unavailable right now. Please try again.";
export const LOAD_ERROR = "Saved pronunciation results could not be loaded right now.";

export function pronunciationCheckKey(userId: string | null | undefined, attemptId: string | null | undefined) {
  return userId && attemptId ? `${userId}:${attemptId}` : null;
}

function doneState(result: PronunciationCheckResult): PronunciationCheckState {
  return {
    status: "done",
    step: "assessing",
    summary: result.summary,
    saved: result.saved,
    checkedAt: result.checkedAt ?? null,
    ...(result.saved ? {} : { notice: result.notice || "This result could not be saved. It is shown here until you leave this page." }),
  };
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
      if (!key) return IDLE_CHECK;
      return entries.get(key)?.state || LOADING_CHECK;
    },

    /**
     * Reads the saved result (free; never runs a check). Skipped while a check is
     * running here or once a result is shown; `force` re-reads an idle or pending entry.
     */
    load(key: string | null, attemptId: string, loader: SavedPronunciationLoader, { force = false } = {}): Promise<void> {
      if (!key) return Promise.resolve();
      const entry = entries.get(key);
      if (entry?.loading) return entry.loading;
      if (entry?.running || entry?.state.status === "done" || entry?.state.status === "checking") return Promise.resolve();
      if (entry && !force && entry.state.status !== "loading") return Promise.resolve();
      if (!entry) set(key, LOADING_CHECK);
      const loading = loader(attemptId).then(
        (saved) => {
          const current = entries.get(key)?.state;
          // A check started meanwhile owns the entry.
          if (current?.status === "checking" || current?.status === "done") return;
          if (saved.status === "completed" && saved.check) set(key, doneState(saved.check));
          else if (saved.status === "running") set(key, { status: "pending", step: "assessing" });
          else if (current?.status === "error") return;
          else set(key, IDLE_CHECK);
        },
        () => {
          const current = entries.get(key)?.state;
          if (!current || current.status === "loading") set(key, { ...IDLE_CHECK, loadError: LOAD_ERROR });
        },
      ).finally(() => {
        const current = entries.get(key);
        if (current) delete current.loading;
      });
      entries.get(key)!.loading = loading;
      return loading;
    },

    /** Starts the check for this attempt unless it is already running, pending elsewhere or finished. */
    start(key: string | null, attemptId: string, run: PronunciationCheckRunner): Promise<void> {
      if (!key) return Promise.resolve();
      const entry = entries.get(key);
      if (entry?.running) return entry.running;
      if (entry?.state.status === "done" || entry?.state.status === "pending") return Promise.resolve();

      const controller = new AbortController();
      set(key, { status: "checking", step: "loading" });
      const running = run(attemptId, {
        signal: controller.signal,
        onStep: (step) => {
          const current = entries.get(key)?.state;
          if (current?.status === "checking") set(key, { ...current, step });
        },
      }).then(
        (result) => set(key, doneState(result)),
        (failure: unknown) => set(key, failure instanceof PronunciationCheckInProgressError
          ? { status: "pending", step: "assessing" }
          : {
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
