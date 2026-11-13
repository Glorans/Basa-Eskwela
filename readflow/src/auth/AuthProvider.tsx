import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthChangeEvent, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import {
  getAuthProfile,
  type AuthProfile,
} from "../modules/module1/services/authProfile";
import api from "../services/api";
import { getSessionAuthHeaders } from "../services/authHeaders";
import { createDailyLoginClaimer, isDailyLoginRole } from "../services/dailyLoginClaim";
import {
  blocksDailyLogin,
  clearPasswordRecovery,
  confirmPasswordRecovery,
  isPasswordRecoveryMarked,
  isPasswordRecoveryPending,
  isResetPasswordPath,
  onPasswordRecoveryChange,
} from "./recoverySession";

const claimDailyLogin = createDailyLoginClaimer(async () =>
  api.post("/api/m8/daily-login", undefined, {
    headers: await getSessionAuthHeaders("No active session."),
  }));

interface AuthState {
  user: User | null;
  profile: AuthProfile | null;
  loading: boolean;
  profileError: boolean;
  authEvent: AuthChangeEvent | null;
}

export interface AuthContextValue extends AuthState {
  role: AuthProfile["role"] | null;
  refreshProfile: () => Promise<AuthProfile | null>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const INITIAL_STATE: AuthState = {
  user: null,
  profile: null,
  loading: true,
  profileError: false,
  authEvent: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(INITIAL_STATE);
  // True while the session came from a password-reset link (see recoverySession.ts).
  const [recoverySession, setRecoverySession] = useState(isPasswordRecoveryMarked);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const userRef = useRef<User | null>(null);
  // Id of the user whose profile is currently loaded (null while loading or after an error).
  const profileUserIdRef = useRef<string | null>(null);

  const clearAuthState = useCallback((authEvent: AuthChangeEvent | null) => {
    requestIdRef.current += 1;
    userRef.current = null;
    profileUserIdRef.current = null;
    setState({
      user: null,
      profile: null,
      loading: false,
      profileError: false,
      authEvent,
    });
  }, []);

  const loadAuthenticatedUser = useCallback(
    (user: User, authEvent: AuthChangeEvent | null) => {
      const requestId = ++requestIdRef.current;
      userRef.current = user;
      profileUserIdRef.current = null;
      setState({
        user,
        profile: null,
        loading: true,
        profileError: false,
        authEvent,
      });

      void getAuthProfile(user.id)
        .then((profile) => {
          if (!mountedRef.current || requestId !== requestIdRef.current) return;
          profileUserIdRef.current = user.id;
          setState({ user, profile, loading: false, profileError: false, authEvent });
        })
        .catch(() => {
          if (!mountedRef.current || requestId !== requestIdRef.current) return;
          setState({ user, profile: null, loading: false, profileError: true, authEvent });
        });
    },
    [],
  );

  const refreshProfile = useCallback(async () => {
    const user = userRef.current;
    if (!user) {
      clearAuthState(null);
      return null;
    }

    const requestId = ++requestIdRef.current;
    setState((current) => ({ ...current, profileError: false }));

    try {
      const profile = await getAuthProfile(user.id);
      if (
        !mountedRef.current
        || requestId !== requestIdRef.current
        || userRef.current?.id !== user.id
      ) {
        return null;
      }

      profileUserIdRef.current = user.id;
      setState((current) => ({ ...current, user, profile, profileError: false }));
      return profile;
    } catch (error) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setState((current) => ({ ...current, profile: null, profileError: true }));
      }
      throw error;
    }
  }, [clearAuthState]);

  useEffect(() => {
    const stop = onPasswordRecoveryChange(() => setRecoverySession(isPasswordRecoveryMarked()));
    setRecoverySession(isPasswordRecoveryMarked());
    // A reset link was in this page's address. Supabase's own start-up result says whether it
    // accepted the link: on failure it keeps any existing (genuine) session, which must still
    // follow the normal M8 rule. Until then, and if this check itself fails, nothing is claimed.
    if (isPasswordRecoveryPending()) {
      void supabase.auth.initialize()
        .then(({ error }) => {
          if (!isPasswordRecoveryPending()) return;
          if (error) clearPasswordRecovery();
          else confirmPasswordRecovery();
        })
        .catch(() => {
          // Stays pending for this page load only (it is never stored).
        });
    }
    return stop;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    let authChangeHandled = false;

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      setState((current) => ({ ...current, authEvent: event }));
      // Also covers a reset link the address capture could not see (for example, the PKCE flow).
      // Supabase copies every auth event to the app's other tabs; those are not on the reset page
      // and saw no link, so they stay ordinary sessions.
      if (
        event === "PASSWORD_RECOVERY"
        && session?.user
        && (isPasswordRecoveryPending() || isResetPasswordPath(window.location.pathname))
      ) {
        confirmPasswordRecovery();
      }
      if (event === "INITIAL_SESSION") return;

      authChangeHandled = true;
      if (!session?.user || event === "SIGNED_OUT") {
        clearPasswordRecovery();
        clearAuthState(event);
        return;
      }

      // supabase-js re-emits SIGNED_IN for the same user whenever a hidden tab becomes
      // visible again. Treating that as a new sign-in reset `loading`, which unmounted
      // every protected page (and its unsaved form state) until the profile reloaded.
      const sameLoadedUser =
        event === "SIGNED_IN"
        && userRef.current?.id === session.user.id
        && profileUserIdRef.current === session.user.id;
      if (
        sameLoadedUser
        || ((event === "TOKEN_REFRESHED" || event === "USER_UPDATED")
          && userRef.current?.id === session.user.id)
      ) {
        userRef.current = session.user;
        setState((current) => ({
          ...current,
          user: session.user,
          authEvent: event,
        }));
        if (sameLoadedUser) {
          // Still pick up role/approval changes on tab return, but in the background:
          // the loaded profile stays in place (no loading state, nothing unmounts) and
          // is replaced only if it changed. Deferred like the full load below, because
          // Supabase calls inside this callback can wait on the auth lock.
          const user = session.user;
          const requestId = requestIdRef.current;
          window.setTimeout(() => {
            if (!mountedRef.current || requestId !== requestIdRef.current) return;
            void getAuthProfile(user.id)
              .then((profile) => {
                if (
                  !mountedRef.current
                  || requestId !== requestIdRef.current
                  || userRef.current?.id !== user.id
                ) return;
                setState((current) =>
                  JSON.stringify(current.profile) === JSON.stringify(profile)
                    ? current
                    : { ...current, profile, profileError: false });
              })
              .catch(() => {
                // Keep the loaded profile; the server still enforces every permission.
              });
          }, 0);
        }
        return;
      }

      // A different user signing in (for example, in another tab) replaces the reset session.
      if (event === "SIGNED_IN" && userRef.current && userRef.current.id !== session.user.id) {
        clearPasswordRecovery();
      }

      const requestId = ++requestIdRef.current;
      userRef.current = session.user;
      setState({
        user: session.user,
        profile: null,
        loading: true,
        profileError: false,
        authEvent: event,
      });

      window.setTimeout(() => {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        loadAuthenticatedUser(session.user, event);
      }, 0);
    });

    void supabase.auth.getUser()
      .then(({ data, error }) => {
        if (!active || !mountedRef.current || authChangeHandled) return;
        if (error || !data.user) {
          // Only a definite "no session" ends a recovery; a network failure keeps the flag.
          if (!error || error.name === "AuthSessionMissingError") clearPasswordRecovery();
          clearAuthState(null);
          return;
        }

        loadAuthenticatedUser(data.user, null);
      })
      .catch(() => {
        if (active && mountedRef.current && !authChangeHandled) {
          clearAuthState(null);
        }
      });

    return () => {
      active = false;
      mountedRef.current = false;
      requestIdRef.current += 1;
      authListener.subscription.unsubscribe();
    };
  }, [clearAuthState, loadAuthenticatedUser]);

  // M8 daily login. Returning to a tab left open overnight counts as the next day's first use.
  // A password-reset visit is not a sign-in: no claim in the tab that opened the link, or on the
  // reset page. It ends with sign-out, a password login or closing that tab, so the next genuine
  // use follows the normal rules.
  const signedInUserId = state.user?.id;
  const signedInRole = state.profile?.role;
  useEffect(() => {
    if (!signedInUserId || !isDailyLoginRole(signedInRole) || recoverySession) return;
    const claim = () => {
      if (document.visibilityState === "visible" && !blocksDailyLogin(window.location.pathname)) {
        void claimDailyLogin(signedInUserId);
      }
    };
    claim();
    document.addEventListener("visibilitychange", claim);
    return () => document.removeEventListener("visibilitychange", claim);
  }, [recoverySession, signedInRole, signedInUserId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      role: state.profile?.role ?? null,
      refreshProfile,
    }),
    [refreshProfile, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
