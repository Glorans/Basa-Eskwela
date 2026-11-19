// M2 F6 (initial diagnostic content, System Admin) and F10 (reassessment materials): assessment packages.
// Staff-only management of passages, questions, answer keys and their versions. Nothing here changes what learners
// take: the code-defined version 3.0 diagnostic stays the delivered assessment, and scoring, thresholds, M3
// placement, M7 and M8 are untouched. Activating package versions for learners is a later, separately approved step.
const { DIAGNOSTIC_ASSESSMENTS } = require("./diagnosticAssessments");
const { getProfileDisplayName } = require("./profileNames");
const policy = require("./assessmentPackagePolicy");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGES = Object.freeze(["en", "fil"]);
const QUESTION_TYPES = Object.freeze(["literal", "inferential", "critical"]);
const CHOICE_IDS = Object.freeze(["a", "b", "c", "d"]);
const OPEN_STATUSES = Object.freeze(["draft", "in_review", "approved"]);
// Question order of the code-defined version 3.0 diagnostic (documented in its data files): literal, literal,
// inferential x3, critical. Used only to label the imported copy; scoring never reads question types.
const CODE_QUESTION_TYPES = Object.freeze(["literal", "literal", "inferential", "inferential", "inferential", "critical"]);
const LIMITS = Object.freeze({ title: 200, paragraph: 3000, paragraphs: 10, prompt: 500, label: 300, note: 2000,
  reviewer: 200, qualification: 500 });
const REVIEW_CHECKS = Object.freeze(["passageSuitable", "questionsSound", "answerKeysCorrect", "languageAccurate"]);
const STAGE_LABELS = Object.freeze({
  draft: "Draft",
  in_review: "Submitted for review",
  approved: "Approved for library",
  published: "Published in library",
  retired: "Retired",
});

class AssessmentPackageError extends Error {
  constructor(message, statusCode = 500, issues = undefined) {
    super(message);
    this.name = "AssessmentPackageError";
    this.statusCode = statusCode;
    if (issues) this.issues = issues;
  }
}
const fail = (message, statusCode, issues) => { throw new AssessmentPackageError(message, statusCode, issues); };

/** Database refusals (the guard triggers and constraints) become clear 4xx answers; anything else is a 500. */
function fromDatabase(error, fallback = "Unable to save the assessment package.") {
  const code = error?.code;
  const message = typeof error?.message === "string" ? error.message : "";
  if (code === "23514") {
    const issues = message.includes(": ") ? message.slice(message.indexOf(": ") + 2).split(/(?<=\.)\s+/).filter(Boolean) : [];
    return new AssessmentPackageError(message.split(":")[0] || "The content is not valid.", 422, issues.length ? issues : undefined);
  }
  if (code === "23505") return new AssessmentPackageError("That version label or package already exists.", 409);
  if (code === "42501" || code === "23502") return new AssessmentPackageError(message || "This change is not allowed.", 409);
  return new AssessmentPackageError(fallback, 500);
}

async function run(work, fallback) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AssessmentPackageError) throw error;
    throw fromDatabase(error, fallback);
  }
}

const text = (value, max, field) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") fail(`${field} must be text.`, 400);
  const trimmed = value.trim();
  if (trimmed.length > max) fail(`${field} is too long (at most ${max} characters).`, 400);
  return trimmed;
};

/**
 * Browser content -> the stored shape. Drafts may be incomplete; structural validity is checked by the database
 * when the version is submitted for review. Question ids are assigned by position; choices are always a-d.
 */
function normalizeContent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Send the passage and questions.", 400);
  const passageTitle = text(input.passageTitle, LIMITS.title, "The passage title");
  if (!Array.isArray(input.paragraphs) || input.paragraphs.length > LIMITS.paragraphs) {
    fail(`The passage has at most ${LIMITS.paragraphs} paragraphs.`, 400);
  }
  const paragraphs = input.paragraphs.map((p, i) => text(p, LIMITS.paragraph, `Paragraph ${i + 1}`));
  if (!Array.isArray(input.questions) || input.questions.length > 6) fail("A package has at most 6 questions.", 400);
  const questions = input.questions.map((q, i) => {
    if (!q || typeof q !== "object") fail(`Question ${i + 1} is invalid.`, 400);
    const type = QUESTION_TYPES.includes(q.type) ? q.type : "";
    const choices = CHOICE_IDS.map((id) => {
      const found = Array.isArray(q.choices) ? q.choices.find((c) => c?.id === id) : null;
      return { id, label: text(found?.label, LIMITS.label, `Question ${i + 1} choice ${id.toUpperCase()}`) };
    });
    return {
      id: `q${i + 1}`,
      type,
      prompt: text(q.prompt, LIMITS.prompt, `Question ${i + 1}`),
      choices,
      correctChoiceId: CHOICE_IDS.includes(q.correctChoiceId) ? q.correctChoiceId : null,
    };
  });
  return { passageTitle, paragraphs, questions };
}

function versionSummary(v) {
  return {
    id: v.id,
    versionNumber: v.version_number,
    versionLabel: v.version_label,
    status: v.status,
    source: v.source,
    createdAt: v.created_at,
    submittedAt: v.submitted_at ?? null,
    reviewedAt: v.reviewed_at ?? null,
    publishedAt: v.published_at ?? null,
    retiredAt: v.retired_at ?? null,
  };
}

/** Today's date in the pilot school's time zone (Asia/Manila), as YYYY-MM-DD. */
const manilaToday = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
/** A SQL date as YYYY-MM-DD (Supabase returns a string; some drivers return a Date at UTC midnight). */
const isoDate = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10));
/** Newest review first: by review date, then recording time, then id (the same order as the SQL rule). */
const newestReviewFirst = (a, b) => isoDate(b.reviewed_on).localeCompare(isoDate(a.reviewed_on))
  || new Date(b.recorded_at) - new Date(a.recorded_at) || String(b.id).localeCompare(String(a.id));

/** Mirrors m2_version_educator_endorsed(): the MOST RECENT review must be an endorsement. */
function educatorEndorsed(reviews) {
  return [...reviews].sort(newestReviewFirst)[0]?.outcome === "endorsed";
}

/**
 * "Active for learner assessment" is separate from "Published in library". In this phase the only active content is
 * the code-defined diagnostic learners already take (version 3.0); no package version is delivered to learners, and
 * reassessment is not live. Publishing never replaces the active initial diagnostic.
 */
/**
 * activation = { installed, activeVersionId } for the package's language (null activeVersionId = the built-in 3.0).
 * Publishing in the library never activates a version; only a System Admin's explicit activation does (F6).
 */
function learnerActivity(pkg, v, activation = { installed: false, activeVersionId: null }) {
  const code = Object.values(DIAGNOSTIC_ASSESSMENTS).find((a) => a.id === pkg.legacy_assessment_id);
  if (pkg.kind === "initial") {
    const active = activation.activeVersionId
      ? v.id === activation.activeVersionId
      : Boolean(code && v.source === "code_import" && v.version_label === code.version);
    return {
      activeForLearners: active,
      activationNote: active
        ? (v.source === "code_import" ? "Learners take this version now (the built-in initial diagnostic)." : "Learners take this version now (activated by a System Admin).")
        : "Not active. Publishing in the library does not replace the current initial diagnostic; a System Admin activates a version separately.",
    };
  }
  return { activeForLearners: false, activationNote: "Not active. Reassessment is not available to learners yet." };
}

function packageSummary(profile, pkg, versions, activation) {
  const category = policy.categoryOf(pkg);
  const own = versions.filter((v) => v.package_id === pkg.id).sort((a, b) => b.version_number - a.version_number);
  const published = own.find((v) => v.status === "published");
  const summary = {
    id: pkg.id,
    category,
    language: pkg.language,
    title: pkg.title,
    archived: Boolean(pkg.archived_at),
    createdAt: pkg.created_at,
    updatedAt: pkg.updated_at,
    publishedVersion: published ? published.version_label : null,
    // Initial packages: the version learners take now (the built-in 3.0 unless a System Admin activated another).
    activeVersion: category === "initial" ? (own.find((v) => learnerActivity(pkg, v, activation).activeForLearners)?.version_label ?? null) : null,
    latestVersion: own[0] ? versionSummary(own[0]) : null,
    versionCount: own.length,
    permissions: policy.permissionsFor(profile, pkg),
  };
  if (category === "initial") summary.delivery = initialDelivery(pkg, own, activation);
  return summary;
}

/** What learners take now for an initial package: the built-in version, or the version a System Admin activated (F6). */
function initialDelivery(pkg, versions = [], activation = { installed: false, activeVersionId: null }) {
  const code = Object.values(DIAGNOSTIC_ASSESSMENTS).find((a) => a.id === pkg.legacy_assessment_id);
  const activated = activation.activeVersionId ? versions.find((v) => v.id === activation.activeVersionId) : null;
  return {
    source: activated ? "package" : "code",
    assessmentId: code?.id ?? null,
    version: activated ? activated.version_label : code?.version ?? null,
    activationAvailable: Boolean(activation.installed),
  };
}

function createAssessmentPackageService({ repository, now = () => new Date() } = {}) {
  if (!repository) throw new Error("An assessment package repository is required.");

  const requireStaff = (requester) => {
    if (!requester?.user?.id || !policy.isStaff(requester.profile)) {
      fail("Assessment packages are available to System Admins, School Admins and approved Teachers only.", 403);
    }
    return { actor: requester.user.id, profile: { ...requester.profile, id: requester.user.id } };
  };

  const loadPackage = async (profile, packageId) => {
    if (typeof packageId !== "string" || !UUID.test(packageId)) fail("Assessment package not found.", 404);
    const pkg = await run(() => repository.getPackage(packageId), "Unable to load the assessment package.");
    // A package the account may not see is reported as missing, so its existence is not disclosed.
    if (!pkg || !policy.canView(profile, pkg)) fail("Assessment package not found.", 404);
    return pkg;
  };

  const loadVersion = async (pkg, versionId) => {
    if (typeof versionId !== "string" || !UUID.test(versionId)) fail("Version not found.", 404);
    const version = await run(() => repository.getVersion(versionId), "Unable to load the version.");
    if (!version || version.package_id !== pkg.id) fail("Version not found.", 404);
    return version;
  };

  const requireActive = (pkg) => { if (pkg.archived_at) fail("This package is archived and read-only.", 409); };
  const allow = (ok, message) => { if (!ok) fail(message, 403); };

  async function names(ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await run(() => repository.loadProfiles(unique), "Unable to load reviewer names.");
    return new Map(rows.map((p) => [p.id, getProfileDisplayName({ role: p.role, nickname: p.nickname, fullName: p.full_name }) || "Staff member"]));
  }

  /** { installed, activeVersionId } for a language; the built-in 3.0 when activation is not installed. */
  async function activationFor(language) {
    if (!repository.getActivation) return { installed: false, activeVersionId: null };
    return run(() => repository.getActivation(language), "Unable to load the active version.");
  }

  async function detail(profile, pkg) {
    const activation = pkg.kind === "initial" ? await activationFor(pkg.language) : { installed: false, activeVersionId: null };
    const versions = (await run(() => repository.listVersions([pkg.id]), "Unable to load versions."))
      .sort((a, b) => b.version_number - a.version_number);
    const reviews = versions.length ? await run(() => repository.listReviews(versions.map((v) => v.id)), "Unable to load educator reviews.") : [];
    const people = await names([...versions.flatMap((v) => [v.created_by, v.submitted_by, v.reviewed_by, v.published_by, v.retired_by]),
      ...reviews.map((r) => r.recorded_by), pkg.owner_id]);
    const who = (id) => (id ? people.get(id) ?? "Staff member" : null);
    const reviewsOf = (versionId) => reviews.filter((r) => r.version_id === versionId).sort(newestReviewFirst);
    const detailed = await Promise.all(versions.map(async (v) => ({
      ...versionSummary(v),
      basedOnVersionId: v.based_on_version_id ?? null,
      content: { passageTitle: v.passage_title, paragraphs: v.paragraphs, questions: v.questions },
      contentSha256: v.content_sha256 ?? null,
      // Software (structural) validation only, shown for drafts. Educational approval is the review attestation.
      issues: v.status === "draft"
        ? await run(() => repository.contentIssues(v.passage_title, v.paragraphs, v.questions), "Unable to check the draft.")
        : [],
      stageLabel: STAGE_LABELS[v.status],
      ...learnerActivity(pkg, v, activation),
      reviewNote: v.review_note ?? null,
      // Library approval statement (System Admin / School Admin account). NOT educational validation.
      educatorReviewAttestation: v.educator_review_attestation ?? null,
      educatorEndorsed: educatorEndorsed(reviewsOf(v.id)),
      educatorReviews: reviewsOf(v.id).map((r) => ({
        id: r.id,
        reviewerName: r.reviewer_name,
        reviewerQualification: r.reviewer_qualification,
        reviewedOn: isoDate(r.reviewed_on),
        passageSuitable: r.passage_suitable,
        questionsSound: r.questions_sound,
        answerKeysCorrect: r.answer_keys_correct,
        languageAccurate: r.language_accurate,
        outcome: r.outcome,
        notes: r.notes ?? null,
        recordedBy: r.recorded_by ? people.get(r.recorded_by) ?? "Staff member" : "Removed account",
        recordedAt: r.recorded_at,
      })),
      createdBy: who(v.created_by),
      submittedBy: who(v.submitted_by),
      reviewedBy: who(v.reviewed_by),
      publishedBy: who(v.published_by),
      retiredBy: who(v.retired_by),
    })));
    const summary = packageSummary(profile, pkg, versions, activation);
    if (pkg.kind === "initial") {
      summary.activation = {
        available: activation.installed,
        canManage: activation.installed && policy.canImportInitial(profile) && !pkg.archived_at,
        activeVersionId: activation.activeVersionId,
      };
      for (const d of detailed) {
        d.canActivate = summary.activation.canManage && d.status === "published" && d.source === "authored" && d.educatorEndorsed && !d.activeForLearners;
      }
    }
    if (pkg.scope === "teacher" && profile.role === "admin") summary.ownerName = pkg.owner_id ? who(pkg.owner_id) : "Removed account";
    return { package: summary, versions: detailed };
  }

  const visibleScopes = (profile) => (profile.role === "system_admin" ? { scopes: ["platform"] }
    : profile.role === "admin" ? { scopes: ["school", "teacher"] }
      : { scopes: ["teacher"], ownerId: profile.id });

  async function listPackages(requester) {
    const { profile } = requireStaff(requester);
    const rows = (await run(() => repository.listPackages(visibleScopes(profile)), "Unable to load assessment packages."))
      .filter((pkg) => policy.canView(profile, pkg)); // defense in depth: the query is already scoped
    const versions = rows.length ? await run(() => repository.listVersions(rows.map((p) => p.id)), "Unable to load versions.") : [];
    const names = await (async () => {
      const ids = rows.filter((p) => p.scope === "teacher" && profile.role === "admin" && p.owner_id).map((p) => p.owner_id);
      if (!ids.length) return new Map();
      const people = await run(() => repository.loadProfiles([...new Set(ids)]), "Unable to load Teacher names.");
      return new Map(people.map((p) => [p.id, getProfileDisplayName({ role: p.role, nickname: p.nickname, fullName: p.full_name }) || "Teacher"]));
    })();
    const packages = (await Promise.all(rows.map(async (pkg) => ({
      ...packageSummary(profile, pkg, versions, pkg.kind === "initial" ? await activationFor(pkg.language) : undefined),
      ...(profile.role === "admin" && pkg.scope === "teacher"
        ? { ownerName: pkg.owner_id ? names.get(pkg.owner_id) ?? "Teacher" : "Removed account" } : {}),
    })))).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const importable = policy.canImportInitial(profile)
      ? LANGUAGES.filter((language) => !rows.some((p) => p.kind === "initial" && !p.archived_at && p.language === language))
      : [];
    return { packages, capabilities: { create: policy.creatableCategories(profile), importInitial: importable } };
  }

  async function getPackage(requester, packageId) {
    const { profile } = requireStaff(requester);
    return detail(profile, await loadPackage(profile, packageId));
  }

  async function createPackage(requester, input) {
    const { actor, profile } = requireStaff(requester);
    const category = input?.category;
    allow(policy.creatableCategories(profile).includes(category), "Your account cannot create this kind of package.");
    const language = input?.language;
    if (!LANGUAGES.includes(language)) fail("Choose English or Filipino.", 400);
    const title = text(input?.title, LIMITS.title, "The package title");
    if (!title) fail("Add a package title.", 400);
    const pkg = await run(() => repository.insertPackage({ ...policy.CATEGORIES[category], owner_id: actor, language, title }));
    await run(() => repository.insertVersion({ package_id: pkg.id, version_number: 1, version_label: "1.0", created_by: actor }));
    return detail(profile, pkg);
  }

  /**
   * System Admin: record the code-defined version 3.0 diagnostic as the published version 3.0 of the initial
   * package for its language, so new versions can be authored from it. The browser sends the full content (the
   * server copy holds no prompts or choice labels); it must match the server copy exactly: assessment id, version,
   * language, title, every paragraph, question ids, choice ids and every answer key. Learner delivery is unchanged.
   */
  async function importInitial(requester, input) {
    const { actor, profile } = requireStaff(requester);
    allow(policy.canImportInitial(profile), "Only a System Admin can import the initial diagnostic.");
    const language = input?.language;
    const code = LANGUAGES.includes(language) ? DIAGNOSTIC_ASSESSMENTS[language] : null;
    if (!code) fail("Choose English or Filipino.", 400);
    const sent = input?.assessment;
    const sentParagraphs = sent?.passage?.paragraphs;
    const matches = sent && sent.id === code.id && sent.version === code.version && sent.language === code.language
      && sent.title === code.title && Array.isArray(sentParagraphs) && sentParagraphs.length === code.paragraphs.length
      && sentParagraphs.every((p, i) => p === code.paragraphs[i])
      && Array.isArray(sent.questions) && sent.questions.length === code.questions.length
      && sent.questions.every((q, i) => q?.id === code.questions[i].id && q.correctChoiceId === code.questions[i].correctChoiceId
        && Array.isArray(q.choices) && q.choices.length === 4 && q.choices.every((c, j) => c?.id === CHOICE_IDS[j])
        && typeof q.prompt === "string" && q.prompt.trim() && q.choices.every((c) => typeof c.label === "string" && c.label.trim()));
    if (!matches) fail("The content does not match the current version 3.0 diagnostic. Reload the page and try again.", 409);

    const existing = await run(() => repository.findPackageByLegacyId(code.id), "Unable to check existing packages.");
    let pkg = existing;
    if (existing) {
      const versions = await run(() => repository.listVersions([existing.id]), "Unable to load versions.");
      if (versions.length) fail("The current diagnostic has already been imported.", 409);
    } else {
      pkg = await run(() => repository.insertPackage({
        ...policy.CATEGORIES.initial, owner_id: actor, language, title: code.title, legacy_assessment_id: code.id,
      }));
    }
    await run(() => repository.insertVersion({
      package_id: pkg.id,
      version_number: 1,
      version_label: code.version,
      status: "published",
      source: "code_import",
      created_by: actor,
      published_by: actor,
      passage_title: code.title,
      paragraphs: [...code.paragraphs],
      questions: sent.questions.map((q, i) => ({
        id: q.id,
        type: CODE_QUESTION_TYPES[i],
        prompt: q.prompt.trim(),
        choices: q.choices.map((c) => ({ id: c.id, label: c.label.trim() })),
        correctChoiceId: q.correctChoiceId,
      })),
    }), "Unable to import the diagnostic.");
    return detail(profile, pkg);
  }

  async function renamePackage(requester, packageId, input) {
    const { profile } = requireStaff(requester);
    const pkg = await loadPackage(profile, packageId);
    requireActive(pkg);
    allow(policy.canManage(profile, pkg), "You cannot rename this package.");
    const title = text(input?.title, LIMITS.title, "The package title");
    if (!title) fail("Add a package title.", 400);
    return detail(profile, await run(() => repository.updatePackage(pkg.id, { title })));
  }

  async function archivePackage(requester, packageId) {
    const { profile } = requireStaff(requester);
    const pkg = await loadPackage(profile, packageId);
    requireActive(pkg);
    allow(policy.canManage(profile, pkg), "You cannot archive this package.");
    // The initial package is the lineage of the diagnostic every learner takes; it is never archived from here.
    if (pkg.kind === "initial") fail("The initial diagnostic package cannot be archived.", 409);
    return detail(profile, await run(() => repository.updatePackage(pkg.id, { archived_at: now().toISOString() })));
  }

  async function createVersion(requester, packageId, input = {}) {
    const { actor, profile } = requireStaff(requester);
    const pkg = await loadPackage(profile, packageId);
    requireActive(pkg);
    allow(policy.canManage(profile, pkg), "You cannot add versions to this package.");
    const versions = await run(() => repository.listVersions([pkg.id]), "Unable to load versions.");
    if (versions.some((v) => OPEN_STATUSES.includes(v.status))) {
      fail("Finish, publish or retire the version in progress before starting another.", 409);
    }
    const basedOnId = input.basedOnVersionId ?? versions.find((v) => v.status === "published")?.id
      ?? [...versions].sort((a, b) => b.version_number - a.version_number)[0]?.id ?? null;
    const base = basedOnId ? versions.find((v) => v.id === basedOnId) : null;
    if (basedOnId && !base) fail("Version not found.", 404);
    const majors = versions.map((v) => Number.parseInt(String(v.version_label).split(".")[0], 10)).filter(Number.isFinite);
    const label = input.versionLabel === undefined || input.versionLabel === null || input.versionLabel === ""
      ? `${(majors.length ? Math.max(...majors) : 0) + 1}.0`
      : text(input.versionLabel, 9, "The version label");
    if (!/^[0-9]{1,4}(\.[0-9]{1,4})?$/.test(label)) fail("Use a version label like 4.0 or 4.1.", 400);
    await run(() => repository.insertVersion({
      package_id: pkg.id,
      version_number: Math.max(0, ...versions.map((v) => v.version_number)) + 1,
      version_label: label,
      created_by: actor,
      based_on_version_id: base?.id ?? null,
      passage_title: base?.passage_title ?? "",
      paragraphs: base?.paragraphs ?? [],
      // A copied question keeps its prompt, choices and key; the copy is a new draft and must be reviewed again.
      questions: base?.questions ?? [],
    }));
    return detail(profile, pkg);
  }

  async function updateDraft(requester, packageId, versionId, input) {
    const { profile } = requireStaff(requester);
    const pkg = await loadPackage(profile, packageId);
    requireActive(pkg);
    allow(policy.canManage(profile, pkg), "You cannot edit this package.");
    const version = await loadVersion(pkg, versionId);
    if (version.status !== "draft") fail("Only drafts can be edited. Create a new version to change this content.", 409);
    const content = normalizeContent(input?.content);
    await run(() => repository.updateVersion(version.id, {
      passage_title: content.passageTitle, paragraphs: content.paragraphs, questions: content.questions,
    }));
    return detail(profile, pkg);
  }

  async function deleteDraft(requester, packageId, versionId) {
    const { profile } = requireStaff(requester);
    const pkg = await loadPackage(profile, packageId);
    requireActive(pkg);
    allow(policy.canManage(profile, pkg), "You cannot delete drafts in this package.");
    const version = await loadVersion(pkg, versionId);
    if (version.status !== "draft") fail("Only drafts can be deleted.", 409);
    await run(() => repository.deleteVersion(version.id));
    return detail(profile, pkg);
  }

  /**
   * Record an educator's review of a frozen version (append-only). The application records what the reviewer states;
   * it cannot verify the reviewer's professional qualification. Only an endorsement with all four checks passed counts.
   */
  async function recordEducatorReview(requester, packageId, versionId, input = {}) {
    const { actor, profile } = requireStaff(requester);
    const pkg = await loadPackage(profile, packageId);
    requireActive(pkg);
    allow(policy.canReview(profile, pkg), "You cannot record educator reviews for this package.");
    const version = await loadVersion(pkg, versionId);
    if (version.status === "draft") fail("Submit the version for review before recording an educator review.", 409);
    const reviewerName = text(input.reviewerName, LIMITS.reviewer, "The reviewer's name");
    const reviewerQualification = text(input.reviewerQualification, LIMITS.qualification, "The reviewer's stated qualification");
    if (!reviewerName || !reviewerQualification) fail("Add the reviewer's name and stated qualification.", 400);
    const reviewedOn = typeof input.reviewedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.reviewedOn) ? input.reviewedOn : "";
    if (!reviewedOn || Number.isNaN(Date.parse(`${reviewedOn}T00:00:00Z`))) fail("Add the review date.", 400);
    if (reviewedOn > manilaToday(now())) fail("The review date cannot be in the future.", 400);
    const checks = REVIEW_CHECKS.map((key) => input[key]);
    if (checks.some((value) => typeof value !== "boolean")) fail("Answer every review check.", 400);
    if (!["endorsed", "changes_requested"].includes(input.outcome)) fail("Choose the review outcome.", 400);
    if (input.outcome === "endorsed" && checks.some((value) => !value)) {
      fail("An endorsement needs all four checks passed. Record \"Changes requested\" instead.", 400);
    }
    const notes = text(input.notes, LIMITS.note, "The review notes");
    await run(() => repository.insertReview({
      version_id: version.id,
      reviewer_name: reviewerName,
      reviewer_qualification: reviewerQualification,
      reviewed_on: reviewedOn,
      passage_suitable: checks[0],
      questions_sound: checks[1],
      answer_keys_correct: checks[2],
      language_accurate: checks[3],
      outcome: input.outcome,
      notes: notes || null,
      recorded_by: actor,
    }), "Unable to record the educator review.");
    return detail(profile, pkg);
  }

  /**
   * F6: make a published, educator-endorsed version of the initial diagnostic the one learners take (System Admin only),
   * or return the language to the built-in 3.0 (versionId null). The caller names the version it expects to replace,
   * so two System Admins cannot overwrite each other. The database re-checks every rule (m2_activate_initial_version).
   */
  async function setActiveInitialVersion(requester, packageId, versionId, input = {}) {
    const { actor, profile } = requireStaff(requester);
    const pkg = await loadPackage(profile, packageId);
    allow(policy.canImportInitial(profile), "Only a System Admin can change the active initial diagnostic.");
    if (pkg.kind !== "initial") fail("Only the initial diagnostic can be activated.", 409);
    requireActive(pkg);
    if (!repository.activateInitialVersion) fail("Activation is not installed yet.", 503);
    if (versionId !== null) await loadVersion(pkg, versionId);
    const expected = input.expectedActiveVersionId ?? null;
    if (expected !== null && (typeof expected !== "string" || !UUID.test(expected))) fail("Reload the page and try again.", 400);
    try {
      await repository.activateInitialVersion(pkg.language, versionId, expected, actor);
    } catch (error) {
      if (error?.code === "40001") fail("The active version changed since you loaded it. Reload and try again.", 409);
      if (error?.code === "42501" || error?.code === "22023") fail(error.message || "This version cannot be activated.", 409);
      throw fromDatabase(error, "Unable to change the active version.");
    }
    return detail(profile, pkg);
  }

  async function transition(requester, packageId, versionId, action, input = {}) {
    const { actor, profile } = requireStaff(requester);
    const pkg = await loadPackage(profile, packageId);
    requireActive(pkg);
    const version = await loadVersion(pkg, versionId);
    const note = text(input.note, LIMITS.note, "The review note");
    if (action === "submit") {
      allow(policy.canManage(profile, pkg), "You cannot submit this package for review.");
      if (version.status !== "draft") fail("Only a draft can be submitted for review.", 409);
      await run(() => repository.updateVersion(version.id, { status: "in_review", submitted_by: actor }));
    } else if (action === "return") {
      allow(policy.canReview(profile, pkg), "You cannot review this package.");
      if (version.status !== "in_review") fail("Only a version in review can be returned.", 409);
      if (!note) fail("Add a note explaining what to change.", 400);
      await run(() => repository.updateVersion(version.id, { status: "draft", review_note: note }));
    } else if (action === "approve") {
      allow(policy.canReview(profile, pkg), "You cannot review this package.");
      if (version.status !== "in_review") fail("Only a version in review can be approved.", 409);
      const attestation = text(input.attestation, LIMITS.note, "The educator review statement");
      if (!attestation) fail("Describe the educator review (who reviewed the passage and questions, and how).", 400);
      await run(() => repository.updateVersion(version.id, {
        status: "approved", reviewed_by: actor, educator_review_attestation: attestation, review_note: note || null,
      }));
    } else if (action === "publish") {
      allow(policy.canPublish(profile, pkg), "You cannot publish this package.");
      if (version.status !== "approved") fail("Only an approved version can be published.", 409);
      await run(() => repository.publishVersion(version.id, actor));
    } else if (action === "retire") {
      allow(policy.canPublish(profile, pkg), "You cannot retire versions in this package.");
      if (!["approved", "published"].includes(version.status)) fail("Only an approved or published version can be retired.", 409);
      // The initial diagnostic always keeps a published version; it is replaced by publishing a newer one.
      if (pkg.kind === "initial" && version.status === "published") {
        fail("Publish a newer version to replace the initial diagnostic's published version.", 409);
      }
      await run(() => repository.updateVersion(version.id, { status: "retired", retired_by: actor }));
    } else {
      fail("Unknown action.", 404);
    }
    return detail(profile, pkg);
  }

  return {
    archivePackage,
    createPackage,
    createVersion,
    deleteDraft,
    getPackage,
    importInitial,
    listPackages,
    recordEducatorReview,
    renamePackage,
    setActiveInitialVersion,
    transition,
    updateDraft,
  };
}

module.exports = {
  AssessmentPackageError,
  CODE_QUESTION_TYPES,
  createAssessmentPackageService,
  educatorEndorsed,
  fromDatabase,
  learnerActivity,
  manilaToday,
  normalizeContent,
};
