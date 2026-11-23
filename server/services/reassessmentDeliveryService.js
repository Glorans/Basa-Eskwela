// M2 F8 — Complete Reassessment for Students (classroom assignments) and Independent Learners (self-started from
// centrally approved Independent Learner packages). The learner's id comes from the verified session, never from the
// request. A Student only ever reaches classroom assignments; an Independent Learner only independent ones. Every read re-checks: assignment owned by this Student and active, the
// official reassessment gate ON, the Learning Room active and the Student still enrolled, and the exact assigned
// package version still published (a retired/withdrawn version or archived package is refused). F10 final workflow:
// no educator endorsement is required (the database rule is removed by m2_f10_direct_publish_PROPOSED.sql).
//
// Reuses the M2 diagnostic pipeline unchanged: signed transcript receipts (verifyReading), duration handling
// (resolveDuration) and the server scorer + thresholds (scoreDiagnostic, title-optional-v1). Receipts are bound to
//   assessment id      "m2-package-version:<version id>"    (never equal to a code-defined diagnostic id)
//   assessment version "assignment:<assignment id>"
//   passage hash       sha256 of this version's passage text
// so a receipt from another learner, language, assessment, version or assignment is refused.
// Answer keys never leave the server: content omits them and results report counts only.
const { createHash } = require("node:crypto");
const { DIAGNOSTIC_SCORING_RULE, classifyDiagnosticPlacement, scoreDiagnostic } = require("./diagnosticScoring");
const { DiagnosticSubmissionError, VERIFICATION_METHOD, resolveDuration, verifyReading } = require("./diagnosticResultService");

const REASSESSMENT_ASSESSMENT_PREFIX = "m2-package-version:";
const ASSIGNMENT_VERSION_PREFIX = "assignment:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHOICE_IDS = Object.freeze(["a", "b", "c", "d"]);
const NOT_INSTALLED_CODES = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);

class ReassessmentDeliveryError extends Error {
  constructor(message, statusCode = 500, code = "REASSESSMENT_FAILED") {
    super(message);
    this.name = "ReassessmentDeliveryError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
const fail = (message, statusCode, code) => { throw new ReassessmentDeliveryError(message, statusCode, code); };

async function run(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ReassessmentDeliveryError || error instanceof DiagnosticSubmissionError) throw error;
    if (NOT_INSTALLED_CODES.has(error?.code)) fail("Reassessment is not available yet.", 503, "REASSESSMENT_NOT_INSTALLED");
    fail("We couldn't load your reassessment. Please try again.", 500, "REASSESSMENT_FAILED");
  }
}

const isReassessmentAssessmentId = (value) => typeof value === "string" && value.startsWith(REASSESSMENT_ASSESSMENT_PREFIX);
const passageText = (version) => (Array.isArray(version.paragraphs) ? version.paragraphs : []).join(" ");
const passageHash = (version) => createHash("sha256").update(passageText(version)).digest("hex");
const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);
const finiteOrNull = (value) => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
};

/** Learner-facing reasons an assignment cannot be taken right now (no internal detail). */
const UNAVAILABLE = Object.freeze({
  REASSESSMENT_NOT_ENABLED: "Reassessments are not open yet. Please check again later.",
  ROOM_NOT_ACTIVE: "This reassessment is no longer available in your Learning Room. Ask your teacher.",
  VERSION_WITHDRAWN: "This reassessment is no longer available. Ask your teacher.",
});
// Independent Learners have no teacher or room: their messages never mention one.
const UNAVAILABLE_INDEPENDENT = Object.freeze({
  REASSESSMENT_NOT_ENABLED: "Reassessments are not open yet. Please check again later.",
  ROOM_NOT_ACTIVE: "This reassessment is no longer available.",
  VERSION_WITHDRAWN: "This reassessment is no longer available. You can choose another one when it opens.",
});
const unavailable = (reason, kind) => (kind === "independent" ? UNAVAILABLE_INDEPENDENT : UNAVAILABLE)[reason];
const LANGUAGE_NAMES = Object.freeze({ en: "English", fil: "Filipino" });
const manilaDay = (value) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric" }).format(new Date(value));

function createReassessmentDeliveryService({ repository, receipts, now = () => new Date().toISOString(),
  independentPilot = require("./independentPilot").parseIndependentPilot(undefined) } = {}) {
  if (!repository) throw new Error("A reassessment delivery repository is required.");
  // Pilot allow-list (default off): while on, only listed Independent Learners may START (see independentPilot.js).
  const pilotAllows = (userId) => !independentPilot.enabled || independentPilot.allows(userId);

  /** Students take classroom reassessments; Independent Learners take their own self-started ones. Nobody else. */
  function requireLearner(requester) {
    const role = requester?.profile?.role;
    if (!requester?.user?.id || (role !== "student" && role !== "general_user")) {
      fail("Reassessments are available to Students and Independent Learners.", 403, "REASSESSMENT_FORBIDDEN");
    }
    return { userId: requester.user.id, kind: role === "student" ? "classroom" : "independent" };
  }

  const loadGates = async () => {
    const s = await run(() => repository.getSettings());
    return {
      official: s?.official_reassessment_enabled === true,
      independent: s?.official_reassessment_enabled === true && s?.independent_learner_enabled === true,
      days: Number.isInteger(s?.independent_min_days_between) ? s.independent_min_days_between : null,
    };
  };

  /** Why an ACTIVE assignment cannot be delivered now, or null. Reads only server-side state. */
  async function blocker(assignment, context) {
    const gates = context.gates;
    if (!gates.official || (assignment.kind === "independent" && !gates.independent)) return "REASSESSMENT_NOT_ENABLED";
    if (assignment.kind === "classroom") {
      if (!assignment.room_id) return "ROOM_NOT_ACTIVE";
      const room = await run(() => repository.getRoom(assignment.room_id));
      if (!room || room.archived_at) return "ROOM_NOT_ACTIVE";
      if (!(await run(() => repository.isEnrolled(assignment.room_id, assignment.student_id)))) return "ROOM_NOT_ACTIVE";
    } else if (assignment.kind !== "independent" || assignment.room_id) {
      return "ROOM_NOT_ACTIVE";
    }
    const version = context.versions?.get(assignment.package_version_id) ?? await run(() => repository.getVersion(assignment.package_version_id));
    const pkg = context.packages?.get(assignment.package_id) ?? await run(() => repository.getPackage(assignment.package_id));
    const audience = assignment.kind === "independent" ? "independent_learners" : "classroom";
    if (!version || version.status !== "published" || !pkg || pkg.archived_at || pkg.kind !== "reassessment" || pkg.audience !== audience
      || version.package_id !== pkg.id || pkg.language !== assignment.language) return "VERSION_WITHDRAWN";
    return null;
  }

  const cancelledMessage = (kind) => (kind === "independent" ? "This reassessment was closed." : "This reassessment was cancelled by your teacher.");

  /** The assignment, version and package, only if THIS learner may take it now. */
  async function deliverable(userId, assignmentId, kind) {
    if (typeof assignmentId !== "string" || !UUID.test(assignmentId)) fail("Reassessment not found.", 404, "ASSIGNMENT_NOT_FOUND");
    const assignment = await run(() => repository.getAssignment(assignmentId));
    // Another learner's assignment, or one of the other kind (classroom vs independent), looks exactly like a missing one.
    if (!assignment || assignment.student_id !== userId || assignment.kind !== kind) fail("Reassessment not found.", 404, "ASSIGNMENT_NOT_FOUND");
    if (assignment.status === "cancelled") fail(cancelledMessage(kind), 409, "ASSIGNMENT_CANCELLED");
    if (assignment.status === "completed") fail("You already finished this reassessment.", 409, "ASSIGNMENT_COMPLETED");
    const version = await run(() => repository.getVersion(assignment.package_version_id));
    const pkg = await run(() => repository.getPackage(assignment.package_id));
    const reason = await blocker(assignment, { gates: await loadGates(), versions: new Map(version ? [[version.id, version]] : []), packages: new Map(pkg ? [[pkg.id, pkg]] : []) });
    if (reason) fail(unavailable(reason, kind), 409, reason);
    return { assignment, version, pkg };
  }

  const bindingFor = (assignment, version) => ({
    assessmentId: `${REASSESSMENT_ASSESSMENT_PREFIX}${version.id}`,
    assessmentVersion: `${ASSIGNMENT_VERSION_PREFIX}${assignment.id}`,
    passageHash: passageHash(version),
  });

  async function listMine(requester) {
    const { userId, kind } = requireLearner(requester);
    const assignments = (await run(() => repository.listMyAssignments(userId, kind))).filter((a) => a.status !== "cancelled");
    const gates = await loadGates();
    const enabled = kind === "independent" ? gates.independent : gates.official;
    const [packages, versions, rooms, results] = await Promise.all([
      run(() => repository.loadPackages([...new Set(assignments.map((a) => a.package_id))])),
      run(() => repository.loadVersions([...new Set(assignments.map((a) => a.package_version_id))])),
      run(() => repository.loadRooms([...new Set(assignments.map((a) => a.room_id).filter(Boolean))])),
      run(() => repository.loadResults(assignments.map((a) => a.result_id).filter(Boolean), userId)),
    ]);
    const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
    const [pk, vs, rm, rs] = [byId(packages), byId(versions), byId(rooms), byId(results)];
    const list = [];
    for (const a of assignments) {
      const reason = a.status === "active" ? await blocker(a, { gates, versions: vs, packages: pk }) : null;
      const result = a.result_id ? rs.get(a.result_id) : null;
      list.push({
        id: a.id,
        status: a.status,
        language: a.language,
        title: pk.get(a.package_id)?.title ?? "Reassessment",
        // Independent Learners have no room; nothing classroom-related is returned to them.
        ...(kind === "classroom" ? { roomName: a.room_id ? rm.get(a.room_id)?.room_name ?? "Learning Room" : "Learning Room" } : {}),
        assignedAt: iso(a.assigned_at),
        dueAt: iso(a.due_at),
        completedAt: iso(a.completed_at),
        available: a.status === "active" && reason === null,
        unavailableReason: reason ? unavailable(reason, kind) : null,
        result: result ? {
          wordRecognitionScore: finiteOrNull(result.orv_score),
          comprehensionScore: finiteOrNull(result.comprehension_score),
          readingLevel: result.reading_level,
          completedAt: iso(result.completed_at),
        } : null,
      });
    }
    const sorted = list.sort((x, y) => Number(y.status === "active") - Number(x.status === "active")
      || String(y.assignedAt).localeCompare(String(x.assignedAt)));
    if (kind === "classroom") return { enabled, reassessments: sorted };
    return { enabled, reassessments: sorted, ...(await independentAvailability(userId, gates, assignments)) };
  }

  /**
   * Independent Learners: which centrally approved Independent Learner packages can be started now, per language,
   * and plainly why not. Classroom packages are never read. The rules (initial diagnostic in that language, waiting
   * interval since the latest official result, one active per language, never the same version twice) are checked
   * again by self-start and by the database.
   */
  async function independentAvailability(userId, gates, assignments) {
    const languages = {};
    for (const language of ["en", "fil"]) {
      const name = LANGUAGE_NAMES[language];
      // An active reassessment whose version was withdrawn no longer blocks the language (self-start closes it).
      const activeAll = assignments.find((a) => a.status === "active" && a.language === language);
      const active = activeAll && (await blocker(activeAll, { gates })) !== "VERSION_WITHDRAWN" ? activeAll : null;
      let reason = null;
      let nextAvailableAt = null;
      if (!gates.independent || gates.days === null || !pilotAllows(userId)) reason = "Reassessments are not open yet. Please check again later.";
      else if (active) reason = `Finish your ${name} reassessment first.`;
      else if (!(await run(() => repository.hasInitialDiagnostic(userId, language)))) reason = `Finish your first ${name} reading check before taking a reassessment.`;
      else {
        const last = await run(() => repository.latestOfficialResultAt(userId, language));
        const next = last ? new Date(new Date(last).getTime() + gates.days * 86400000) : null;
        if (next && next.getTime() > Date.parse(now())) {
          nextAvailableAt = next.toISOString();
          reason = `Your next ${name} reassessment opens on ${manilaDay(next)}.`;
        }
      }
      languages[language] = { canStart: reason === null, reason, nextAvailableAt };
    }
    const taken = new Set(assignments.map((a) => a.package_version_id));
    const packages = await run(() => repository.listIndependentPackages());
    const versions = await run(() => repository.listPublishedVersions(packages.map((p) => p.id)));
    const available = [];
    for (const pkg of packages) {
      const version = versions.find((v) => v.package_id === pkg.id && v.status === "published");
      if (pkg.archived_at || pkg.kind !== "reassessment" || pkg.audience !== "independent_learners" || !version) continue;
      const done = taken.has(version.id);
      const lang = languages[pkg.language];
      available.push({
        packageVersionId: version.id,
        title: pkg.title,
        language: pkg.language,
        canStart: Boolean(lang?.canStart) && !done,
        reason: done ? "You already took this one." : lang?.reason ?? null,
      });
    }
    return { languages, available: available.sort((a, b) => a.language.localeCompare(b.language) || a.title.localeCompare(b.title)) };
  }

  /**
   * Independent Learner self-start. Safe to repeat: a repeated or concurrent start of the SAME version returns the one
   * active assignment. Every rule is checked here and again by the database (Phase 2 guard + eligibility trigger).
   */
  async function startIndependent(requester, body = {}) {
    const { userId, kind } = requireLearner(requester);
    if (kind !== "independent") fail("Only Independent Learners start their own reassessments.", 403, "REASSESSMENT_FORBIDDEN");
    const versionId = body.packageVersionId;
    if (typeof versionId !== "string" || !UUID.test(versionId)) fail("Choose a reassessment.", 400, "PACKAGE_REQUIRED");
    const gates = await loadGates();
    if (!gates.independent || gates.days === null) fail(UNAVAILABLE_INDEPENDENT.REASSESSMENT_NOT_ENABLED, 409, "REASSESSMENT_NOT_ENABLED");
    // Pilot allow-list: an account outside the pilot gets the same answer as when reassessments are closed.
    if (!pilotAllows(userId)) fail(UNAVAILABLE_INDEPENDENT.REASSESSMENT_NOT_ENABLED, 409, "REASSESSMENT_NOT_ENABLED");
    const version = await run(() => repository.getVersion(versionId));
    const pkg = version ? await run(() => repository.getPackage(version.package_id)) : null;
    // A classroom package (or anything else) looks exactly like a missing one.
    if (!version || !pkg || pkg.kind !== "reassessment" || pkg.audience !== "independent_learners" || pkg.archived_at
      || version.status !== "published") {
      fail("Reassessment not found.", 404, "PACKAGE_NOT_FOUND");
    }
    const mine = await run(() => repository.listMyAssignments(userId, "independent"));
    const sameActive = mine.find((a) => a.status === "active" && a.package_version_id === version.id);
    if (sameActive) return { assignment: { id: sameActive.id, language: sameActive.language }, resumed: true };
    if (mine.some((a) => a.status === "completed" && a.package_version_id === version.id)) {
      fail("You already took this reassessment.", 409, "ALREADY_TAKEN");
    }
    // A withdrawn version left active would block this language forever (there is no teacher to cancel it): close it.
    for (const stale of mine.filter((a) => a.status === "active" && a.language === pkg.language)) {
      if ((await blocker(stale, { gates })) === "VERSION_WITHDRAWN") {
        await run(() => repository.closeWithdrawn(stale.id, userId));
        stale.status = "cancelled";
      }
    }
    const { languages } = await independentAvailability(userId, gates, mine.filter((a) => a.status !== "cancelled"));
    const lang = languages[pkg.language];
    if (!lang?.canStart) fail(lang?.reason ?? UNAVAILABLE_INDEPENDENT.REASSESSMENT_NOT_ENABLED, 409, "NOT_ELIGIBLE");
    try {
      const created = await repository.insertIndependentAssignment({
        package_version_id: version.id, package_id: pkg.id, language: pkg.language, kind: "independent",
        student_id: userId, assigned_by: userId,
      });
      return { assignment: { id: created.id, language: created.language }, resumed: false };
    } catch (error) {
      // A concurrent start won: return that assignment when it is the same version, otherwise refuse.
      if (error?.code === "23505") {
        const winner = (await run(() => repository.listMyAssignments(userId, "independent")))
          .find((a) => a.status === "active" && a.language === pkg.language);
        if (winner?.package_version_id === version.id) return { assignment: { id: winner.id, language: winner.language }, resumed: true };
        fail(`Finish your ${LANGUAGE_NAMES[pkg.language]} reassessment first.`, 409, "NOT_ELIGIBLE");
      }
      if (error?.code === "42501") fail("This reassessment cannot be started right now.", 409, "NOT_ELIGIBLE");
      return run(() => { throw error; });
    }
  }

  /** Passage, title and questions with choices. NO answer key, question type, fingerprint or review data. */
  async function getContent(requester, assignmentId) {
    const { userId, kind } = requireLearner(requester);
    const { assignment, version, pkg } = await deliverable(userId, assignmentId, kind);
    const binding = bindingFor(assignment, version);
    return {
      assignment: { id: assignment.id, dueAt: iso(assignment.due_at), title: pkg.title },
      assessment: {
        id: binding.assessmentId,
        version: binding.assessmentVersion,
        language: assignment.language,
        assessmentType: "reassessment",
        title: version.passage_title,
        passage: { language: assignment.language, title: version.passage_title, paragraphs: [...version.paragraphs] },
        questions: version.questions.map((q) => ({
          id: q.id,
          prompt: q.prompt,
          choices: q.choices.map((c) => ({ id: c.id, label: c.label })),
        })),
      },
    };
  }

  /**
   * Speech paths: the binding for a reassessment reading, or null when this requester may not read it now.
   * Only the assignment's own learner qualifies (staff never receive reassessment receipts).
   */
  async function resolveBinding({ requester, language, assessmentId, assessmentVersion }) {
    const role = requester?.profile?.role;
    if (!isReassessmentAssessmentId(assessmentId) || typeof assessmentVersion !== "string"
      || !assessmentVersion.startsWith(ASSIGNMENT_VERSION_PREFIX) || (role !== "student" && role !== "general_user")) return null;
    const kind = role === "student" ? "classroom" : "independent";
    const versionId = assessmentId.slice(REASSESSMENT_ASSESSMENT_PREFIX.length);
    const assignmentId = assessmentVersion.slice(ASSIGNMENT_VERSION_PREFIX.length);
    try {
      const { assignment, version } = await deliverable(requester.user.id, assignmentId, kind);
      if (assignment.package_version_id !== versionId || assignment.language !== language) return null;
      return bindingFor(assignment, version);
    } catch (error) {
      if (error instanceof ReassessmentDeliveryError) return null;
      throw error;
    }
  }

  function scoringAssessment(assignment, version) {
    return {
      language: assignment.language,
      title: version.passage_title,
      questions: version.questions.map((q) => ({ id: q.id, choiceIds: CHOICE_IDS, correctChoiceId: q.correctChoiceId })),
    };
  }

  function publicResult({ assignment, pkg, row, score, replayed }) {
    const orv = finiteOrNull(row.orv_score);
    const comprehension = finiteOrNull(row.comprehension_score);
    const placement = classifyDiagnosticPlacement(orv, comprehension);
    const metrics = row.oral_reading_metrics ?? {};
    return {
      assignmentId: assignment.id,
      assessmentType: "reassessment",
      language: assignment.language,
      title: pkg.title,
      completedAt: iso(row.completed_at),
      wordRecognitionScore: orv,
      comprehensionScore: comprehension,
      wordRecognitionLevel: placement.wordRecognitionLevel,
      comprehensionLevel: placement.comprehensionLevel,
      readingLevel: row.reading_level,
      readingSpeedWpm: finiteOrNull(row.reading_speed_wpm),
      reading: {
        totalExpectedWords: metrics.totalExpectedWords ?? null,
        correctWords: metrics.correctWords ?? null,
        substitutions: metrics.substitutions ?? null,
        omissions: metrics.omissions ?? null,
        insertions: metrics.insertions ?? null,
      },
      // Count only: which questions were right is not returned (it would reveal answer keys to classmates).
      comprehension: score ? { correct: score.correct, total: score.total } : null,
      replayed,
    };
  }

  /** A retry of the SAME recording returns the stored result; anything else is refused. */
  async function resolveCompleted(userId, assignmentId, recordingId, kind) {
    const assignment = await run(() => repository.getAssignment(assignmentId));
    if (!assignment || assignment.student_id !== userId || assignment.kind !== kind) fail("Reassessment not found.", 404, "ASSIGNMENT_NOT_FOUND");
    if (assignment.status === "completed" && assignment.result_id) {
      const [row] = await run(() => repository.loadResults([assignment.result_id], userId));
      if (row && recordingId && row.verification_recording_id === recordingId) {
        const pkg = await run(() => repository.getPackage(assignment.package_id));
        return publicResult({ assignment, pkg: pkg ?? { title: "Reassessment" }, row, score: null, replayed: true });
      }
      fail("You already finished this reassessment.", 409, "ASSIGNMENT_COMPLETED");
    }
    if (assignment.status === "cancelled") fail(cancelledMessage(kind), 409, "ASSIGNMENT_CANCELLED");
    return null;
  }

  async function submitResult(requester, assignmentId, body = {}) {
    const { userId, kind } = requireLearner(requester);
    if (!receipts) throw new Error("A transcript receipt service is required.");
    if (typeof assignmentId !== "string" || !UUID.test(assignmentId)) fail("Reassessment not found.", 404, "ASSIGNMENT_NOT_FOUND");
    // Replays of an already-recorded submission are answered before re-checking availability.
    const peek = await run(() => repository.getAssignment(assignmentId));
    if (peek && peek.student_id === userId && peek.kind === kind && peek.status !== "active") {
      let recordingId = null;
      try { recordingId = receipts.verify(body.transcriptReceipts?.[0])?.rid ?? null; } catch { recordingId = null; }
      const replay = await resolveCompleted(userId, assignmentId, recordingId, kind);
      if (replay) return replay;
    }
    const { assignment, version, pkg } = await deliverable(userId, assignmentId, kind);
    if (body.language !== undefined && body.language !== assignment.language) fail("This reassessment's language changed. Please start again.", 409, "ASSESSMENT_CHANGED");
    const binding = bindingFor(assignment, version);
    if (body.assessmentId !== undefined && (body.assessmentId !== binding.assessmentId || body.assessmentVersion !== binding.assessmentVersion)) {
      fail("This reassessment was updated. Please reload it and start again.", 409, "ASSESSMENT_CHANGED");
    }
    const assessment = scoringAssessment(assignment, version);
    const answers = body.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)
      || assessment.questions.some((q) => !CHOICE_IDS.includes(answers[q.id]))) {
      fail("Read the story and answer every question first.", 400, "INVALID_ANSWERS");
    }

    // Client-supplied scores, levels, tiers and transcripts are never read.
    const reading = verifyReading({ tokens: body.transcriptReceipts, userId, language: assignment.language, binding, receiptService: receipts });
    const duration = resolveDuration(reading, body.recordingDurationSeconds);
    const score = scoreDiagnostic({
      assessment,
      passageText: passageText(version),
      transcript: reading.text,
      recordingDurationSeconds: duration.seconds,
      answers,
    });
    const { alignment, ...counts } = score.oralReadingMetrics;
    const payload = {
      language: assignment.language,
      orv_score: score.orvScore,
      comprehension_score: score.comprehensionScore,
      reading_level: score.readingLevel,
      difficulty_tier: score.difficultyTier,
      reading_speed_wpm: finiteOrNull(score.readingSpeedWpm),
      transcript: reading.text,
      stt_confidence: finiteOrNull(reading.confidence),
      oral_reading_metrics: {
        alignment: alignment.map((word) => ({ ...word })),
        ...counts,
        scoringRule: DIAGNOSTIC_SCORING_RULE,
        comprehensionAnswers: score.comprehensionAnswers,
        transcriptSource: reading.source,
        transcriptSegments: reading.segments,
        durationSource: duration.source,
      },
      verification_method: VERIFICATION_METHOD,
      verification_recording_id: reading.recordingId,
      completed_at: now(),
    };
    let resultId;
    try {
      resultId = await repository.recordResult(assignment.id, userId, payload);
    } catch (error) {
      // A concurrent submission completed the assignment first (the function locks the assignment row), or the same
      // recording was already used: answer as a replay when it was this recording, otherwise refuse.
      if (/already been completed|cancelled|duplicate key|23505/i.test(`${error?.message} ${error?.code}`)) {
        const replay = await resolveCompleted(userId, assignment.id, reading.recordingId, kind);
        if (replay) return replay;
        fail("We couldn't verify your reading. Please go back to the story and record it again.", 422, "READING_NOT_VERIFIED");
      }
      if (/not enabled/i.test(error?.message ?? "")) fail(unavailable("REASSESSMENT_NOT_ENABLED", kind), 409, "REASSESSMENT_NOT_ENABLED");
      if (/no longer/i.test(error?.message ?? "")) fail(unavailable("VERSION_WITHDRAWN", kind), 409, "VERSION_WITHDRAWN");
      return run(() => { throw error; });
    }
    const [row] = await run(() => repository.loadResults([resultId], userId));
    if (!row) fail("We couldn't confirm your result. Please reload the page.", 500, "REASSESSMENT_FAILED");
    const correct = assessment.questions.filter((q) => score.comprehensionAnswers[q.id] === q.correctChoiceId).length;
    return publicResult({ assignment, pkg, row, score: { correct, total: assessment.questions.length }, replayed: false });
  }

  return { getContent, listMine, resolveBinding, startIndependent, submitResult };
}

module.exports = {
  ASSIGNMENT_VERSION_PREFIX,
  REASSESSMENT_ASSESSMENT_PREFIX,
  ReassessmentDeliveryError,
  createReassessmentDeliveryService,
  isReassessmentAssessmentId,
  passageHash,
};
