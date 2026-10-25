# M5/M6 Team Testing and Deployment Guide

Target database: **ReadFlow-Staging** (`oudfrdeqwotynihkkmze`) only. Never point any
Basa-Eskwela setting at the team's original ReadFlow project.

## 1. Readiness status (checked 2026-10-26)

### Verified
- **Frontend config** (`readflow/.env.local`): `VITE_API_URL=http://127.0.0.1:5001`, staging Supabase URL and a publishable key. No backend secret appears in the production build.
- **Backend config** (`%LOCALAPPDATA%\ReadFlow\basa-eskwela-server.env`, loaded through `DOTENV_PATH` by `start-backend.cmd`):
  - the staging service key reaches staging;
  - the Azure key and region (`southeastasia`) are valid (format check only, no Azure call);
  - voices are `en-US-JennyNeural` / `fil-PH-BlessicaNeural`;
  - the M2 receipt secret is set.
- **Backend routes:** `/api/health` responds. `/api/tts`, `/api/read-aloud/audio`, `/api/oral-reading/*` and `/api/comprehension/*` return 401 without a login, before any Azure or database work. CORS allows only the configured origins.
- **Staging database:**
  - RLS is on for every M5/M6 table.
  - Answer keys are readable only by admins and the owning teacher.
  - The M6 answer/complete function and M8 XP functions are server-only.
  - Recordings go to the private `oral-reading-recordings` bucket (25 MB limit), which only the backend can reach.
- **Content:** "A Helping Hand" (English, 9 reviewed questions) is assigned to the test student. "Ang Puno ng Narra" (Filipino, 12 reviewed questions) exists but is **not assigned**.
- **Automated tests:**
  - frontend unit tests 876/876;
  - full-flow browser test 20/20 (M4 → M5 → M6 → results, EN/FIL, 1366/390/320 px);
  - M6 story-drawer browser test 36/36;
  - mascot layout at 320–1920 px;
  - server speech tests 29/29;
  - the production build.

### Not yet verified with real services
Real microphone recording, Azure transcription, English pronunciation assessment, recording upload and playback, Azure TTS audio, and the hosted (HTTPS) deployment. These are the manual tests in sections 3–4.

### Blocking team testing (setup, not code)
1. **No Filipino assignment.** Signed in as the teacher, assign "Ang Puno ng Narra" (with its reviewed question set) to each tester's student account.
2. **One student account only.** Each tester needs their own student account, joined to the teacher's Learning Room by code, with both stories assigned. Assignments are per student.
3. **No published modules.** Independent Learners can only read published modules, and staging has none, so their M5/M6 can't be tested. An admin must publish at least one English and one Filipino module with a passage and a reviewed question set. Generating questions uses Gemini, which needs approval.
4. **Not hosted yet.** Teammates can't reach the app until section 5 is done.

### Can wait
- On phones, the M5 docked mascot reserves space before recording. The story and Start Recording need a short scroll until the learner starts or taps ✕.
- On the smallest phones the M6 compact popup can partly cover an answer option. It never covers the buttons or the hint, and it moves when the learner scrolls.
- New learners are sent to the M2 diagnostic after login. To skip it, open **Learning Rooms** from the menu.

## 2. Accounts and setup

| Account | Use | How |
|---|---|---|
| Teacher (approved) | Room, assignments, review results | Existing staging teacher |
| Student × each tester | M5/M6 via assigned stories | Sign up as Student, join the room code, teacher assigns both stories |
| Independent Learner | M5/M6 via published modules | Sign up as Independent Learner (after blocker 3) |
| Admin | Publishing modules, oversight | Existing staging admin |

Create accounts in the Supabase dashboard (**Authentication → Users → Add user**, "Auto Confirm User" on), because the built-in email service only sends a few emails per hour. Then sign in once to pick the role. Use only test data.

## 3. Manual real-world tests

Use Chrome or Edge, a quiet room and a headset if possible, and record 30–60 seconds. Each M5 reading makes one paid Azure transcription request. The English pronunciation check and every 🔊 press are separate paid requests, made only when pressed.

### English: "A Helping Hand"
1. As the student, open **Learning Rooms → room → A Helping Hand**. The header says English, the page is in English, and the mascot encourages you.
2. **Start Recording** → allow the microphone → read the story → **Stop Recording**. The mascot disappears while recording. The status steps are Preparing → Sending → Recognizing → Saving.
3. Result page: the accuracy %, words per minute, words correct, and the transcript with differences highlighted match what you read. The mascot shows the star message.
4. **Feedback & Practice:** your recording plays back. **Check pronunciation** (English only, one Azure call) shows word scores. 🔊 on a practice word plays it.
5. **Continue to Questions:** Question 1 of 9, Literal first. The order is Literal → Inferential → Critical.
6. **View Story** shows the saved story; ✕ and Escape close it, and your selection stays.
7. **Help me:** the hint box appears and the mascot says "Here is a hint…" on its own.
8. Choose a wrong answer → **Check answer**: the mascot says "Not quite…" and **Check second answer** appears. Choose the right one: the thumbs-up mascot says "Correct!…". Close the mascot with ✕; it stays closed until your next answer.
9. Get one question wrong twice: the correct answer and explanation appear under **Review answer feedback**.
10. Finish: the results page shows the first-answer score, the per-category scores and the hints-used count. The completion mascot appears.
11. Go back to the Learning Room: the status is **Completed**, and reopening shows the saved results. **Reading History** reopens the reading result and recording.
12. Teacher: the student's oral-reading result, recording and comprehension results are visible for the room.

### Filipino: "Ang Puno ng Narra" (after blocker 1)
Repeat steps 1–12. Also check:
- the whole interface is in Filipino (e.g. "Simulan ang Pagre-record", "Tulungan ako", "Tama!…", "Hindi pa tama…");
- the transcript recognises Filipino words;
- the Feedback panel says pronunciation scoring is English only;
- questions, hints and explanations show exactly as the teacher reviewed them.

### Optional: text-to-speech (EN and FIL)
Each press makes one paid Azure TTS request; a replay of the same text doesn't.
1. English result → practice word 🔊: English voice (Jenny).
2. In M6, the hint 🔊 and explanation 🔊 (after a question is finished) read the visible text.
3. Repeat in Filipino: Filipino voice (Blessica).
4. Press 🔊 twice: the second press plays without loading. Start a different clip: the first one stops.
5. The mascot has no audio controls.

### Bug report format
User role · activity and story · language · device, screen size and browser · steps · expected · actual · error message or screenshot · time (for log lookup).

## 4. Smoke test after deployment
1. `https://<backend>/api/health` returns `{"success":true,...}`.
2. Open `https://<frontend>/` and sign in. Refresh a deep link (e.g. `/dashboard/learning-rooms`); it must not 404.
3. Run the English test above once on a laptop and once on a phone over HTTPS. The microphone prompt must appear.

## 5. Deployment (do not run until approved)

The order matters: backend first, then frontend, then the backend's allowed origins, then Supabase URLs.

### 5.1 Backend: Express (Render web service, or any always-on Node host)
Don't move the backend into Vercel serverless functions. A five-minute read-aloud upload is about 10 MB, and transcription can take more than three minutes. Both exceed typical serverless body and duration limits.

| Setting | Value |
|---|---|
| Root directory | `server` |
| Build command | `npm ci` |
| Start command | `npm start` (runs `node server.js`; it binds to `PORT` from the host) |
| Health check path | `/api/health` |
| Instances | **1** (rate limits and M2 transcript receipts are kept in memory) |
| Node | set `NODE_VERSION=24` (the version tested locally) |

Environment variables. Set them on the host; never commit them. **Don't** set `DOTENV_PATH` there.

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SUPABASE_URL` | `https://oudfrdeqwotynihkkmze.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | staging secret key (from the local env file / Supabase dashboard) |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | from the local env file (`southeastasia`) |
| `AZURE_SPEECH_VOICE_EN`, `AZURE_SPEECH_VOICE_FIL` | optional; defaults `en-US-JennyNeural`, `fil-PH-BlessicaNeural` |
| `AZURE_SPEECH_TIMEOUT_MS` | optional, default `60000` |
| `DIAGNOSTIC_RECEIPT_SECRET` | same value as the local env file (≥ 32 characters) |
| `FRONTEND_ORIGIN` | `https://<frontend-domain>` (comma-separate extra origins; keep localhost only if testing locally against the hosted backend) |
| `DIAGNOSTIC_WS_ORIGINS` | `https://<frontend-domain>` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | only needed for teacher/admin question generation |
| `M7_RISK_WORKER_ENABLED` | `false` |

### 5.2 Frontend: Vercel
| Setting | Value |
|---|---|
| Root directory | `readflow` |
| Framework preset | Vite |
| Build command | `npm run build` (type check + Vite) |
| Output directory | `dist` |
| SPA routing | `readflow/vercel.json` rewrites every path to `index.html` |

Environment variables (Production). Vite bakes them into the build, so **redeploy after changing them**:

| Name | Value |
|---|---|
| `VITE_API_URL` | `https://<backend-domain>` (no trailing slash; must be HTTPS) |
| `VITE_SUPABASE_URL` | `https://oudfrdeqwotynihkkmze.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | staging publishable key (`sb_publishable_…`) |

Never add the service key, Azure, Gemini or receipt secrets to any `VITE_*` variable; those end up in the public build.

### 5.3 Supabase (ReadFlow-Staging dashboard)
- **Authentication → URL Configuration:** Site URL `https://<frontend-domain>`. Redirect URLs `https://<frontend-domain>/**`, plus `http://localhost:5174/**` for local work. Password reset uses `<origin>/reset-password`.
- No schema or migration changes are needed.

### 5.4 HTTPS and microphone
Browsers only allow microphone recording on HTTPS (or localhost). Vercel and Render both serve HTTPS. Mixed content (HTTPS page → HTTP API) is blocked, so `VITE_API_URL` must be HTTPS.

## 6. Hosting limits to expect
- **Render free plan:** the service sleeps after about 15 minutes without traffic, so the first request takes about a minute. Open `/api/health` before a test session. It also has 512 MB of memory (image OCR during teacher uploads is the heaviest task) and a disk that is wiped on restart (temporary uploads only; recordings and materials live in Supabase Storage). Check the current plan terms before relying on them.
- **Rate limits per user (in memory, reset on restart):** 60 transcription and 100 TTS requests per 10 minutes.
- **Azure:** if the Speech resource is on the free F0 tier, simultaneous recordings from several testers can hit Azure's concurrency and quota limits ("Too many speech requests"). Check the tier in the Azure portal before a group session.
- **Supabase free plan:** limited auth emails per hour, and projects pause after a period of inactivity.
- **Vercel Hobby plan:** fine for a non-commercial capstone.
