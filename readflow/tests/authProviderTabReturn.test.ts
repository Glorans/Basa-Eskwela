import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, loadComponentModule, tick } from "./helpers/hookRuntime.ts";

// supabase-js re-emits SIGNED_IN for the same user each time a hidden tab becomes
// visible. That must not reset auth loading: RequireAuth renders nothing while
// loading, which unmounted protected pages and erased unsaved form work. Role and
// approval changes must still be picked up (in the background).

const require = createRequire(import.meta.url);
const providerUrl = new URL("../src/auth/AuthProvider.tsx", import.meta.url);

type Profile = { id: string; role: string; nickname: string; full_name: string; teacher_status?: string };

function mount(profileFor: (userId: string, call: number) => Profile | Error = (id) => ({ id, role: "admin", nickname: "A", full_name: "Admin" })) {
  let emit: (event: string, session: unknown) => void = () => {};
  const profileCalls: string[] = [];
  const runtime = createHookRuntime(require("react"));
  const admin = { id: "admin-1" };
  const module = loadComponentModule(providerUrl, (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith("/lib/supabaseClient")) {
      return {
        supabase: {
          auth: {
            onAuthStateChange: (callback: typeof emit) => {
              emit = callback;
              return { data: { subscription: { unsubscribe() {} } } };
            },
            getUser: async () => ({ data: { user: admin }, error: null }),
          },
        },
      };
    }
    if (id.endsWith("/authProfile")) {
      return {
        getAuthProfile: async (userId: string) => {
          profileCalls.push(userId);
          const result = profileFor(userId, profileCalls.length);
          if (result instanceof Error) throw result;
          return result;
        },
      };
    }
    if (id.endsWith("/services/api")) return { default: { post: async () => ({}) } };
    if (id.endsWith("/authHeaders")) return { getSessionAuthHeaders: async () => ({}) };
    if (id.endsWith("/dailyLoginClaim")) return { createDailyLoginClaimer: () => async () => {}, isDailyLoginRole: () => false };
    if (id.endsWith("/recoverySession")) {
      return {
        blocksDailyLogin: () => false, clearPasswordRecovery() {}, confirmPasswordRecovery() {}, isPasswordRecoveryMarked: () => false,
        isPasswordRecoveryPending: () => false, isResetPasswordPath: () => false, onPasswordRecoveryChange: () => () => {},
      };
    }
    return require(id);
  }, { window: { setTimeout } });

  const value = () => runtime.render(module.AuthProvider, { children: null }).props.value;
  return { value, emit: (event: string, session: unknown) => emit(event, session), profileCalls, admin };
}

const settle = async () => { for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 5)); await tick(); await tick(); } };

async function signedIn(auth: ReturnType<typeof mount>) {
  auth.value();
  await settle();
  assert.equal(auth.value().loading, false);
  assert.equal(auth.value().profile.id, "admin-1");
}

test("returning to the tab (same-user SIGNED_IN) never shows loading and keeps the profile", async () => {
  const auth = mount();
  await signedIn(auth);
  for (let i = 0; i < 3; i++) {
    auth.emit("SIGNED_IN", { user: { ...auth.admin } });
    const now = auth.value();
    assert.equal(now.loading, false, "protected pages must stay mounted");
    assert.equal(now.profile?.id, "admin-1");
    await settle();
    assert.equal(auth.value().loading, false);
    assert.equal(auth.value().profile.role, "admin");
  }
});

test("a role or approval change is picked up in the background on tab return", async () => {
  const auth = mount((id, call) => call === 1
    ? { id, role: "teacher", nickname: "T", full_name: "Teacher", teacher_status: "pending" }
    : { id, role: "teacher", nickname: "T", full_name: "Teacher", teacher_status: "approved" });
  auth.value();
  await settle();
  assert.equal(auth.value().profile.teacher_status, "pending");
  auth.emit("SIGNED_IN", { user: { ...auth.admin } });
  assert.equal(auth.value().loading, false);
  await settle();
  assert.equal(auth.value().profile.teacher_status, "approved", "stale approval/role is not kept");
  assert.equal(auth.value().loading, false);
});

test("a failed background refresh keeps the loaded profile instead of signing the user out", async () => {
  const auth = mount((id, call) => call === 1 ? { id, role: "admin", nickname: "A", full_name: "Admin" } : new Error("offline"));
  await signedIn(auth);
  auth.emit("SIGNED_IN", { user: { ...auth.admin } });
  await settle();
  const now = auth.value();
  assert.equal(now.profile.id, "admin-1");
  assert.equal(now.profileError, false);
  assert.equal(now.loading, false);
});

test("a different user signing in reloads the profile; sign-out clears access immediately", async () => {
  const auth = mount();
  await signedIn(auth);

  auth.emit("SIGNED_IN", { user: { id: "admin-2" } });
  assert.equal(auth.value().loading, true, "the previous user's profile is not shown for the new user");
  assert.equal(auth.value().profile, null);
  await settle();
  assert.equal(auth.value().profile.id, "admin-2");

  auth.emit("SIGNED_OUT", null);
  const out = auth.value();
  assert.equal(out.user, null);
  assert.equal(out.profile, null);
  assert.equal(out.loading, false);
});

test("an expired session (SIGNED_OUT or no session on return) clears access", async () => {
  const auth = mount();
  await signedIn(auth);
  auth.emit("TOKEN_REFRESHED", null); // refresh failed: supabase reports no session
  assert.equal(auth.value().user, null);
  assert.equal(auth.value().profile, null);
});

test("token refresh keeps the session and profile without reloading", async () => {
  const auth = mount();
  await signedIn(auth);
  const calls = auth.profileCalls.length;
  auth.emit("TOKEN_REFRESHED", { user: { ...auth.admin, refreshed: true } });
  await settle();
  const now = auth.value();
  assert.equal(now.loading, false);
  assert.equal(now.user.refreshed, true);
  assert.equal(now.profile.id, "admin-1");
  assert.equal(auth.profileCalls.length, calls, "no profile request on token refresh");
});

test("same-user SIGNED_IN still loads the profile when it never loaded", async () => {
  const auth = mount();
  auth.value();
  auth.emit("SIGNED_IN", { user: { id: "admin-1" } });
  await settle();
  assert.equal(auth.value().profile.id, "admin-1");
  assert.equal(auth.value().loading, false);
});
