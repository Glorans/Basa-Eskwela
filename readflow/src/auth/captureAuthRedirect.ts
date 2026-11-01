// Imported first in main.tsx: runs before the Supabase client and the router read the address.
import { captureAuthRedirect } from "./authRedirect.ts";

captureAuthRedirect();
