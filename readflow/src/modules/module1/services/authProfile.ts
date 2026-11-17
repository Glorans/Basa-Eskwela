import type { Tables } from "../../../lib/database.types";
import { supabase } from "../../../lib/supabaseClient";
import { hasCompletedInitialDiagnostic } from "../../module2/services/diagnosticDatabase";
import {
  type AssignableUserRole,
  getOnboardingPath,
  getProfileNameValidationError,
  isAssignableUserRole,
  isDiagnosticLearnerRole,
  resolveUserDestination,
} from "../utils/authOnboarding";
import {
  getEditableProfileField,
  type EditableProfileField,
} from "../utils/profileFields";

export type AuthProfile = Pick<
  Tables<"profiles">,
  "id" | "full_name" | "nickname" | "role" | "status" | "created_at" | "teacher_status"
>;

export async function getAuthProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, nickname, role, status, created_at, teacher_status")
    .eq("id", userId)
    .single();

  if (error) {
    throw error;
  }

  return data satisfies AuthProfile;
}

/** Completes onboarding: learners save a nickname, Teachers a full name. Basa Eskwela does not collect age. */
export async function completeProfileSetup(userId: string, name: string) {
  const profile = await getAuthProfile(userId);
  const isLearner = isDiagnosticLearnerRole(profile.role);
  if (!isLearner && profile.role !== "teacher") {
    throw new Error("This role does not use profile setup.");
  }
  const normalizedName = name.trim();
  const nameError = getProfileNameValidationError(normalizedName, isLearner);
  if (nameError) throw new Error(nameError);

  const { error } = await supabase
    .from("profiles")
    .update(isLearner ? { nickname: normalizedName } : { full_name: normalizedName })
    .eq("id", userId)
    .select("id")
    .single();
  if (error) throw error;
}

async function assertProfileFieldEditable(
  userId: string,
  expectedField: EditableProfileField,
) {
  const profile = await getAuthProfile(userId);
  if (getEditableProfileField(profile.role) !== expectedField) {
    throw new Error("This profile field cannot be edited for the current role.");
  }
}

export async function updateNickname(userId: string, nickname: string) {
  await assertProfileFieldEditable(userId, "nickname");
  const { error } = await supabase
    .from("profiles")
    .update({ nickname })
    .eq("id", userId);

  if (error) {
    throw error;
  }
}

export async function updateFullName(userId: string, fullName: string) {
  await assertProfileFieldEditable(userId, "full_name");
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", userId);

  if (error) {
    throw error;
  }
}

export async function assignOwnRoleOnce(role: AssignableUserRole, inviteCode = "") {
  if (!isAssignableUserRole(role)) {
    throw new Error("This role cannot be selected during signup.");
  }

  if (role === "teacher") {
    const { data, error } = await supabase.rpc("register_teacher_with_invite", {
      invite_code: inviteCode.trim(),
    });
    if (error) throw error;
    if (!data) throw new Error("Invalid Teacher invite code.");
    return "teacher";
  }

  const { data, error } = await supabase.rpc("assign_own_role", {
    selected_role: role,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function getPostAuthenticationPath(profile: AuthProfile) {
  const onboardingPath = getOnboardingPath(
    profile.role,
    profile.nickname,
    profile.full_name,
  );

  const hasCompletedDiagnostic = !onboardingPath
    && isDiagnosticLearnerRole(profile.role)
    ? await hasCompletedInitialDiagnostic()
    : false;

  return resolveUserDestination({
    role: profile.role,
    nickname: profile.nickname,
    fullName: profile.full_name,
    hasCompletedDiagnostic,
    teacherStatus: profile.teacher_status,
  });
}
