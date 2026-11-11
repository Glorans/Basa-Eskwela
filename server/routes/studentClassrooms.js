const express = require("express");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");
const { StudentRoomTeachersError, listEnrolledRoomTeachers } = require("../services/studentRoomTeachers");

// M4 Student Learning Rooms. Session-derived identity only; no client-supplied user or room ids.
function createStudentClassroomsRouter(dependencies = {}) {
  const router = express.Router();
  router.get("/teachers", async (req, res) => {
    try {
      return res.json({ success: true, rooms: await listEnrolledRoomTeachers(req, dependencies) });
    } catch (error) {
      if (error instanceof SupabaseAuthenticationError) return res.status(401).json({ success: false, message: error.message });
      if (error instanceof StudentRoomTeachersError) {
        if (error.statusCode >= 500) console.error("M4 student room teachers failed:", error.message);
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      console.error("M4 student room teachers failed:", error?.message);
      return res.status(500).json({ success: false, message: "Unable to load teacher names." });
    }
  });
  return router;
}

module.exports = { createStudentClassroomsRouter };
