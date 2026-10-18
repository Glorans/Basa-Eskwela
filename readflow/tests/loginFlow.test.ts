import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getLoginErrorMessage,
  LoginFlowError,
  runLoginFlow,
} from "../src/modules/module1/services/authLoginFlow.ts";
import type { AuthProfile } from "../src/modules/module1/services/authProfile.ts";
import { resolveUserDestination } from "../src/modules/module1/utils/authOnboarding.ts";

const userId = "11111111-1111-4111-8111-111111111111";

function profile(overrides: Partial<AuthProfile>): AuthProfile {
  return {
    id: userId,
    full_name: "",
    nickname: null,
    age: null,
    role: null,
    teacher_status: null,
    status: "active",
    created_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function loginDependencies(
  authProfile: AuthProfile,
  hasCompletedDiagnostic = false,
) {
  return {
    async login(email: string, password: string) {
      assert.equal(email, "  USER@Example.com ");
      assert.equal(password, "Password1!");
      return { data: { user: { id: userId } }, error: null };
    },
    async getProfile(receivedUserId: string) {
      assert.equal(receivedUserId, userId);
      return authProfile;
    },
    async resolveDestination(receivedProfile: AuthProfile) {
      assert.equal(receivedProfile, authProfile);
      return resolveUserDestination({
        role: receivedProfile.role,
        nickname: receivedProfile.nickname,
        fullName: receivedProfile.full_name,
        hasCompletedDiagnostic,
        teacherStatus: receivedProfile.teacher_status,
      });
    },
  };
}

async function resolveLogin(
  authProfile: AuthProfile,
  hasCompletedDiagnostic = false,
) {
  return runLoginFlow(
    "  USER@Example.com ",
    "Password1!",
    loginDependencies(authProfile, hasCompletedDiagnostic),
  );
}

test("valid Admin login resolves to the Admin destination", async () => {
  assert.equal(await resolveLogin(profile({ role: "admin" })), "/m3/admin");
});

test("valid Teacher login resolves to the Teacher destination", async () => {
  assert.equal(
    await resolveLogin(profile({ role: "teacher", full_name: "Teacher Name", teacher_status: "approved" })),
    "/m3/teacher",
  );
});

test("login with a NULL role resolves to Role Selection", async () => {
  assert.equal(await resolveLogin(profile({ role: null })), "/select-role");
});

test("login with an incomplete role-specific profile resolves to Profile Setup", async () => {
  assert.equal(
    await resolveLogin(profile({ role: "student", nickname: null })),
    "/setup-profile",
  );
  assert.equal(
    await resolveLogin(profile({ role: "teacher", full_name: "" })),
    "/setup-profile",
  );
});

test("learner without an initial diagnostic resolves to the diagnostic", async () => {
  assert.equal(
    await resolveLogin(profile({ role: "student", nickname: "Reader" })),
    "/diagnostic",
  );
});

test("completed Student resolves to the student dashboard", async () => {
  assert.equal(
    await resolveLogin(profile({ role: "student", nickname: "Reader" }), true),
    "/dashboard",
  );
});

test("completed Independent Learner resolves to the general learner area", async () => {
  assert.equal(
    await resolveLogin(profile({ role: "general_user", nickname: "Reader" }), true),
    "/m3/general",
  );
});

test("invalid credentials return a displayable authentication error", async () => {
  let profileLoaded = false;

  await assert.rejects(
    () => runLoginFlow(
      "user@example.com",
      "wrong-password",
      {
        async login() {
          return {
            data: { user: null },
            error: { message: "Invalid login credentials" },
          };
        },
        async getProfile() {
          profileLoaded = true;
          return profile({});
        },
        async resolveDestination() {
          return "/";
        },
      },
    ),
    (error) => {
      assert.equal(getLoginErrorMessage(error), "Invalid login credentials");
      return error instanceof LoginFlowError;
    },
  );

  assert.equal(profileLoaded, false);
});

test("LoginPage delegates authentication and routing to the shared login service", async () => {
  const [page, service] = await Promise.all([
    readFile(new URL("../src/modules/module1/pages/LoginPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/module1/services/authLogin.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /loginAndResolveDestination\(email, password\)/);
  assert.match(page, /navigate\(destination, \{ replace: true \}\)/);
  assert.doesNotMatch(page, /supabase|signInWithPassword|getAuthProfile|getPostAuthenticationPath/);
  assert.match(service, /getAuthProfile/);
  assert.match(service, /getPostAuthenticationPath/);
});
