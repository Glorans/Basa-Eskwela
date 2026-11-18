const express = require("express");
const { AdminUserOperationError } = require("../services/adminUserService");
const { SupabaseAuthenticationError, SupabaseServerConfigurationError, getAuthenticatedSupabaseUser } = require("../services/supabaseAdmin");

function bearer(req) {
  const match = String(req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function sendError(res, error) {
  if (error instanceof SupabaseAuthenticationError) return res.status(401).json({ success: false, message: error.message });
  if (error instanceof AdminUserOperationError) return res.status(error.statusCode).json({ success: false, message: error.message });
  if (error instanceof SupabaseServerConfigurationError) return res.status(503).json({ success: false, message: error.message });
  console.error("[M1 invitation] unexpected failure:", error?.message);
  return res.status(500).json({ success: false, message: "Unable to complete the invitation request." });
}

// The signed-in user's OWN School Admin invitation. Identity comes only from the verified access token; the
// account id is never taken from the request. Acceptance is re-checked in m1_accept_school_admin_invitation.
function createAccountInvitationRouter(dependencies = {}) {
  const router = express.Router();
  const authenticate = dependencies.getAuthenticatedSupabaseUser ?? getAuthenticatedSupabaseUser;
  const service = () => dependencies.invitations ?? require("../services/schoolAdminInvitations");

  router.get("/school-admin-invitation", async (req, res) => {
    try {
      const user = await authenticate(req);
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, invitation: await service().ownInvitationState(user) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/school-admin-invitation/accept", async (req, res) => {
    try {
      const user = await authenticate(req);
      const result = await service().acceptSchoolAdminInvitation(user, bearer(req));
      return res.json({ success: true, ...result, message: "Invitation accepted. Sign in to open your School Admin workspace." });
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}

module.exports = { accountInvitationRouter: createAccountInvitationRouter(), createAccountInvitationRouter };
