const { randomBytes, createHash } = require("node:crypto");
const { getSupabaseAdmin } = require("./supabaseAdmin");
const { AdminUserOperationError } = require("./adminUserService");

const COLUMNS = "id,active,created_at,expires_at,max_uses,use_count";
function invitationMetadata(row, now = Date.now()) {
  return { id: row.id, active: row.active, createdAt: row.created_at, expiresAt: row.expires_at,
    maxUses: row.max_uses, useCount: row.use_count,
    status: !row.active ? "revoked" : row.expires_at && Date.parse(row.expires_at) <= now ? "expired"
      : row.max_uses !== null && row.use_count >= row.max_uses ? "exhausted" : "active" };
}

async function listTeacherInvitations(deps = {}) {
  const db = deps.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const invitations = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db.from("teacher_invite_codes").select(COLUMNS)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 99);
    if (error) throw new AdminUserOperationError("Unable to load teacher invitations.");
    invitations.push(...(data ?? []).map(row => invitationMetadata(row)));
    if (!data || data.length < 100) return invitations;
  }
}

async function createTeacherInvitation(body, deps = {}) {
  const maxUses = body?.maxUses ?? 1;
  const expiresAt = body?.expiresAt;
  const expiry = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
  if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 2147483647) {
    throw new AdminUserOperationError("Maximum uses must be a positive whole number (up to 2147483647).", 400);
  }
  if (!Number.isFinite(expiry) || expiry <= Date.now() || new Date(expiry).toISOString() !== expiresAt) {
    throw new AdminUserOperationError("Choose a valid future expiration date and time.", 400);
  }
  const code = randomBytes(32).toString("base64url");
  const codeHash = createHash("sha256").update(code, "utf8").digest("hex");
  const db = deps.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const { data, error } = await db.from("teacher_invite_codes")
    .insert({ code_hash: codeHash, active: true, expires_at: expiresAt, max_uses: maxUses })
    .select(COLUMNS).single();
  // Never propagate database/provider error objects: they may contain submitted values.
  if (error || !data) throw new AdminUserOperationError("Unable to confirm invitation creation. Refresh the list before generating again; revoke any invitation whose code you did not receive.");
  return { invitation: invitationMetadata(data), code };
}

async function revokeTeacherInvitation(id, deps = {}) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new AdminUserOperationError("Invalid invitation ID.", 400);
  }
  const db = deps.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const { data, error } = await db.from("teacher_invite_codes").update({ active: false })
    .eq("id", id).select(COLUMNS).maybeSingle();
  if (error) throw new AdminUserOperationError("Unable to revoke the invitation. Refresh and retry.");
  if (!data) throw new AdminUserOperationError("Invitation not found.", 404);
  return invitationMetadata(data);
}

module.exports = { invitationMetadata, listTeacherInvitations, createTeacherInvitation, revokeTeacherInvitation };
