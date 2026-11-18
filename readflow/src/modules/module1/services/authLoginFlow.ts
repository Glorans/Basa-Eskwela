import type { AuthProfile } from "./authProfile.ts";

const LOGIN_FLOW_ERROR_MESSAGE =
  "We couldn't sign in or load your account. Please try again.";

// M1 F7: Supabase Auth refuses a deactivated (banned) account with "user_banned".
export const DEACTIVATED_ACCOUNT_MESSAGE = "This account has been deactivated. Contact your administrator.";

interface PasswordSignInResult {
  data: { user: { id: string } | null };
  error: { message: string; code?: string } | null;
}

export interface LoginFlowDependencies {
  login: (email: string, password: string) => Promise<PasswordSignInResult>;
  getProfile: (userId: string) => Promise<AuthProfile>;
  resolveDestination: (profile: AuthProfile) => Promise<string>;
}

export class LoginFlowError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "LoginFlowError";
    this.code = code;
  }
}

/** Supabase reports this only after the password matched, so it reveals nothing new. */
export function isEmailNotConfirmedError(error: unknown) {
  return error instanceof LoginFlowError
    && (error.code === "email_not_confirmed" || /^email not confirmed$/i.test(error.message));
}

export async function runLoginFlow(
  email: string,
  password: string,
  dependencies: LoginFlowDependencies,
) {
  let signInResult: PasswordSignInResult;

  try {
    signInResult = await dependencies.login(email, password);
  } catch {
    throw new LoginFlowError(LOGIN_FLOW_ERROR_MESSAGE);
  }

  if (signInResult.error) {
    if (signInResult.error.code === "user_banned" || /^user is banned$/i.test(signInResult.error.message)) {
      throw new LoginFlowError(DEACTIVATED_ACCOUNT_MESSAGE, "user_banned");
    }
    throw new LoginFlowError(signInResult.error.message, signInResult.error.code);
  }

  if (!signInResult.data.user) {
    throw new LoginFlowError(LOGIN_FLOW_ERROR_MESSAGE);
  }

  try {
    const profile = await dependencies.getProfile(signInResult.data.user.id);
    return await dependencies.resolveDestination(profile);
  } catch {
    throw new LoginFlowError(LOGIN_FLOW_ERROR_MESSAGE);
  }
}

export function getLoginErrorMessage(error: unknown) {
  return error instanceof LoginFlowError
    ? error.message
    : LOGIN_FLOW_ERROR_MESSAGE;
}
