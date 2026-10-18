import {
  getAuthProfile,
  getPostAuthenticationPath,
} from "./authProfile.ts";
import { runLoginFlow } from "./authLoginFlow.ts";
import { login } from "../../../services/authService.ts";

export {
  getLoginErrorMessage,
  LoginFlowError,
} from "./authLoginFlow.ts";

export function loginAndResolveDestination(email: string, password: string) {
  return runLoginFlow(email, password, {
    login,
    getProfile: getAuthProfile,
    resolveDestination: getPostAuthenticationPath,
  });
}
