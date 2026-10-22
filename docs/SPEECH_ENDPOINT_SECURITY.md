# Speech endpoint security (Google STT/TTS)

`POST /api/diagnostic/audio` (Google Speech-to-Text) and `POST /api/tts` (Google
Text-to-Speech) are defined in `server/routes/speech.js`. Google remains the only
provider in the main application.

## Request order

For each request, `server/services/speechAccess.js` runs before anything else:

1. **Authentication.** A `Bearer` Supabase access token is required. Missing,
   blank or invalid tokens get **401** `AUTH_REQUIRED`.
2. **Role authorization.** The existing M5 self-practice rule applies
   (`authorizeOralReadingPracticeRequest`): `student`, `general_user` and `admin`.
   Teachers (approved or pending) and accounts without a role get **403**
   `SPEECH_FORBIDDEN`. A failed profile lookup or missing server configuration
   gets **503** `STT_PERMISSION`.
3. **Per-user throttling.** Requests over budget get **429**
   `SPEECH_RATE_LIMITED` with a `Retry-After` header.

Only then does multer read the upload, so rejected requests never write a
temporary audio file and never reach Google.

## Limits

| Limit | Value | Response |
|---|---|---|
| STT requests per user | 60 per 10 minutes | 429 |
| TTS requests per user | 100 per 10 minutes | 429 |
| Audio bytes per upload | 10 MB (Google synchronous recognition limit) | 413 `AUDIO_TOO_LARGE` |
| Files per upload | 1 (`audio`) | 400 |
| Form fields / parts | 2 fields, 3 parts, 1 KB per field | 400 (count) / 413 (field size) |
| TTS text | 200 characters (unchanged) | 400 |

These limits cap **bytes and request counts, not reading time**. Recordings are
still captured in 25-second parts with the existing five-minute recording limit
(`readflow/src/modules/module2/services/diagnosticRecording.ts`); a full-length
reading needs at most 12 STT requests. Segmentation and scoring are unchanged.

## Logging

Authorization failures and TTS provider failures log only the error class/code.
Tokens, request text, recordings and provider payloads are not logged.

## Known limitations of the in-memory rate limiter

- **Per process.** Counters live in the Node.js process. With several server
  instances (or a load balancer), each instance keeps its own budget, so the
  effective limit is multiplied by the number of instances.
- **Lost on restart.** A restart or crash clears all counters.
- **Fixed window.** A user can make up to twice the budget across a window
  boundary (end of one window plus start of the next).
- **Per account, not per device.** Learners sharing one account share a budget;
  one person with many accounts gets one budget per account.
- **Memory bound.** Up to 10,000 users are tracked before expired entries are
  pruned.
- **Not a billing control.** Set a Google Cloud budget alert and Speech-to-Text /
  Text-to-Speech API quota caps in the Google Cloud console as the authoritative
  cost limit. For multi-instance deployment, move counters to a shared store
  (e.g. Redis) or an API gateway.

## Live streaming WebSocket (`/ws/diagnostic/speech`)

Defined in `server/routes/diagnosticSpeechSocket.js`; used for M2 live
transcription and M5 voice-follow scrolling. Checks, in order:

1. **Origin** must be in `DIAGNOSTIC_WS_ORIGINS` (unchanged; refused with HTTP
   403 before the upgrade).
2. The first message must be a valid `configure` message within 10 seconds
   (unchanged).
3. **Authentication and role.** The Supabase access token in `configure` is
   verified and the same roles as the HTTP endpoints are required (`student`,
   `general_user`, `admin`). Others are closed with code **1008**.
4. **Session-start budget.** At most **12** authorized session starts per user
   per 10 minutes; over budget the socket is closed with code **1013**
   (`SPEECH_RATE_LIMITED`). Rejected and abandoned attempts are not counted.
5. **One active stream per user.** A newer authorized session for the same user
   ends the older one first (close code **4000**, `STREAM_REPLACED`) and closes
   its Google stream. Reconnecting after a network drop is therefore never
   blocked by a stale session the server has not yet detected.

Only after all of these does the server open a Google streaming request.
Session tracking is released when the client disconnects, the stream completes
or fails, the connection errors, or the server shuts down.

The browser treats every rejection as "use the recording upload instead", so a
rejected or replaced stream never blocks a reading; the segment upload above is
separately authenticated and throttled.

Unchanged safeguards: 16 KB WebSocket payloads, 200 ms PCM frames, a 5-second
buffer, the four-minute Google stream rotation, the ~5-minute (301-second) audio
and 315-second session lifetime limits, and the 10-second no-audio timeout.

### Limitations

- **Per process.** Active-session tracking and the start budget are in memory.
  With several instances, a user could hold one live stream (and one budget) per
  instance; counters reset on restart.
- **Worst case per account.** One active stream at a time, each limited to
  about five minutes of audio, and at most 12 starts per 10 minutes. Google
  Cloud quotas and budget alerts remain the authoritative cost control.
- **Unauthenticated connection attempts** are bounded by the origin check and
  the 10-second configure timeout but are not counted; each `configure` with a
  token costs one Supabase token verification and profile lookup.
- **Per account, not per device.** Two tabs of the same account cannot stream
  live at the same time; the older tab falls back to the recording upload.
