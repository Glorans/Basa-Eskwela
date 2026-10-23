# Azure Speech integration (replaces Google STT/TTS)

Status 2026-10-24: implemented and tested offline with a simulated Azure SDK.
**No live Azure request has been made yet.** Google speech packages and
`GOOGLE_APPLICATION_CREDENTIALS` are no longer used. Gemini question generation
(`@google/genai`) is unrelated and unchanged.

## What uses Azure

| Feature | Endpoint / path | Azure operation |
|---|---|---|
| M2 diagnostic live stream; M5 voice-follow | `WS /ws/diagnostic/speech` (16 kHz PCM) | Continuous recognition through a push stream. Interim results drive word highlighting; final utterances are ordered by audio offset. |
| M2 upload fallback; M5 read-aloud transcript | `POST /api/diagnostic/audio` | Continuous recognition of one 16 kHz WAV part (at most 30 s). The browser converts each 25 s WebM part first. |
| Word pronunciation audio | `POST /api/tts` | Neural TTS: `en-US-JennyNeural` / `fil-PH-BlessicaNeural`, MP3 output, up to 1,000 characters |
| English pronunciation feedback (M5 result page) | `POST /api/oral-reading/attempts/:id/pronunciation` | Pronunciation Assessment (HundredMark, word granularity, miscue off) against the passage saved with the learner's own attempt |

Locales: `en` → `en-US`, `fil` → `fil-PH`.

## Behaviour

- **DT1 is unchanged.** The server signs only the final transcript Azure produced for that learner's audio. Receipts, the passage hash, the active-assessment binding and the M2 rubric stay as they were. The browser still never sends scores or transcripts for M2.
- **Reading accuracy and pronunciation are separate.**
  - The saved M5 score is still transcript-based; the student result card is now labelled "Reading Accuracy".
  - Azure pronunciation runs only when an English learner presses **Check my pronunciation**. It is shown on screen and not saved.
  - Filipino readings never call Pronunciation Assessment: the endpoint returns `PRONUNCIATION_UNSUPPORTED`.
  - The UI shows Azure's own 0–100 scores, averaged across utterances and weighted by word count, plus the words Azure flagged. No other score is derived.
- **Configuration.**
  - With a missing or invalid `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION`, every speech request returns 503 `SPEECH_NOT_CONFIGURED` with a clear message. There is no fallback provider.
  - The backend still starts without them, and without any Google credential.
- **Errors.**
  - Azure cancellations map to the existing safe codes: authentication or forbidden → `STT_PERMISSION`, too many requests → `STT_QUOTA`, service timeout → `STT_DEADLINE`, anything else → `STT_PROVIDER_ERROR`.
  - Every operation has a deadline (`AZURE_SPEECH_TIMEOUT_MS`, default 60 s).
  - SDK clients are closed on every path. Telemetry is off and SDK connection retries are 0, as in the Speech Lab.
- **Unchanged:** 25 s segmentation, the five-minute safeguard, per-user rate limits, stream session limits, M5 WebM recording storage and playback, M6 authorization, M8 XP rules, M7 analytics, M4.

## Configuration (backend env file only, never `VITE_*`)

| Variable | Required | Notes |
|---|---|---|
| `AZURE_SPEECH_KEY` | yes | Azure portal → Speech resource → Keys and Endpoint → KEY 1 |
| `AZURE_SPEECH_REGION` | yes | That resource's region code, e.g. `southeastasia` |
| `AZURE_SPEECH_VOICE_EN` / `AZURE_SPEECH_VOICE_FIL` | no | Allowlisted Jenny/Guy and Blessica/Angelo voices |
| `AZURE_SPEECH_TIMEOUT_MS` | no | 5000–120000 |

`GOOGLE_STT_SAMPLE_RATE` and `GOOGLE_APPLICATION_CREDENTIALS` are no longer read. They were removed
from `server/.env.example` and the protected backend env file on 2026-10-24.

## Needs live verification

- Recognition quality in both locales.
- Interim and final timing during a real stream.
- Finalization time after Stop (drain deadline 15 s).
- 25 s WAV upload latency.
- Neural voice output.
- Pronunciation scores on real English readings.
- Decoding saved WebM recordings in each browser, using `AudioContext.decodeAudioData`.
