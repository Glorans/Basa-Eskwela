const express = require("express");
const {
  AdminAuthorizationError,
  AdminUserOperationError,
  authorizeAccountManager,
  createSchoolAdmin,
  listManagedUsers,
  setManagedUserStatus,
} = require("../services/adminUserService");
const { describePermissions } = require("../services/m1AccountScope");
const {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
} = require("../services/supabaseAdmin");

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sendAdminError(res, error) {
  if (error instanceof SupabaseAuthenticationError) {
    return res.status(401).json({ success: false, message: error.message });
  }

  if (error instanceof AdminAuthorizationError || error instanceof AdminUserOperationError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }

  if (error instanceof SupabaseServerConfigurationError) {
    return res.status(503).json({ success: false, message: error.message });
  }

  console.error("Unexpected Admin user-management failure:", error);
  return res.status(500).json({
    success: false,
    message: "Unable to complete the user-management request.",
  });
}

// M1 F6 (view user roles), F7 (deactivate/reactivate user account; delete) and F8 (create School Admin account).
// System Admin and School Admin only; every scope rule is enforced here, on the server.
function createAdminUsersRouter(dependencies = {}) {
  const router = express.Router();
  const authorize = dependencies.authorizeAccountManager ?? authorizeAccountManager;
  const listUsers = dependencies.listManagedUsers ?? listManagedUsers;
  const createAdmin = dependencies.createSchoolAdmin ?? createSchoolAdmin;
  const setStatus = dependencies.setManagedUserStatus ?? setManagedUserStatus;
  const invitations = () => require("../services/schoolAdminInvitations");
  const resendInvitation = dependencies.resendSchoolAdminInvitation ?? ((actor, id) => invitations().resendSchoolAdminInvitation(actor, id));
  const cancelInvitation = dependencies.cancelSchoolAdminInvitation ?? ((actor, id, reason) => invitations().cancelSchoolAdminInvitation(actor, id, reason));

  router.get("/", async (req, res) => {
    try {
      const { profile } = await authorize(req);
      return res.json({
        success: true,
        users: await listUsers(undefined, profile.role, profile.school_id ?? null),
        permissions: describePermissions(profile.role),
      });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // Routine permanent deletion is disabled (M1 F7 replaced it with reversible Deactivate/Reactivate). Deleting an
  // Auth user cascades to diagnostic, oral reading, comprehension and achievement records, so this route answers 410
  // for every caller and every ID, before any lookup, and never reaches auth.admin.deleteUser(). A legitimate
  // account/data-deletion request needs its own separately approved process (see deleteManagedUser).
  router.delete("/:userId", (_req, res) => res.status(410).json({
    success: false,
    message: "Permanent account deletion is disabled. Use Deactivate instead; it keeps the account and its records.",
  }));

  // F7 Deactivate (status "inactive") / Reactivate (status "active"). Scope, self and System Admin protection are
  // re-checked on the server; the browser's account list is never trusted.
  router.patch("/:userId/status", async (req, res) => {
    try {
      const { user, profile } = await authorize(req);
      if (!uuidPattern.test(req.params.userId)) {
        return res.status(400).json({ success: false, message: "Invalid user ID." });
      }
      const account = await setStatus(user.id, req.params.userId, req.body?.status, undefined, profile.role, profile.school_id ?? null);
      return res.json({
        success: true,
        account,
        message: account.status === "inactive" ? "Account deactivated." : "Account reactivated.",
      });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // F8: a System Admin records the authorization and invites a School Admin. The account has NO School Admin
  // access until the invitee accepts (database-enforced). The body never sets a role.
  router.post("/school-admins", async (req, res) => {
    try {
      const { user, profile } = await authorize(req);
      if (!describePermissions(profile.role)?.canCreateSchoolAdmin) {
        throw new AdminAuthorizationError("Only a System Admin can create School Admin accounts.");
      }
      const account = await createAdmin(
        { email: req.body?.email, fullName: req.body?.fullName, schoolId: req.body?.schoolId, authorization: req.body?.authorization },
        undefined,
        { userId: user.id },
      );
      return res.status(201).json({
        success: true,
        account,
        message: account.setupEmailSent
          ? "Authorization recorded and invitation sent. The account gets School Admin access only after the invitee accepts."
          : "Authorization recorded, but the invitation email could not be sent. Use Resend invitation.",
      });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  // Resend / cancel a pending School Admin invitation (System Admin only; re-checked in the database).
  for (const [action, run] of [["resend", resendInvitation], ["cancel", cancelInvitation]]) {
    router.post(`/school-admins/invitations/:invitationId/${action}`, async (req, res) => {
      try {
        const { user, profile } = await authorize(req);
        if (!describePermissions(profile.role)?.canCreateSchoolAdmin) {
          throw new AdminAuthorizationError("Only a System Admin can manage School Admin invitations.");
        }
        if (!uuidPattern.test(req.params.invitationId)) {
          return res.status(400).json({ success: false, message: "Invalid invitation ID." });
        }
        const result = await run(user.id, req.params.invitationId, req.body?.reason);
        return res.json({
          success: true,
          invitation: result,
          message: action === "cancel" ? "Invitation cancelled. It can no longer be used."
            : result.setupEmailSent
              ? "A new setup link was sent. The invitation stays open for 7 days; the emailed link itself may expire sooner."
              : "The invitation stays open for 7 more days, but the email could not be sent. Try Resend again.",
        });
      } catch (error) {
        return sendAdminError(res, error);
      }
    });
  }

  return router;
}

module.exports = {
  adminUsersRouter: createAdminUsersRouter(),
  createAdminUsersRouter,
};
