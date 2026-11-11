const { createClient } = require("@supabase/supabase-js");

class SupabaseServerConfigurationError extends Error {
  constructor() {
    super("Supabase persistence is not configured on the server.");
    this.name = "SupabaseServerConfigurationError";
  }
}

class SupabaseAuthenticationError extends Error {
  constructor() {
    super("Your session could not be verified. Please sign in again and retry.");
    this.name = "SupabaseAuthenticationError";
  }
}

let supabaseAdmin;

function getSupabaseAdmin() {
  if (supabaseAdmin) {
    return supabaseAdmin;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new SupabaseServerConfigurationError();
  }

  supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseAdmin;
}

function getBearerToken(req) {
  const authorization = req.get("authorization");

  if (typeof authorization !== "string") {
    throw new SupabaseAuthenticationError();
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const accessToken = match?.[1]?.trim();

  if (!accessToken) {
    throw new SupabaseAuthenticationError();
  }

  return accessToken;
}

async function getAuthenticatedSupabaseUser(req) {
  const accessToken = getBearerToken(req);
  const startedAt = performance.now();
  let result;
  try {
    result = await getSupabaseAdmin().auth.getUser(accessToken);
  } finally {
    // Server-Timing "auth" (services/requestTiming.js); a duration only.
    require("./requestTiming").recordAuthMs(performance.now() - startedAt);
  }
  const { data, error } = result;

  if (error || !data.user) {
    console.error("[M5 token verification failed]", {
      status: error?.status,
      code: error?.code,
      message: error?.message,
    });
    throw new SupabaseAuthenticationError();
  }

  return data.user;
}

module.exports = {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
  getAuthenticatedSupabaseUser,
  getSupabaseAdmin,
};
