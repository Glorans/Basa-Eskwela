# Speech Lab Phase 2 — offline implementation

Implemented 2026-10-20 in Glorans/Basa-Eskwela. Azure is **disabled by default**. No Azure resource, credentials, paid processing, or live speech requests were used during implementation. M2, M5, M6, production entry points, Google clients and Supabase are outside this integration.

## Supported operations

| Operation | English | Filipino |
| --- | --- | --- |
| Continuous STT | en-US | fil-PH |
| Acoustic pronunciation assessment | en-US; Azure 0–100 segment/word scores | Unsupported; rejected before SDK creation |
| Neural TTS | en-US-JennyNeural / en-US-GuyNeural | fil-PH-BlessicaNeural / fil-PH-AngeloNeural |

The existing adapters remain available. Mock transcripts still come from the passage; mock TTS remains a tone. Azure never silently falls back to a mock or another language/provider. UI, results and JSON exports distinguish REAL AZURE from SIMULATED. Failed runs are not stored as zero-score successes.

Recognition uses `SpeechRecognizer.startContinuousRecognitionAsync`, accumulates final utterances, and finishes at the session end. STT does not send the expected passage as a hint. Assessment uses `PronunciationAssessmentConfig` with HundredMark, phoneme granularity, reference text, and miscue disabled. Word scores and segment accuracy/fluency are retained; unsupported/missing values are null. No aggregate overall score is fabricated. Continuous assessment does not support Azure omission/insertion detection or enable prosody in this lab.

Independent STT produces a separate local reading-agreement estimate: `100 × matched reference words / reference words`. Substitutions and omissions reduce matches; insertions are reported separately. This estimate is neither acoustic pronunciation nor benchmark WER. WER needs a human-verified transcript of what was actually spoken. The reference-conditioned assessment transcript is not used for this reading percentage. Run STT separately if both metrics are needed; each pass consumes its own allowance. Recognition status describes processing, not whether the child finished the passage.

## Dependency and security review

Backend-only direct addition: `microsoft-cognitiveservices-speech-sdk` **1.52.0**, pinned exactly. Installed with `--ignore-scripts`. Node 24.15.0 successfully loads the SDK and parses real SDK assessment objects offline. The resolved Azure runtime dependencies require Node >=22. No frontend package was added.

Before installation, a copy of the backend manifests was resolved in ignored `speech-lab-local/azure-review` using `--package-lock-only --ignore-scripts`. The candidate graph was audited and compared with the baseline. No existing lockfile entries changed. Eleven packages were added:

| Package | Version |
| --- | --- |
| microsoft-cognitiveservices-speech-sdk | 1.52.0 |
| @azure/abort-controller | 2.2.0 |
| @azure/core-auth | 1.11.0 |
| @azure/core-util | 1.14.0 |
| @typespec/ts-http-runtime | 0.3.9 |
| @types/webrtc | 0.0.37 |
| bent | 7.3.12 |
| bytesish | 0.4.4 |
| caseless | 0.12.0 |
| is-stream | 2.0.1 |
| uuid | 11.1.1 |

Existing compatible ws, proxy agents and tslib are reused. No new advisories were reported for the candidate graph. Existing findings remain:

- Backend: **6 affected entries: 3 high** (braces, chokidar, nodemon), **3 moderate** (sprintf-js, argparse, mammoth).
- Frontend: **9 affected entries: 5 high** (braces, chokidar, fast-glob, micromatch, tailwindcss), **4 moderate** (postcss-nested, postcss-selector-parser, react-router, react-router-dom).

These are affected package entries, not counts of distinct vulnerabilities. No audit fix was run. The lab launcher bypasses nodemon/mammoth; the isolated frontend bypasses the application Tailwind pipeline and React Router. Existing findings are not claimed to be fixed or harmless for broader application use.

## Dedicated backend configuration

Only `server/experiments/speech-lab/.env.local` is parsed, using Node's `parseEnv`. It is excluded by `.env.*` in `.gitignore`. The committed `.env.example` contains no credentials and defaults both switches to false. No real `.env.local` was created.

The loader does **not** merge process environment, application `.env`, machine credentials, Azure CLI/managed identity, Google credentials or Supabase configuration. No identity package or automatic credential discovery is used. Do not put keys into Vite or frontend variables.

| Setting prefix: SPEECH_LAB_AZURE_ | Meaning/default |
| --- | --- |
| ENABLED | false; must explicitly be true |
| LIVE_APPROVED | false; set true only after separate live-testing approval |
| RESOURCE_TIER | F0 only; S0 rejected |
| KEY | Dedicated Speech resource key; never returned to React |
| REGION | Exact region of the resource |
| VOICE_EN / VOICE_FIL | Allowlisted voices in the example file |
| TIMEOUT_MS | 60000; positive integer, at most 60000 |
| SESSION_AUDIO_SECONDS | 300; at most 1800 |
| SESSION_TTS_CHARACTERS | 5000; at most 50000 |
| TTS_PER_MINUTE | 10; at most 20 |

Invalid configuration fails closed with a generic readiness reason. Only public provider capabilities are serialized. The adapter lazily imports the SDK when a permitted operation starts; listing providers and running mocks never create cloud clients. Telemetry is disabled. The pinned SDK recognition connection retry count is set to zero via its `SPEECH-Error-MaxRetryCount` property; recheck this implementation-specific setting when upgrading the SDK. There is no application retry, paid-mode switch or paid fallback.

**F0 is a declared setting, not a verified billing fact.** A Speech key does not prove the resource pricing tier. The owner must verify the resource is F0 before enabling it. Local counters are not Azure billing quotas. They reset on server restart, cannot account for other tools/resources, reserve usage before submission and do not refund failures/cancellation. Input audio is rounded up to seconds per operation; text uses Unicode code points as a local estimate. Microsoft remains authoritative for actual billable character/audio usage.

## Limits and lifecycle

- Input: 30 seconds, 10 MB upload, browser preparation to mono 16 kHz signed 16-bit little-endian PCM WAV. Backend verifies RIFF/chunks, encoding, rate, alignment and duration. Azure rejects other rates. The actual data chunk is extracted, without headers or Buffer-pool padding.
- TTS: plain text only, at most 1000 characters, 2 MB RIFF PCM output. Output is validated separately and may exceed 30 seconds. No SSML, custom voices or remote audio references.
- One operation at a time; concurrency remains held until cleanup completes. TTS additionally uses a rolling 60-second rate limit.
- Upload deadline: 15 seconds. Azure adapter deadline: configurable up to 60 seconds. SDK cleanup deadline: 2 seconds. HTTP operation backstop: 65 seconds for Azure, 15 seconds for mocks. Frontend deadline: 75 seconds for Azure, 20 seconds for mocks.
- Abort, timeout, service failure and success all dispose SDK clients, audio configuration, input streams and listeners. A cleanup failure disables additional Azure work for that adapter session; restart is required. Cancelling cannot retract audio already submitted or guarantee zero charges.
- Local buffers are not written to disk. Microphone tracks/object URLs keep their Phase 1 cleanup. History stores at most 50 records without synthesized audio; only the current result retains playback bytes. Exports omit audio and use a field allowlist. Local memory release remains subject to garbage collection.
- Public errors are allowlisted and sanitized; no raw SDK diagnostics, key, configuration object or stack is sent to React. Frontend does not import the SDK. Loopback, Host/Origin, write-header and CSP restrictions remain in place.

Timing uses monotonic clocks: adapter elapsed ends before local comparison; server processing includes comparison; client round trip includes upload/response parsing; preparation is separate. Adapter elapsed includes SDK setup, network/service time, result mapping and cleanup, not pure Azure compute time. Fixture timing is not a cloud benchmark.

## Offline verification

From the repository root:

```powershell
node --require ./server/experiments/speech-lab/tests/networkGuard.cjs --test --experimental-test-isolation=none server/experiments/speech-lab/tests/*.test.js
npm.cmd --prefix readflow run build:speech-lab
```

The network guard blocks external socket connections, TLS and fetch while allowing loopback HTTP tests. All Azure operations use an injected fake SDK; the actual SDK is loaded only to verify offline compatibility and JSON parsing. HTTP tests verify configuration and diagnostic secrets do not enter responses/logs. Export tests verify extra key/config/audio fields are excluded. Static source/bundle checks confirm backend SDK/configuration is absent from React.

At implementation verification: **30 tests passed, none skipped**, including all 14 Phase 1 tests. TypeScript and the isolated Vite build passed. Windows required allowing the normal esbuild child process after sandbox EPERM. No browser microphone/live Azure behavior is claimed to have been verified by these tests.

## Beginning live testing — separate approval required

1. Obtain explicit approval for live Azure testing. Do not send student recordings during the initial evaluation.
2. Have the owner provide a dedicated nonproduction F0 Speech resource and confirm its actual tier, region, monthly remaining allowance and selected voice availability. No resource is created by this implementation.
3. Copy `.env.example` to the dedicated `.env.local`; enter the dedicated key privately. Never paste it into chat or commit it. Enable both switches only within the approved scope.
4. Restart the isolated backend with `npm.cmd --prefix server run speech-lab`; run the frontend with `npm.cmd --prefix readflow run dev:speech-lab`. Use the Phase 1 localhost URL. Confirm the Azure provider is marked REAL AZURE.
5. Use one short neutral consenting-adult clip for English STT, English assessment and Filipino STT, with separate language-appropriate recordings. Test short TTS text in both languages. Inspect scores, transcripts, audio, cancellation and actual resource usage.
6. Stop if configuration, tier, quota or billing differs from the approved setup. Do not upgrade to S0 automatically. Reuse identical prepared clips for comparisons, retain locale/settings metadata, and validate educational accuracy against human judgments separately.

Live recognition quality, latency, voice availability and billing remain unverified until that approval and evaluation.
