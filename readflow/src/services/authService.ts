import { supabase } from "../lib/supabaseClient.ts";
import { normalizeAuthEmail } from "../modules/module1/utils/authOnboarding.ts";

export class AuthServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthServiceError";
  }
}

function throwIfAuthError(error: { message: string } | null) {
  if (error) {
    throw new AuthServiceError(error.message);
  }
}

export async function register(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email: normalizeAuthEmail(email),
    password,
  });

  throwIfAuthError(error);
  return { hasSession: Boolean(data.session) };
}

export function login(email: string, password: string) {
  return supabase.auth.signInWithPassword({
    email: normalizeAuthEmail(email),
    password,
  });
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  return !error;
}

export async function requestPasswordReset(email: string, redirectTo: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    normalizeAuthEmail(email),
    { redirectTo },
  );

  throwIfAuthError(error);
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  throwIfAuthError(error);
}

export async function updateEmail(email: string) {
  const { error } = await supabase.auth.updateUser({
    email: normalizeAuthEmail(email),
  });
  throwIfAuthError(error);
}
