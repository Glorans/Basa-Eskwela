import { supabase } from "../lib/supabaseClient";

// This session read obtains the latest JWT for an authenticated backend API
// request; UI authentication state remains owned by AuthProvider.
export async function getSessionAuthHeaders(failureMessage: string) {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error(failureMessage);
  }

  return { Authorization: `Bearer ${session.access_token}` };
}
