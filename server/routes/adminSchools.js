const express = require("express");
const { AdminAuthorizationError, AdminUserOperationError, authorizeSystemAdminRequest } = require("../services/adminUserService");
const { SupabaseAuthenticationError, SupabaseServerConfigurationError } = require("../services/supabaseAdmin");
const schools = require("../services/schoolService");

// M1 F8 Create School: System Admin only (role read from the database profile). School Admins, Teachers and learners
// are refused before anything is read.
function createAdminSchoolsRouter(deps = {}) {
  const router = express.Router();
  const authorize = deps.authorizeSystemAdminRequest ?? authorizeSystemAdminRequest;
  const service = { ...schools, ...(deps.schoolService ?? {}) };
  router.use(async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try { req.m1Requester = await authorize(req); next(); } catch (error) { send(res, error); }
  });
  router.get("/", async (_req, res) => {
    try { res.json({ success: true, schools: await service.listSchools(deps) }); } catch (error) { send(res, error); }
  });
  router.post("/", async (req, res) => {
    try {
      const school = await service.createSchool(req.m1Requester.user.id, req.body, deps);
      res.status(201).json({ success: true, school, message: "School created." });
    } catch (error) { send(res, error); }
  });
  router.patch("/:schoolId", async (req, res) => {
    try {
      const school = await service.updateSchool(req.m1Requester.user.id, req.params.schoolId, req.body, deps);
      res.json({ success: true, school, message: "School updated." });
    } catch (error) { send(res, error); }
  });
  return router;
}

function send(res, error) {
  if (error instanceof SupabaseAuthenticationError) return res.status(401).json({ success: false, message: error.message });
  if (error instanceof AdminAuthorizationError || error instanceof AdminUserOperationError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  if (error instanceof SupabaseServerConfigurationError) return res.status(503).json({ success: false, message: error.message });
  console.error("[M1 schools] unexpected failure:", error?.message);
  return res.status(500).json({ success: false, message: "Unable to complete the school request." });
}

module.exports = { createAdminSchoolsRouter };
