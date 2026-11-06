// M8 F1 daily login: the first authenticated use of the app each Philippine day. No UI.
// The server decides who earns it and enforces one award per day; this only avoids repeat calls
// from one tab. The date here is never sent.
const LEARNER_ROLES = new Set(["student", "general_user"]);

export const isDailyLoginRole = (role: string | null | undefined) => LEARNER_ROLES.has(role ?? "");

export const manilaDate = (at: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(at);

export function createDailyLoginClaimer(post: () => Promise<unknown>, now: () => Date = () => new Date()) {
  let claimed: string | null = null;
  let inFlight: Promise<void> | null = null;

  return function claim(userId: string): Promise<void> {
    if (inFlight) return inFlight;
    const key = `${userId}|${manilaDate(now())}`;
    if (claimed === key) return Promise.resolve();
    inFlight = post()
      .then(() => { claimed = key; })
      // Never affects sign-in or the page. The next visit or focus tries again.
      .catch(() => undefined)
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}
