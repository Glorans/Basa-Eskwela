const DEV_API_URL = "http://localhost:5000";

interface ApiUrlEnv {
  VITE_API_URL?: string;
  DEV?: boolean;
}

// Only development builds may fall back to the local backend; production
// builds must be given VITE_API_URL explicitly.
export function resolveApiUrl(env: ApiUrlEnv): string {
  if (env.VITE_API_URL) return env.VITE_API_URL;
  if (env.DEV) return DEV_API_URL;
  throw new Error("VITE_API_URL is not set");
}

export function getApiUrl(): string {
  return resolveApiUrl(import.meta.env);
}
