The v3.0 diagnostic reads the whole three-sentence passage as one recording and
grades it as one passage. The per-sentence v2 script (sentences.mjs) was removed
with that flow. The acceptance/questions/bilingual scripts below predate v3.0 and
have not been re-verified against it.

Module 2 browser acceptance uses real React pages, MediaRecorder, AudioWorklet,
WebSockets and Chromium's fake microphone. Google and authenticated persistence
are local test doubles. No credentials or remote database are used.

From the repository root, run `node readflow/tests/browser/module2/serve.mjs`.
It uses loopback ports 5178 and 5019. Launch a separate Chrome profile with:

```text
--headless=new --remote-debugging-port=9225 --use-fake-ui-for-media-stream
--use-fake-device-for-media-stream --autoplay-policy=no-user-gesture-required
--user-data-dir=<temporary-test-profile>
```

Then run `node readflow/tests/browser/module2/acceptance.mjs`.
This also checks story-card auto-scroll at desktop/mobile sizes with normal and
reduced motion: visible words, the lower-edge trigger, duplicate transcript
events, same-line progression, later paragraphs, native wheel/touch input,
container-only scrolling, and Record Again. Controlled interim messages are
injected at the fixture's WebSocket boundary; scoring still uses Google finals.
For all five Questions-page layouts at five viewport sizes, simulated save
failure, duplicate submission, answer preservation and successful retry, run
`node readflow/tests/browser/module2/questions.mjs` against the same fixture.
Set `READFLOW_M2_LONG_RECORDING=1` for the 62-second recording that crosses two
25-second segment boundaries. The default run checks short recording and the
rest of the flow. The maximum-duration check invokes the registered five-minute
timer callback; it does not wait five real minutes.

Reports and a mobile screenshot go to the temporary `readflow-m2-completion-audit`
directory (override with `READFLOW_M2_BROWSER_OUTPUT`). Stop the fixture and close
the test Chrome instance afterwards. This is not a real Google microphone test.
