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

## 5. Deployment on Railway (do not run until approved)

One Railway project, two services from the same GitHub repo (`Glorans/Basa-Eskwela`, branch `main`).
Teammates only use the **frontend** URL. No repository changes are needed: Railway's builder
(Railpack) detects both folders. Railway's `railway.json` config-as-code is deprecated (legacy
files work until 2026-12-01), so everything below is set in the Railway dashboard.

### 5.1 Service `backend` (Express, folder `server`)
| Setting (service → Settings) | Value |
|---|---|
| Source | GitHub `Glorans/Basa-Eskwela`, branch `main` |
| Root Directory | `/server` |
| Watch Paths | `/server/**` |
| Build | Railpack (default); installs with `npm ci` |
| Start Command | leave empty: Railpack runs `npm start` → `node server.js` |
| Healthcheck Path | `/api/health` |
| Replicas | 1 (rate limits and M2 transcript receipts are kept in memory) |
| Networking | **Generate Domain** (HTTPS `*.up.railway.app`) |

The server listens on Railway's `PORT` on all interfaces (`server.listen(port)` with no host), so no code change is needed.

Variables (service → Variables). Copy values from `%LOCALAPPDATA%\ReadFlow\basa-eskwela-server.env`.
Never use the team project's `ReadFlow\server\.env`. Don't set `PORT` or `DOTENV_PATH`.

| Name | Value |
|---|---|
| `RAILPACK_NODE_VERSION` | `24` (the version tested locally; the default is the newest LTS) |
| `NODE_ENV` | `production` |
| `SUPABASE_URL` | `https://oudfrdeqwotynihkkmze.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | staging secret key, from the env file |
| `AZURE_SPEECH_KEY` | from the env file |
| `AZURE_SPEECH_REGION` | `southeastasia` |
| `DIAGNOSTIC_RECEIPT_SECRET` | from the env file |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | from the env file (only used for teacher/admin question generation) |
| `M7_RISK_WORKER_ENABLED` | `false` |
| `FRONTEND_ORIGIN` | `https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}` |
| `DIAGNOSTIC_WS_ORIGINS` | `https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}` |

Optional: `AZURE_SPEECH_VOICE_EN`, `AZURE_SPEECH_VOICE_FIL`, `AZURE_SPEECH_TIMEOUT_MS` (defaults are fine).

### 5.2 Service `frontend` (React/Vite, folder `readflow`)
| Setting | Value |
|---|---|
| Source | same repo and branch |
| Root Directory | `/readflow` |
| Watch Paths | `/readflow/**` |
| Build Command | `npm run build` (Railpack's default for this package; type check + Vite) |
| Start Command | **leave empty**. With no start command, Railpack serves `dist` with Caddy on `PORT`, with `index.html` fallback for React Router deep links. Setting a start command turns that off. |
| Healthcheck Path | `/health` (answered by Railpack's Caddy server) |
| Networking | **Generate Domain**: this is the URL teammates use |

Variables. Vite bakes them in at build time, and Railway provides service variables to the build. **Redeploy after changing any of them.**

| Name | Value |
|---|---|
| `RAILPACK_NODE_VERSION` | `24` |
| `VITE_API_URL` | `https://${{backend.RAILWAY_PUBLIC_DOMAIN}}` |
| `VITE_SUPABASE_URL` | `https://oudfrdeqwotynihkkmze.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_…` value from `readflow/.env.local` |

- Don't set `NODE_ENV` on the frontend service; the build needs Vite and TypeScript from devDependencies.
- Never put the service key, Azure, Gemini or receipt secrets in a `VITE_*` variable; they would end up in the public JavaScript.
- `readflow/vercel.json` is unused on Railway and harmless.

The service names `backend` and `frontend` must match the `${{…}}` references exactly. If you name them differently, change the references.

### 5.3 Supabase (ReadFlow-Staging dashboard)
- **Authentication → URL Configuration:**
  - Site URL `https://<frontend>.up.railway.app`.
  - Redirect URLs `https://<frontend>.up.railway.app/**`, and keep `http://localhost:5174/**` and `http://127.0.0.1:5174/**` for local development.
  - Password reset uses `<origin>/reset-password`.
- No schema or migration changes are needed.

### 5.4 Order
1. Create the project and both services (Root Directories set) and generate both domains.
2. Add the variables to both services.
3. Deploy the backend, then the frontend.
4. Update Supabase URLs.
5. Run the smoke test in section 4.

### 5.5 Local development is unchanged
`start-backend.cmd` with `DOTENV_PATH`, Vite on port 5174 with `readflow/.env.local`, and the localhost CORS and redirect entries all keep working.

## 6. Railway limits checked against the M5/M6 implementation
- **HTTPS and microphone:** all Railway traffic is HTTPS (TLS 1.2+), so browsers allow recording. `VITE_API_URL` must be the `https://` backend domain, because mixed content is blocked.
- **Request time:** requests may run up to 15 minutes while data flows, but close after **5 minutes with no data**, and request bodies must finish uploading within 5 minutes.
  - An M5 read-aloud (at most five minutes, about 10 MB WAV) waits at most 60 s + half the recording length (3.5 minutes) for Azure. The browser itself gives up at 150 s + half the recording (5 minutes at most).
  - Both fit; slow mobile uploads of long readings are the only edge case.
- **WebSockets** (M2 live transcription) are supported.
- **Memory:** the backend uses about 100 MB idle, plus the recording being processed. The Free plan allows 0.5 GB and 1 vCPU per service. Image OCR during teacher uploads is the heaviest task.
- **Cost:** RAM is $10/GB-month and CPU $20/vCPU-month. Two always-on services cost roughly $1.3–2/month of usage.
  - The **Free plan's $1/month credit won't cover a full month.** The **Trial's one-time $5** covers a few weeks to a few months.
  - When credit runs out, deployments stop. Hobby ($5/month) is a paid plan and needs approval.
- **Disk:** container disk is temporary. Only temporary uploads use it; recordings and materials live in Supabase Storage.
- **Rate limits per user (in memory, reset on redeploy):** 60 transcription and 100 TTS requests per 10 minutes.
- **Azure:** if the Speech resource is on the free F0 tier, simultaneous recordings from several testers can hit Azure's limits ("Too many speech requests"). Check the tier in the Azure portal before a group session.
- **Supabase free plan:** limited auth emails per hour (create testers in the dashboard), and projects pause after a period of inactivity.
