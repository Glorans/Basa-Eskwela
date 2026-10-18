const express = require("express");
const {
  AdminAuthorizationError,
  AdminUserOperationError,
  authorizeAdminRequest,
  deleteManagedUser,
  listManagedUsers,
} = require("../services/adminUserService");
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

function createAdminUsersRouter(dependencies = {}) {
  const router = express.Router();
  const authorize = dependencies.authorizeAdminRequest ?? authorizeAdminRequest;
  const listUsers = dependencies.listManagedUsers ?? listManagedUsers;
  const deleteUser = dependencies.deleteManagedUser ?? deleteManagedUser;

  router.get("/", async (req, res) => {
    try {
      await authorize(req);
      return res.json({ success: true, users: await listUsers() });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  router.delete("/:userId", async (req, res) => {
    try {
      const { user } = await authorize(req);
      if (!uuidPattern.test(req.params.userId)) {
        return res.status(400).json({ success: false, message: "Invalid user ID." });
      }

      await deleteUser(user.id, req.params.userId);
      return res.json({ success: true, message: "User account deleted." });
    } catch (error) {
      return sendAdminError(res, error);
    }
  });

  return router;
}

module.exports = {
  adminUsersRouter: createAdminUsersRouter(),
  createAdminUsersRouter,
};
