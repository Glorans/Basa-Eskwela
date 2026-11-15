const { getSupabaseAdmin } = require("./supabaseAdmin");
const { getProfileDisplayName } = require("./profileNames");
const {
  AdminAuthorizationError,
  AdminUserOperationError,
  listManagedUsers,
} = require("./adminUserService");
const { canViewAccount } = require("./m1AccountScope");

// Diagnostics belong to learners. Which learners a viewer sees follows the M1 account scope: a School Admin sees
// Students only, never Independent Learners (Appendix N; the School Admin manages only Teachers and Students).
const DIAGNOSTIC_LEARNER_ROLES = new Set(["student", "general_user"]);

async function listDiagnosticResultRows(supabase) {
  const { data, error } = await supabase
    .from("diagnostic_results")
    .select(
      "id, user_id, assessment_type, language, orv_score, comprehension_score, reading_speed_wpm, reading_level, difficulty_tier, completed_at, verification_status",
    )
    .eq("assessment_type", "initial")
    .order("completed_at", { ascending: false });

  if (error) {
    throw new AdminUserOperationError("Unable to load diagnostic results.");
  }

  return data ?? [];
}

async function listAdminDiagnosticResults(dependencies = {}, viewerRole) {
  if (viewerRole !== "admin") throw new AdminAuthorizationError();
  const getAdmin = dependencies.getSupabaseAdmin ?? getSupabaseAdmin;
  const listUsers = dependencies.listManagedUsers ?? listManagedUsers;
  const listRows = dependencies.listDiagnosticResultRows ?? listDiagnosticResultRows;
  const supabase = getAdmin();
  const [users, rows] = await Promise.all([
    listUsers({ getSupabaseAdmin: getAdmin }, viewerRole),
    listRows(supabase),
  ]);
  const userById = new Map(users.map((user) => [user.id, user]));

  return rows.flatMap((row) => {
    const user = userById.get(row.user_id);

    // Checked again here, so an Independent Learner never appears even if the account list were wider.
    if (!user || !DIAGNOSTIC_LEARNER_ROLES.has(user.role) || !canViewAccount(viewerRole, user.role)) {
      return [];
    }

    return [{
      id: row.id,
      userId: row.user_id,
      learnerName: getProfileDisplayName(user),
      email: user.email,
      role: user.role,
      language: row.language,
      orvScore: row.orv_score,
      comprehensionScore: row.comprehension_score,
      readingSpeedWpm: row.reading_speed_wpm,
      readingLevel: row.reading_level,
      difficultyTier: row.difficulty_tier,
      completedAt: row.completed_at,
      // Rows written by the browser before DT1 stay 'unverified' (learner-controlled).
      verificationStatus: row.verification_status,
    }];
  });
}

module.exports = {
  listAdminDiagnosticResults,
  listDiagnosticResultRows,
};
