const express = require("express");
const { authorizeAdminRequest, AdminAuthorizationError, AdminUserOperationError } = require("../services/adminUserService");
const { SupabaseAuthenticationError, SupabaseServerConfigurationError } = require("../services/supabaseAdmin");
const service = require("../services/teacherInvitationService");

function createTeacherInvitationsRouter(deps = {}) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
    try { req.m1Requester = await authorizeAdminRequest(req, deps); next(); }
    catch (error) { sendError(res, error); }
  });
  router.get("/", async (req, res) => {
    try { res.json({ invitations: await service.listTeacherInvitations(deps, req.m1Requester) }); }
    catch (error) { sendError(res, error); }
  });
  router.post("/", async (req, res) => {
    try { res.status(201).json(await service.createTeacherInvitation(req.body, deps, req.m1Requester)); }
    catch (error) { sendError(res, error); }
  });
  router.post("/:id/revoke", async (req, res) => {
    try { res.json({ invitation: await service.revokeTeacherInvitation(req.params.id, deps, req.m1Requester) }); }
    catch (error) { sendError(res, error); }
  });
  return router;
}
function sendError(res, error) {
  if (error instanceof SupabaseAuthenticationError) return res.status(401).json({ message: error.message });
  if (error instanceof AdminAuthorizationError || error instanceof AdminUserOperationError || error?.name === "SchoolScopeError") return res.status(error.statusCode).json({ message: error.message });
  if (error instanceof SupabaseServerConfigurationError) return res.status(503).json({ message: "Invitation management is not configured." });
  // Do not log request/response bodies, secrets or nested provider errors.
  return res.status(500).json({ message: "Unable to manage teacher invitations. Refresh the list before retrying." });
}
module.exports = { createTeacherInvitationsRouter };
