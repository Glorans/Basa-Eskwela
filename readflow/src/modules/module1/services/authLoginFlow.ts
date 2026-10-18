import type { AuthProfile } from "./authProfile.ts";

const LOGIN_FLOW_ERROR_MESSAGE =
  "We couldn't sign in or load your account. Please try again.";

interface PasswordSignInResult {
  data: { user: { id: string } | null };
  error: { message: string } | null;
}

export interface LoginFlowDependencies {
  login: (email: string, password: string) => Promise<PasswordSignInResult>;
  getProfile: (userId: string) => Promise<AuthProfile>;
  resolveDestination: (profile: AuthProfile) => Promise<string>;
}

export class LoginFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginFlowError";
  }
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
    throw new LoginFlowError(signInResult.error.message);
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
