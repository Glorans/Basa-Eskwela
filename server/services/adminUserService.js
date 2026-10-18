const {
  SupabaseAuthenticationError,
  getAuthenticatedSupabaseUser,
  getSupabaseAdmin,
} = require("./supabaseAdmin");

class AdminAuthorizationError extends Error {
  constructor(message = "Admin access is required.") {
    super(message);
    this.name = "AdminAuthorizationError";
    this.statusCode = 403;
  }
}

class AdminUserOperationError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "AdminUserOperationError";
    this.statusCode = statusCode;
  }
}

async function authorizeAdminRequest(req, dependencies = {}) {
  const authenticate = dependencies.getAuthenticatedSupabaseUser
    ?? getAuthenticatedSupabaseUser;
  const getAdmin = dependencies.getSupabaseAdmin ?? getSupabaseAdmin;
  const user = await authenticate(req);
  const { data: profile, error } = await getAdmin()
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    throw new SupabaseAuthenticationError();
  }

  if (profile.role !== "admin") {
    throw new AdminAuthorizationError();
  }

  return { user, profile };
}

async function listAllAuthUsers(supabase) {
  const users = [];
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new AdminUserOperationError("Unable to load user accounts.");
    }

    const pageUsers = data?.users ?? [];
    users.push(...pageUsers);

    if (pageUsers.length < perPage) break;
    page += 1;
  }

  return users;
}

async function listManagedUsers(dependencies = {}) {
  const getAdmin = dependencies.getSupabaseAdmin ?? getSupabaseAdmin;
  const supabase = getAdmin();
  const [authUsers, profileResult] = await Promise.all([
    listAllAuthUsers(supabase),
    supabase
      .from("profiles")
      .select("id, full_name, nickname, role, status, created_at, teacher_status")
      .order("created_at", { ascending: false }),
  ]);

  if (profileResult.error) {
    throw new AdminUserOperationError("Unable to load user profiles.");
  }

  const profiles = profileResult.data ?? [];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const authIds = new Set(authUsers.map((user) => user.id));
  const users = authUsers.map((authUser) => {
    const profile = profileById.get(authUser.id);
    return {
      id: authUser.id,
      email: authUser.email ?? null,
      fullName: profile?.full_name ?? "",
      nickname: profile?.nickname ?? "",
      role: profile?.role ?? "",
      status: profile?.status ?? "",
      teacherStatus: profile?.teacher_status ?? null,
      createdAt: profile?.created_at ?? authUser.created_at,
    };
  });

  for (const profile of profiles) {
    if (!authIds.has(profile.id)) {
      users.push({
        id: profile.id,
        email: null,
        fullName: profile.full_name,
        nickname: profile.nickname ?? "",
        role: profile.role,
        status: profile.status,
        teacherStatus: profile.teacher_status ?? null,
        createdAt: profile.created_at,
      });
    }
  }

  return users.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function deleteManagedUser(requesterId, userId, dependencies = {}) {
  if (requesterId === userId) {
    throw new AdminUserOperationError(
      "You cannot delete your currently signed-in Admin account.",
      409,
    );
  }

  const getAdmin = dependencies.getSupabaseAdmin ?? getSupabaseAdmin;
  const supabase = getAdmin();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new AdminUserOperationError("Unable to verify the selected user's role.");
  }

  if (profile?.role === "admin") {
    throw new AdminUserOperationError(
      "Admin accounts cannot be deleted through User Management.",
      409,
    );
  }

  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    throw new AdminUserOperationError(
      "This account could not be deleted. It may still own protected learning or content records.",
      409,
    );
  }
}

module.exports = {
  AdminAuthorizationError,
  AdminUserOperationError,
  authorizeAdminRequest,
  deleteManagedUser,
  listManagedUsers,
};
