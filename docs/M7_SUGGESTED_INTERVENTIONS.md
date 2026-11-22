# M7 Suggested Interventions (F10) and Intervention Records (F11)

Rule-based and explainable. No AI provider. Code: `server/services/m7Suggestions.js` (rules, `RULES` constants),
`server/routes/m7Analytics.js` (routes), `readflow/src/modules/module7/components/SuggestedInterventions.tsx` (UI).

## Who sees what

| Role | Suggestions | Record interventions |
|---|---|---|
| Teacher (approved) | Students enrolled in own classrooms; full evidence, "Use this suggestion" | Yes (Appendix N F11), own records only |
| School Admin | Students of own school, read-only; evidence from that school's classrooms; read-only intervention history of the school (no Teacher private notes) | No (403; database refuses non-Teacher authors). Older Admin-authored records stay as read-only history |
| System Admin | Read-only: platform counts by competency and language (no names); one Independent Learner's suggestions without word lists or own-material titles. School Students are never shown individually | No |
| Student | "Practice ideas for you" on Progress & Result, from own results only (classroom and personal), simple words, no labels | No |
| Independent Learner | Same page, from own personal practice (no school or classroom needed) | No |

Personal practice (no classroom) is never used for Teacher or School Admin suggestions. Learners never see
labels such as "at risk" or "repeated difficulty", Teacher activities, intervention records or fluency.

Routes: `GET /api/analytics/students/:id/suggestions` (Teacher), `/admin/students/:id/suggestions` (School Admin),
`/personal/suggestions` (Student, Independent Learner), `/system-admin/suggestions` and
`/system-admin/independent-learners/:id/suggestions` (System Admin).

## Evidence used

- **M6 comprehension**: counted assessments only (one per learner and activity), first answers per saved question
  category (literal / inferential / critical), validated the same way as the M7 competency report. Invalid evidence
  is left out and reported.
- **M5 oral reading**: reading accuracy (words matching the story), story words read differently or not heard
  (saved word alignment), English pronunciation-check practice words (English only; Filipino is never called
  pronunciation), reading speed (only if a benchmark is approved).
- **M2**: official placement per language (`getPlacement`), context only; never changed.

English and Filipino are evaluated separately.

## Rules (`RULES`)

| Rule | Value |
|---|---|
| Comprehension benchmark | 75% first-answer correct (same as the M7 support guide) |
| Window | latest 3 assessments that included the question type |
| Not judged | fewer than 2 questions of the type in the window |
| Needs practice | window below 75% |
| Repeated difficulty | at least 2 window assessments below 75% and at least 4 questions (two passages); otherwise **preliminary observation** (one assessment is always preliminary; shows "more evidence needed"). Wording: "a repeated difficulty in recent results, not a permanent label" |
| Improving | the window just before the latest assessment was below 75% and the current window is not |
| Word recognition | average accuracy of the latest 3 readings below 90% (Phil-IRI frustration level, as in M2); repeated when 2+ readings are below |
| Fluency | `fluencyMinWpm = null`: not evaluated until a reading-speed benchmark is approved |
| Priority | repeated before preliminary, then word recognition, literal, inferential, critical, fluency; English before Filipino on ties |
| Shown | at most 3 suggestions; further needs listed as "Also observed" |

## Suggested interventions

| Competency | Suggestion | Approach |
|---|---|---|
| Literal | Story Details Practice | QAR "Right There" questions, story map |
| Inferential | Reading Between the Lines | Prediction, context clues, "Think and Search" / "Author and Me" |
| Critical | Evidence-Based Reading Practice | Judging decisions with text evidence, fact vs. opinion |
| Word recognition (EN) | Guided Oral Rereading with Word Practice | Modelled and guided rereading, word study |
| Word recognition (FIL) | Guided Oral Rereading with Pantig Practice | Modelled and guided rereading, syllable (pantig) work |
| Fluency | Supported Repeated Reading | Echo / paired / independent repeated reading |

## Intervention records (F11)

New optional fields on `m7_interventions` (migration `supabase/proposed/m7_intervention_suggestions_PROPOSED.sql`):
`competency`, `language`, `suggestion_key`, `suggestion_snapshot`, `teacher_notes`, `follow_up_outcome`.

- Choosing a suggestion sends only its id. The server re-evaluates the Student; if the suggestion is no longer
  current it refuses (409). Otherwise it stores its own snapshot of the evidence.
- The snapshot, author, Student and creation time can never change (database trigger). Records are never deleted.
- Status (Planned / In progress / Completed) and outcome are always the author's choice. Nothing is completed,
  scored, levelled or awarded XP automatically.
- Database guard: only Teachers author new records; the author and Student must be in the same school and the
  Student enrolled in the Teacher's classroom; records by other authors cannot be edited. Grants and RLS are unchanged: clients can only SELECT; writes go through the API.

## Release order (Staging)

Files: `supabase/proposed/m7_intervention_suggestions_PREFLIGHT_READONLY.sql`, `..._PROPOSED.sql`,
`..._VERIFY_READONLY.sql`, `..._ROLLBACK_PROPOSED.sql`. The migration touches only `public.m7_interventions` (6 new
columns, 7 constraints) and adds `public.m7_intervention_guard()` with its trigger. No M2 table, switch or assessment
result is read or changed; grants and RLS are unchanged.

1. Fresh Staging backup, restored and checked in an isolated container.
2. PREFLIGHT (read-only): every row PASS; record the row count and the "existing rows fingerprint".
3. Apply `m7_intervention_suggestions_PROPOSED.sql` (one transaction).
4. VERIFY (read-only): 6 PASS / 0 FAIL; the fingerprint must equal the PREFLIGHT value.
5. Deploy the backend from the merged main, then the frontend.
6. Live check per role: Teacher record/edit; School Admin read-only history (403 on record); System Admin counts;
   Student / Independent Learner practice ideas; School 1 / School 2 isolation.

Compatibility while the old code is still deployed:
- Old backend + new SQL: Teacher saves keep working (the old backend never sends the new fields). The old School
  Admin "Record intervention" is refused by the database (Teacher-only), shown as a save error until the new backend
  and frontend are deployed. Deploy the backend soon after the SQL.
- New backend before the SQL: suggestions work; saving a new field answers 503 ("not installed yet"). Do not deploy
  the backend first.
- Rollback: deploy the previous backend first, then run the ROLLBACK script (it deletes the new fields' values).
