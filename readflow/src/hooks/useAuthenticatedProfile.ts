import { useAuth } from "../auth/useAuth";
import type { AuthProfile } from "../modules/module1/services/authProfile";

interface AuthenticatedProfileState {
  profile: AuthProfile | null;
  loading: boolean;
  failed: boolean;
}

export default function useAuthenticatedProfile(): AuthenticatedProfileState {
  const { profile, loading, profileError } = useAuth();
  return { profile, loading, failed: profileError };
}
