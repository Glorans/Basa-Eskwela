# M5–M8 demonstration checklist

Branch `integration/m5-m8`. Use adult tester voices only; never real children's recordings.
Keep `M7_RISK_WORKER_ENABLED` unset or `false`. Azure is not used by the app (Speech Lab only).

## 1. Configuration (values never shared or committed)

`server/.env` (copy from `server/.env.example`):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `FRONTEND_ORIGIN` and
`DIAGNOSTIC_WS_ORIGINS` (example: ports 5174), `PORT` (example: 5001), `GOOGLE_STT_SAMPLE_RATE`, and
Google speech credentials (Application Default Credentials, or `GOOGLE_APPLICATION_CREDENTIALS` pointing to
a dedicated key file outside the repository; replace the example's deliberately invalid path).

`readflow/.env.local` (copy from `readflow/.env.example`):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_URL` (example: `http://127.0.0.1:5001`).

Both must point to the **same isolated demo Supabase project**, never the shared ReadFlow team database.
Ports 5001/5174 keep Basa-Eskwela apart from the team app (5000/5173).

## 2. Start

The Speech Lab frontend is pinned to `127.0.0.1:5174`. Stop the Speech Lab dev servers first (Azure is
not part of this demo), then:

```
cd server   && npm start                                              # API on :5001 (from PORT)
cd readflow && npm run dev -- --host 127.0.0.1 --port 5174 --strictPort   # app on http://127.0.0.1:5174
```

## 3. Accounts (in the demo project)

| Role | Needs |
|---|---|
| Admin | `profiles.role = 'admin'` |
| Teacher | `role = 'teacher'`, `teacher_status = 'approved'`, owns one learning room |
| Student | `role = 'student'`, completed initial diagnostic, enrolled in the teacher's room, one assigned reading activity (read aloud + questions) |
| Independent learner | `role = 'general_user'`, completed initial diagnostic |

## 4. Test passages

**English (72 words; scored as 72):**
Every Saturday morning, Lina walks with her grandfather to the small market near the river. They buy ripe mangoes, fresh fish, and a bundle of green vegetables. Grandfather greets every vendor by name, and they smile back at him. On the way home, Lina carries the basket carefully so the eggs will not break. When they reach the house, they cook breakfast together and share the warm food with the whole family.

**Filipino (74 words; scored as 75, "pag-uwi" counts as two):**
Tuwing Sabado ng umaga, naglalakad si Lina kasama ang kanyang lolo papunta sa maliit na palengke malapit sa ilog. Bumibili sila ng hinog na mangga, sariwang isda, at isang tali ng gulay. Binabati ni Lolo ang bawat tindera, at ngumingiti naman sila sa kanya. Sa pag-uwi, maingat na binubuhat ni Lina ang basket upang hindi mabasag ang mga itlog. Pagdating sa bahay, sabay silang nagluluto ng almusal at masayang kumakain kasama ang buong pamilya.

At a normal pace each takes about 40–50 s, so each recording crosses the 25 s part boundary (2 parts).

## 5. Checklist

Record for each step: pass/fail, time taken, and any message shown.

### M5 oral reading (works before migration)
- [ ] Student: open the assigned activity, record the English passage at a normal pace. Note the recording
      time shown and that it stops by itself only at 5:00.
- [ ] Result page: accuracy, speed (WPM), words to practise; transcript agreement looks right
      (expect high accuracy for a clean read).
- [ ] Before migration #1: "Continue Without Recording" appears after saving; the result still opens.
- [ ] Refresh the result page and reopen it from Reading History: same scores (persistence).
- [ ] Independent learner: repeat with the Filipino passage; screens appear in Filipino.
- [ ] Admin: Oral Reading → Start Read-Aloud → result → My Reading History. No comprehension link;
      admin cannot open learning-room activities.
- [ ] Teacher: Reading Results lists only own-room students; admin and independent learner results absent.

### M5 playback (requires migration #1)
- [ ] After saving, the result page shows "Listen to your recording" with Part 1 of 2, Part 2 of 2.
- [ ] Press play on Part 1: it continues into Part 2 without skipping or repeating; manual controls work.
- [ ] Long test: read the English passage three times slowly (over 2 minutes, 5–6 parts). Playback runs
      all parts in order. Accuracy will drop (repeated words count as extra words); that is expected.
- [ ] Listen at each part boundary for a short gap (about tens of milliseconds, from the shared recorder),
      separately from playback behaviour.
- [ ] Teacher opens the student's result: "Student's recording" plays; another teacher cannot.

### M6 comprehension (works before migration)
- [ ] Student continues from the result to the questions; first-try score and hints are saved.
- [ ] Teacher review shows the comprehension score for that reading.

### M7 analytics
- [ ] Student: My Progress & Results (expected to work before migration).
- [ ] Teacher: Analytics page and completion analytics (expected to work before migration).
- [ ] Admin: System Performance (requires #7).
- [ ] Teacher: Student Support (requires #7; empty until the worker is deliberately enabled later).
- [ ] Teacher: Reports → generate a weekly report, reopen it, export PDF (requires #8).

### M8 gamification (requires #2–#6)
- [ ] Student completes a module's comprehension → XP and badges update in My Badges.
- [ ] Classroom leaderboard shows only classmates; independent leaderboard shows only independent learners.
- [ ] Admin practice earns no XP and never appears on a leaderboard.
- [ ] Before migration: pages show a load error rather than sample data.

### Regression (M1–M4)
- [ ] Sign-up/login/logout, role selection, teacher verification approval.
- [ ] Initial diagnostic (English and Filipino) completes and places the learner.
- [ ] Admin content management and module creation; teacher material upload.
- [ ] Teacher creates a learning room; student joins with the room code; assignment and completion status.
