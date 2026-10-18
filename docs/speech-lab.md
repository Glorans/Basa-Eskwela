# Basa Eskwela Speech Lab — Phase 1

This standalone React/Vite page and Express server exercise a provider interface with **SIMULATED fixtures only**. No Azure, Whisper, Google, Supabase, speech SDK, or production authentication module is imported. No cloud calls or database writes exist. Mock output is derived from the passage, never from audio recognition. Mock pronunciation numbers are UI fixtures, not measurements. Mock TTS is a quiet half-second tone, not speech.

## Run locally

Prerequisites: Node 24 (verified with 24.15.0 and npm 11.12.1). Frontend and backend dependencies have been installed from lockfiles with lifecycle scripts disabled. Existing Google packages are present in the backend dependency tree but are not imported or enabled by the lab. No Azure/Whisper SDKs or models were added.

## Phase 1 verification and security review — 2026-10-19

Installed targeted versions: Vite 6.4.4, esbuild 0.25.12, nanoid 3.3.18 (scoped PostCSS override), source-map-js 1.2.2. React 18.3.1, TypeScript 5.9.3, React plugin 4.7.0, Tailwind 3.4.19, React Router DOM 6.30.4, Express 5.2.1 and Multer 2.4.0 remain in use. The backend manifest and lockfile were not changed by installation. The lab explicitly sets an empty PostCSS plugin list so the main Tailwind configuration is not loaded.

TypeScript checks and the isolated Vite production build passed. All 14 backend tests passed, including the formerly skipped HTTP integration test, upload size rejection, disabled providers, language/scenario fixtures, error handling, cancellation, and static import isolation. The HTTP harness uses node:http because Node fetch normalizes Host, preventing the original ephemeral-port test from exercising the fixed Host policy correctly. No production API policy was relaxed.

Both servers started on the configured IPv4 loopback addresses. HTTP checks verified the page and transformed entry, the API proxy, English/Filipino scenarios, and rejection of the production frontend entry. The owner subsequently confirmed successful rendering in Chrome after the Vite internal-module fix below. Microphone permissions/capture, 30-second automatic stop, audible playback, browser cancellation/cleanup, and JSON download remain manual checks unless separately exercised. Passing API checks is not a claim that these browser interactions were exercised.

The isolation middleware initially blocked `/node_modules/vite/dist/client/env.mjs`, which Vite 6 imports from its transformed `/@vite/client`. The fix permits that exact trusted module path. HTTP verification confirmed all 15 discovered client modules returned 200 while protected application paths remained blocked. No dependency cache reset or broader application access was required.

Remaining frontend audit: **9 affected entries (5 high, 4 moderate)**. High: braces, chokidar, fast-glob, micromatch, tailwindcss. Moderate: postcss-nested, postcss-selector-parser, react-router, react-router-dom. Tailwind/glob/parser findings remain installed but the lab bypasses the application PostCSS pipeline; the lab does not import React Router. These are residual repository findings, not fixed vulnerabilities. Vite/esbuild/nanoid/source-map-js are no longer reported by the audit.

Remaining backend audit: **6 affected entries (3 high, 3 moderate)**. High: braces, chokidar, nodemon. Moderate: sprintf-js, argparse, mammoth. The direct lab launcher does not import these chains. No automatic audit fixes, Tailwind/Router migrations, or Mammoth/Nodemon downgrades were performed. No cloud or database services were accessed. Broader application use still needs separate review of these findings.

For a reproducible reinstall, from the repository root (downloads require npm registry access):

```powershell
npm.cmd --prefix readflow ci --ignore-scripts --no-fund
npm.cmd --prefix server ci --ignore-scripts --no-fund
```

Lifecycle scripts remain disabled; do not run the regular application startup to verify this lab. The Windows sandbox may block esbuild process spawning with `EPERM`; the build succeeded when allowed to spawn its normal compiler process, without changing PowerShell policy or global settings.

From the Basa-Eskwela repository root, open two PowerShell terminals:

```powershell
cd server
npm.cmd run speech-lab
```

```powershell
cd readflow
npm.cmd run dev:speech-lab
```

Open **http://127.0.0.1:5174/speech-lab.html**. Both servers bind to IPv4 loopback only. The API uses port 5002; Vite proxies `/api/speech-lab/`. Do not launch the regular application server for this lab. If the API was unavailable on page load, start it and reload the page.

Run tests from the repository root (core tests require no installed packages):

```powershell
node --test server/experiments/speech-lab/tests/*.test.js
```

If a sandbox blocks the test runner's child processes with `spawn EPERM`, use Node 24's in-process runner:

```powershell
node --test --experimental-test-isolation=none server/experiments/speech-lab/tests/*.test.js
```

The commands use `npm.cmd` to work with Windows PowerShell execution policies that block `npm.ps1`; no policy change is required.

Optional frontend type-check and isolated build, once dependencies are available:

```powershell
cd readflow
npm.cmd run build:speech-lab
```

The lab HTML is not an input to the regular application build. Its separate output is `dist-speech-lab/` (ignored). Treat this as a development tool; do not deploy it as a public unauthenticated upload endpoint.

## Exercise the interface

1. Choose English or Filipino, a mock provider, and an operation.
2. Select a neutral sample or enter non-identifying text (maximum 5,000 characters).
3. For recognition/assessment, record a consenting adult or upload neutral audio. Never use student audio or names. Even a neutral voice may identify a speaker.
4. Preview the audio and run the simulation. Playback does not run automatically.
5. Try complete, discrepancies, incomplete, no-speech, error, and slow scenarios. Slow takes five seconds and can be cancelled. TTS uses error/slow; recognition-only scenarios have no effect on its tone.
6. Choose the STT/TTS-only mock and select pronunciation: it must show unavailable and disable Run.
7. Change languages: audio is cleared to avoid accidental cross-language reuse. Results are displayed and exported separately per language.
8. Export optional JSON (no audio), or clear everything. The last 50 successes are retained in memory. Errors are displayed, not ranked or silently counted as zero. Reload closes this temporary session.

## Audio and cleanup

Limits are 30 seconds and 10 MB, enforced again on the backend. Browser-decodable audio is converted in memory to mono 16 kHz signed 16-bit PCM WAV. Uploads over 30 seconds are rejected. Microphone capture stops automatically; a trailing recorder chunk is trimmed to 30 seconds. Browser codec support varies; use PCM WAV if decoding fails. Sample-rate conversion changes the input, so future benchmarks must reuse this same prepared audio for every provider.

The server checks RIFF chunk bounds, PCM format, duration and byte limits. It uses bounded Multer memory storage with one active experiment at a time; it never writes audio to disk. Microphone tracks stop on stop/clear/unmount. Object URLs are revoked, audio contexts closed, and abort signals cancel adapter delays on request disconnect. The request timeout is 15 seconds server-side and 20 seconds client-side. Clearing an in-progress decode discards its result; browser decode itself cannot reliably be interrupted, but its context is closed on completion. Memory release is subject to browser/Node garbage collection.

## Adapter contract and extension

`providerRegistry.js` is the explicit allowlist. Each entry declares ID, status, languages, operations, formats, and maximum audio duration/bytes. An adapter implements:

```text
transcribe({ audio, audioMetadata, language, text, scenario, signal })
synthesize({ text, language, scenario, signal })
assessPronunciation({ audio, audioMetadata, language, text, scenario, signal })
```

`text` is the expected passage; mocks use it to generate fixtures. A future unbiased STT adapter must not send it as a recognition hint. Responses retain completeness, optional transcript, optional pronunciation (kind, label, original scale, supported scores), warnings and timing metadata. Null means unavailable, never zero. Registry language identifiers `en` and `fil` are UI choices; future adapters must explicitly map and report their supported service locale. Do not silently fall back to another language.

Azure, Whisper, and Google entries are disabled with no adapter implementations. Add a new provider by implementing this contract and registering its actual capabilities; do not reuse production clients. Live configuration, dedicated test credentials, network access, and dependencies need a separate phase and approval. No automatic machine credential discovery is permitted.

Batch Blob/Buffer input and AbortSignal are independent of the 30-second limit. A later five-minute mode will require explicit capability/limit updates, bounded transport/storage, long-running request handling, provider quotas, streaming or asynchronous processing where appropriate, and revised tests. Increasing a single constant is not sufficient.

## Interpreting results fairly

- Transcript agreement uses Unicode NFC, lowercase tokens and punctuation removal, preserving apostrophes. It reports possible substitutions, omissions and insertions against the intended passage. It is not acoustic pronunciation assessment.
- Incomplete and no-speech scenarios suppress agreement and fixture scores. No accuracy percentage is generated.
- For real STT benchmarking, compute WER against a human-verified transcript of what was actually spoken, not automatically against the intended passage. Report intended-passage discrepancies separately.
- Keep English and Filipino cohorts separate; preserve model, locale, audio preprocessing, format, duration and settings. Reuse identical recordings across providers.
- Later compare provider and end-to-end latency (median/p95), failures/timeouts, cost, TTS listening ratings, and provider pronunciation scores against human judgments. Provider score scales are not interchangeable.
- The current mock timings include fixture delay and cannot rank services. Adult tests and synthetic tones do not validate Grade 5 performance.

## Isolation boundaries

The lab has its own HTML, React entry, CSS, Vite configuration and Express launcher. It does not import `App.tsx`, `AuthProvider`, production Supabase clients, `server.js`, Google speech services, or M2/M5/M6. It reads no application or machine cloud configuration. Vite uses a separate ignored environment directory and a non-production public-variable prefix. Its middleware blocks application entry/source routes and sets a Content Security Policy restricting browser connections to this local origin and the local Vite WebSocket. The API rejects unexpected Host/Origin and requires a lab header for writes; there is no permissive CORS policy.

Automated tests check core mocks, empty/incomplete results, alignment, input limits, cancellation and the dependency boundary, including mock execution with common network APIs blocked. HTTP tests automatically skip if Express/Multer are missing. These checks establish the current implementation's boundaries; they are not an OS-level network sandbox. Manually verify microphone permissions, playback, automatic stop, exports and browser cleanup once frontend dependencies are installed.
