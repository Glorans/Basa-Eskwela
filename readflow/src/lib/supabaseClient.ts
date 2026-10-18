import { createClient } from "@supabase/supabase-js";
import type { ReadFlowDatabase } from "./database.types";

function requireEnv(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY"): string {
  const value = import.meta.env[name];
  if (!value) throw new Error(`${name} is not set. Add it to readflow/.env.local (see .env.example).`);
  return value;
}

const supabaseUrl = requireEnv("VITE_SUPABASE_URL");
const supabasePublishableKey = requireEnv("VITE_SUPABASE_PUBLISHABLE_KEY");

export const supabase = createClient<ReadFlowDatabase>(
  supabaseUrl,
  supabasePublishableKey,
);
