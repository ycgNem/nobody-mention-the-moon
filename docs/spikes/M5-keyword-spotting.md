# M5 spike: keyword spotting

**Question (Q4):** which engine turns a player's mic into trigger-word hits (`{word, t}`), on the device, fast and accurately enough for "moon" near the werewolf to work?

**Answer:** **Vosk in WASM** with its grammar restricted to the vocabulary plus decoy words, in a Web Worker. Web Speech stays an opt-in fallback because it sends audio off the device in Chrome and Edge. A custom KWS model isn't worth building now.

Measured on 2026-10-31 on one machine (AMD Ryzen 9 7945HX, Windows 11, Chromium 152 in the Claude desktop browser pane), with synthetic speech. Real voices, real rooms and other browsers still need a human with a mic: see [What needs a human](#what-needs-a-human-with-a-mic).

## Recommendation

1. **Engine:** Vosk via `@lichess-org/vosk-browser@0.0.3` (the fork Lichess uses for voice moves; the original `vosk-browser` hasn't been updated since 2022) and `vosk-model-small-en-us-0.15`.
2. **Grammar:** the vocabulary, plus ~340 decoy words (common words and near-misses, `client/src/speech/decoys.ts`), plus `[unk]`. **Decoys are the single biggest win:** false hits on trigger-free chatter went from 25 to 3 (fast mode) and from 4 to 1 (confirmed mode).
3. **Mode `'confirmed'` by default**, with `minConfidence` **0.7**: a word fires once Vosk has scored it. With the faster endpointer below, that's **~0.4–0.65 s** after the word ends (0.5–0.8 s through the live pipeline), with **0 false hits in 111 s of chatter**. Mode `'fast'` fires from the first partial guess at **~0.1–0.3 s**, but had **3 false hits in the same 111 s** and can double-fire when Vosk revises a word ("thanks" → "thank you").
4. **Edit the model's endpointer** before packing it (see [Installing the model](#installing-the-model)): shorter trailing-silence rules cut ~300 ms off confirmed hits at no cost to accuracy in this test.
5. **Web Speech:** keep it as an explicit opt-in fallback for browsers that can't run Vosk. `engineSupport('webspeech').leavesDevice` is always `true`.
6. **Custom KWS model:** no. See [Candidate 3](#candidate-3-a-small-custom-kws-model).

This **misses the TECH.md target of < 300 ms** in confirmed mode. I think that's the right trade: the M5 "Done when" asks for ≤ 1 false trigger per dinner, and a guest who takes half a second to react reads as a double-take, while a guest who reacts to a word nobody said reads as a bug. If playtests disagree, switching is one option (`mode: 'fast'`). This needs a decision (draft entry at the end).

## Comparison

|                         | Vosk WASM + grammar (chosen)                                                                                             | Web Speech API                                                                                                           | Custom KWS (TF.js / ONNX)                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Latency, word end → hit | confirmed: 0.41–0.65 s offline, 0.53–0.80 s live · fast: 0.0–0.27 s offline, 0.02–0.39 s live (measured)                 | interim results typically a few hundred ms (not measured, see below)                                                     | best of the three in principle (~100 ms windows), not built |
| Accuracy on TTS clips   | 28–29 of 30 trigger occurrences; 0–3 false hits in 111 s of chatter (measured)                                           | not measured; dictation-grade recognizer, so good at words but no grammar to stop near-misses                            | unknown; needs training data per word                       |
| CPU                     | 9% of one core in a worker (real-time factor 0.09; 0.11–0.12 including messaging) (measured)                             | runs in the browser/OS service, off our threads                                                                          | likely small (not measured)                                 |
| Download                | 1.2 MB gz WASM + 41 KB gz worker + **41 MB model, once** (cached in IndexedDB, ~78 MB unpacked)                          | 0 (on-device mode: a language pack the browser downloads, if offered)                                                    | ~1–5 MB model + runtime, plus our training pipeline         |
| Init                    | 0.46–0.62 s warm from IndexedDB, 1–2 s cold on localhost (plus the 41 MB download on a real connection)                  | instant                                                                                                                  | fast                                                        |
| Browsers                | anything with WASM, module workers, AudioWorklet, IndexedDB: Chrome/Edge (verified), Firefox 114+, Safari 15+ (on paper) | Chrome, Edge, Safari. **Not Firefox**                                                                                    | all                                                         |
| Privacy                 | audio and transcripts stay in the tab (verified by code and network log)                                                 | **Chrome/Edge stream audio to Google/Microsoft**. On-device only where `processLocally` is available (not in this build) | stays on device                                             |
| Vocabulary changes      | edit content; it's just text                                                                                             | edit content; it's just text                                                                                             | retrain                                                     |

### Candidate 1: Vosk WASM, grammar-restricted

**Package.** `@lichess-org/vosk-browser@0.0.3` (Apache-2.0, published 2025-06-17) ships a 2.99 MB `vosk.wasm` (1.18 MB gzipped) and a self-contained 197 KB module worker (41 KB gzipped). It doesn't need threads, so no COOP/COEP headers. The original `vosk-browser@0.0.8` is a single 5.8 MB JS file with the WASM inlined as base64 (2.37 MB gzipped). The fork is half the size, ESM, and maintained. We use the fork's worker and WASM directly over its message protocol and skip its `VoskClient`, which never settles when the model fails to load. `npm audit` flags its `uuid@11.1.0` dependency (a bounds check in v3/v5/v6 with a caller buffer); we never load the module that imports uuid, only the worker and the WASM.

**Model.** `vosk-model-small-en-us-0.15`: 41.2 MB zip, 71 MB unpacked (`Gr.fst` 24 MB, `HCLr.fst` 22 MB, `am/final.mdl` 16 MB, `ivector/final.ie` 8 MB). Its word list has 152,217 words and covers every trigger word in GDD.md and GUESTS.md (45 entries, "egypt" and "mum" included) and every decoy. The worker downloads the `.tar.gz`, unpacks it and caches the unpacked files in IndexedDB keyed by URL (~78 MB per model). After that, start-up reads from IndexedDB in about half a second. A grammar of 385 entries compiles in under 50 ms.

**Partial results vs scored results.** Vosk gives plain best-path partial text quickly, but per-word confidence and timing only arrive with word output turned on, and the worker turns that on for partial results too. Word-mode partials trail plain partials by about a second, because they come from the incrementally determinized lattice. So the spotter has two modes:

- `'fast'`: plain partial text, no confidence, word fires ~0.1–0.3 s after it ends.
- `'confirmed'`: word output on. A word fires when a scored partial or the final result has it at or above `minConfidence`. Final results come when the endpointer sees trailing silence, which is why the endpointer edit matters.

**Decoys.** With only ~45 trigger words and `[unk]` to choose from, Vosk explains ordinary speech with trigger words: "bread" → "brain", "noon" → "moon", "more bread" → "mortgage". Adding common words and near-misses (`decoys.ts`) gives it better explanations. CPU cost wasn't measurable (real-time factor 0.086 without decoys vs 0.091 with). Multi-word triggers ("come in", "thank you") still win against decoy sequences, because each extra grammar entry on a path costs the decoder more than one longer phrase. **Never add a true homophone of a trigger word as a decoy** ("son" for "sun", "rap" for "wrap", "dyed" for "died"): it ties with the trigger and randomly swallows real hits. For the same reason, homophone spellings in the vocabulary (steak/stake) collapse to a single grammar entry. Before that fix, Vosk split its confidence 0.5/0.5 between "steak" and "stake".

**Endpointer.** The model's `conf/model.conf` ends an utterance after 0.5 / 0.75 / 1.0 s of trailing silence (rules 2/3/4). Cutting these to 0.25 / 0.4 / 0.6 s moved confirmed hits from a median of 0.78 s to 0.48 s (offline), with identical hits and false hits.

### Candidate 2: Web Speech API

- **Privacy:** Chrome and Edge send the audio to Google's and Microsoft's servers. That breaks D-006 unless the player opts in, so the engine is marked `leavesDevice: true`. Newer Chromium has on-device recognition (`SpeechRecognition.available({langs, processLocally: true})`, `processLocally`, `phrases` for biasing). In this Chromium 152 build all of those exist, `available()` reports on-device **`unavailable`** and cloud **`available`**. The engine asks for on-device when it's `available` and otherwise uses the cloud recognizer the player opted into. It never installs a language pack itself.
- **Browsers:** Chrome, Edge, Safari (`webkitSpeechRecognition`). **Firefox doesn't ship it.**
- **Fit:** it's a dictation engine. There's no grammar to hold back near-misses (only biasing, on-device only) and no word timings. Interim results have no confidence. Chromium can end a continuous session on its own (after silence, for example), so the engine restarts it, and gives up if it keeps dying.
- **Mic routing:** the spec now lets `start(track)` take the processed mic track. Engines that don't support it ignore the argument and open the default mic themselves, which bypasses our processed stream.
- **Not run here.** Starting it in this browser would have streamed this machine's real microphone to Google's servers, and there's no reliable way to aim it at a synthetic stream. Its latency and accuracy are unmeasured. Feature detection (`engineSupport`) and the `available()` probe were run.

### Candidate 3: a small custom KWS model

- **TF.js `speech-commands`** (`@tensorflow-models/speech-commands@0.5.4`, last published 2023) only knows its 18 or 20 built-in words. Our words need transfer learning from recorded examples, per word, ideally per speaker, and every new guest means re-recording and retraining. That conflicts with "content is data".
- **Open-vocabulary KWS** (e.g. sherpa-onnx's zipformer keyword spotter, keywords given as text) is the interesting version. By its docs it needs no training and has a model of a few MB, with low latency. As far as I can tell from npm, it's packaged for Node (`sherpa-onnx@2.0.1`), and the browser builds are demos rather than a library. All of this is unverified. If the 41 MB Vosk download becomes the problem, this is the next thing to spike.
- Not built or measured. Vosk already meets the accuracy bar on the test set, so the extra pipeline isn't justified yet.

## Measurements

### Test material

- **Clips:** Windows SAPI text-to-speech (voices "Microsoft David" and "Microsoft Zira"), 16 kHz mono, generated in a scratch folder outside the repo. 16 texts × 2 voices = 32 clips, 160 s:
  - single words and phrases: _moon, garlic, come in, thank you, steak_
  - triggers in sentences: "Oh look, the moon is out tonight.", "Would you like some garlic bread?", "Come in, come in, take a seat.", "I am so full, thank you.", "Please come in. We made garlic bread, and have you seen the full moon tonight?"
  - **chatter with no trigger words**, 12 clips, 111 s. Two were written with near-misses on purpose (_noon, soon, spoon, mood_). Four were written after the decoy list, as a held-out check.
- **Vocabulary:** all 45 trigger entries from GDD.md and GUESTS.md (`SPIKE_VOCABULARY` in `devtools.ts`). That's 30 expected trigger occurrences across the clips.
- **Offline harness:** clips fed chunk by chunk straight into the Vosk worker, scored against the clip text. Latency there is audio time: chunk end − speech end + decode time.
- **Live pipeline:** clips played into a `MediaStream` (`AudioBufferSourceNode` → `MediaStreamAudioDestinationNode`) and through the real spotter: AudioWorklet resampling 48 → 16 kHz, worker, matcher, tracker and debounce (`devtools.clipTest`). Latency there is `onWord` time − speech end, measured in a hidden browser pane, so it's slightly pessimistic.

### Accuracy (offline, all 32 clips)

| Config                                  | Trigger hits found (of 30) | False hits: all clips / chatter only |
| --------------------------------------- | -------------------------- | ------------------------------------ |
| fast, no decoys                         | 28                         | 43 / 25                              |
| fast, decoys                            | 29                         | 3 / 3                                |
| confirmed, decoys, min conf 0           | 29                         | 1 / 1                                |
| confirmed, decoys, min conf 0.6         | 28                         | 1 / 1                                |
| **confirmed, decoys, min conf 0.7–0.8** | **28**                     | **0 / 0**                            |
| confirmed, no decoys, min conf 0.6      | 28                         | 10 / 4                               |

- Every true hit scored 1.00 except "full" (0.81 in the long sentence, 0.52 in "I am so full"). The only confirmed false hit was "wrap" at 0.63, so any threshold from 0.64 to 0.81 gives the same result here. **0.7** is a starting point for calibration, not a tuned value.
- **Every miss is "full" at the end of "I am so full"**, the GDD's signature gag. One voice never produces it. The other scores 0.52, which a 0.6+ threshold drops. Short, common words at the end of a phrase are the weak spot.
- Live pipeline, 18 clips per mode (all single words and in-sentence triggers): every expected hit fired except "full" in "I am so full" (both voices). Debounce correctly dropped the second "come in" in "Come in, come in". Fast mode double-fired on one voice's "thank you" ("thanks", then "thank you").
- Steak/stake: each "steak" clip fired once, as `stake`. The grammar holds one spelling per homophone group, and both spellings are on the vampire's list, so the server treats them the same.

### Latency (single-word clips, from end of speech)

| Mode                             | Offline min / median / max | Live min / median / max  |
| -------------------------------- | -------------------------- | ------------------------ |
| fast                             | −0.05 / 0.07 / 0.27 s      | 0.02 / 0.19 / 0.39 s     |
| confirmed, stock endpointer      | 0.71 / 0.78 / 0.85 s       | 0.89–0.94 s (3 clips)    |
| **confirmed, faster endpointer** | **0.41 / 0.48 / 0.65 s**   | **0.53 / 0.66 / 0.80 s** |

Negative values mean the hit fired before the clip's quiet tail ended. 50 ms chunks were no faster than 100 ms: Kaldi decodes in its own steps. `WordHit.t` in confirmed mode comes from Vosk's word timings and landed 20–120 ms after the true end of the word. In fast mode it's the detection time.

### Cost

- **CPU:** real-time factor 0.089–0.093 offline and 0.11–0.12 live (the live figure includes worker messaging). That's about a tenth of one core on this CPU, in a worker and off the render thread. Expect two to three times that on a mid laptop. Main-thread work is one worklet message in, a 1,600-sample scale loop and one transferred buffer out per 100 ms. That wasn't profiled, but it's well under the frame budget.
- **Main bundle:** the static entry (`index.ts` + `matcher.ts`) is 7.9 KB, 3.5 KB gzipped. Everything else loads on `start()`: `vosk-engine` 5.8 KB (decoys included), capture 0.9 KB, worklet 1.5 KB, `webspeech-engine` 2.5 KB, then the worker, the WASM and the model.
- **Storage:** about 78 MB of IndexedDB per cached model URL.

## Installing the model

The model isn't committed. Each developer installs it locally, and the release build has to ship it as a static file.

1. **Git-ignore it:** add `client/public/speech/` to `.gitignore`.
2. **Download, edit the endpointer, repack.** The worker wants a `.tar.gz` with one top-level folder; it strips the first path component. From the repo root, in PowerShell (Windows `tar` is bsdtar and reads zip). This recipe was run as written, and its archive loads and spots words:

   ```powershell
   New-Item -ItemType Directory -Force client/public/speech | Out-Null
   Set-Location client/public/speech
   Invoke-WebRequest https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip -OutFile model.zip
   (Get-FileHash model.zip).Hash   # 30F26242C4EB449F948E42CB302DD7A686CB29A3423A8367F99FF41780942498
   tar -xf model.zip
   $conf = 'vosk-model-small-en-us-0.15/conf/model.conf'
   (Get-Content $conf) -replace 'rule2.min-trailing-silence=0.5', 'rule2.min-trailing-silence=0.25' `
     -replace 'rule3.min-trailing-silence=0.75', 'rule3.min-trailing-silence=0.4' `
     -replace 'rule4.min-trailing-silence=1.0', 'rule4.min-trailing-silence=0.6' | Set-Content -Encoding ascii $conf
   tar -czf vosk-model-small-en-us-0.15.tar.gz vosk-model-small-en-us-0.15
   Remove-Item -Recurse vosk-model-small-en-us-0.15, model.zip
   ```

   With bash (macOS/Linux): the same steps with `curl -LO …`, `unzip`, `sed -i 's/rule2.min-trailing-silence=0.5/rule2.min-trailing-silence=0.25/; s/rule3.min-trailing-silence=0.75/rule3.min-trailing-silence=0.4/; s/rule4.min-trailing-silence=1.0/rule4.min-trailing-silence=0.6/'` and `tar -czf`.

3. **Serve it** at `/speech/vosk-model-small-en-us-0.15.tar.gz` (`DEFAULT_MODEL_URL`). Vite serves `client/public/` as-is in dev and copies it into the build.
   - Vite's dev server sends `.tar.gz` with `Content-Encoding: gzip`, so the browser unzips it in transit and the worker gets a plain tar. That works (verified).
   - A model on another origin needs `Access-Control-Allow-Origin` (verified with a cross-origin server).
   - **Check your host's per-file limit:** 41 MB is over Cloudflare Pages' 25 MiB file cap, for example.
4. **Changing the archive later? Change its file name too.** The worker caches the unpacked model in IndexedDB under the URL and never re-downloads it. To clear a stale cache in a browser: `indexedDB.deleteDatabase('/vosk')`.

**If the model is missing,** `start()` rejects with a readable message and `state` becomes `'error'`. Vite's SPA fallback answers a missing file with `index.html` and a 200, so the spotter checks with a HEAD request first and recognizes both cases (verified for both):

> Speech model not found at http://localhost:5240/speech/vosk-model-small-en-us-0.15.tar.gz (the server sent a web page instead). See docs/spikes/M5-keyword-spotting.md for how to install the speech model.

## The pipeline as built (`client/src/speech/`)

```
MediaStream (voice module's processed mic)
  → capture.ts + capture.worklet.ts   AudioWorklet: mono, 7 kHz low-pass, resample to 16 kHz, 100 ms chunks, RMS level
  → vosk-engine.ts                    @lichess-org/vosk-browser worker: grammar = vocabulary + decoys + [unk]
  → engine.ts Hypothesis              tokens {text, conf, t}, final?, scored?
  → matcher.ts                        tokenize → PhraseMatcher (phrases, homophones) → UtteranceTracker (once per utterance)
  → index.ts KeywordSpotter           minConfidence → Debouncer (per word, homophones share one key) → onWord({word, confidence, t})
```

| File                               | What                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`                         | `KeywordSpotter`, `engineSupport`, `WordHit`, `SpotterOptions`, `DEFAULT_MODEL_URL`. The only file to import statically. |
| `matcher.ts` (+ `matcher.test.ts`) | Pure: `tokenize`, `PhraseMatcher`, `UtteranceTracker`, `Debouncer`, `DEFAULT_HOMOPHONES` (steak/stake).                  |
| `engine.ts`                        | Internal engine contract and `SpotterMode`.                                                                              |
| `capture.ts`, `capture.worklet.ts` | Mic capture. The worklet is bundled through `?worker&url`.                                                               |
| `vosk-engine.ts`, `decoys.ts`      | Vosk engine (lazy chunk).                                                                                                |
| `webspeech-engine.ts`              | Web Speech engine (lazy chunk).                                                                                          |
| `devtools.ts`                      | Dev-only harness, imported by nothing: `micTest()` and `clipTest()` from the dev console.                                |

Extras beyond the requested API: `SpotterOptions.mode` (`'confirmed'` default | `'fast'`), `SpotterOptions.homophones`, `spotter.vocabulary` (normalized), `spotter.engineInstance` (for the dev harness). Matching is on whole words, longest phrase first, no overlaps: "full moon" in the vocabulary wins over "full" + "moon". "Moon's" counts as "moon"; "moons" doesn't. The content lists variants explicitly, as GUESTS.md does with dog/dogs.

### Integration notes for whoever wires it in

- **Push-to-talk:** `VoiceMesh.micStream` is documented as _not_ gated by push-to-talk. Decide whether guests only hear a player who is transmitting. If so, drop hits whose `t` falls outside transmit time, or gate the stream.
- **Echo:** other players' voices coming out of speakers could be spotted as _your_ words. The stream should be the echo-cancelled mic (`echoCancellation: true`). Headphones help; this needs a real test.
- **Tuning (`shared/tuning.ts`):** suggested `speechMinConfidence: 0.7`, `speechDebounceMs: 1500`, `speechMode: 'confirmed'`.
- **Calibration screen:** `onDebug` gives `{partial, level}` about ten times a second. `partial` is a local transcript of the grammar words and must never be sent anywhere.
- **Vocabulary:** build it from `GUEST_TYPES[*].words`, `EXPOSURE_WORDS` and "come in". The spotter normalizes it, so case and punctuation don't matter.
- **One spotter per session.** `stop()` terminates the worker, which frees the WASM heap holding the model (not measured; the unpacked model alone is 71 MB). The next `start()` reloads from IndexedDB (~0.5 s).
- **Typed chat:** TECH.md says typed chat goes through the same matcher on the server. `matcher.ts` is pure and has no DOM, so it can move to `shared/` as-is when the server needs it.

## What needs a human with a mic

Everything above used two clean synthetic voices. Before M5's "Done when" can be ticked, someone has to run `micTest()` from the dev console in a quiet room and in a noisy one:

1. **"moon" at normal volume, 10×, near the mic:** count hits (target ≥ 9/10). Repeat for "garlic", "come in", "thank you", and "full" in "I'm so full" (the weakest case here).
2. **False triggers:** talk normally about anything for 5–10 minutes, ideally with music on and two people, and count hits (target ≤ 1 per dinner). This test set had only 111 s of chatter. "0 false hits" there doesn't yet rule out about one a minute.
3. **Accents and voices:** at least two different speakers.
4. **Echo:** another player's voice through the speakers saying "moon". Does it trigger _you_?
5. **Threshold:** watch the logged confidences and pick `minConfidence`. 0.7 is a placeholder.
6. **Firefox and Safari:** does Vosk start, and are latency and CPU similar? Only Chromium was tested here.
7. **Web Speech:** opt in on Chrome and Safari and compare latency and false triggers against Vosk on the same words.
8. **Mid-range laptop:** CPU and frame time with a dinner running.

```js
// dev server console (http://localhost:5240), model installed as above
const dt = await import('/src/speech/devtools.ts');
const stop = await dt.micTest(); // or micTest({ mode: 'fast' }) / micTest({ minConfidence: 0 })
// …talk…
stop(); // returns { hits }
```

## Follow-ups worth considering

- **Smaller model download:** with a grammar set, most of `Gr.fst` (24 MB, the general language model) isn't needed for decoding, but Vosk still reads its word list. A stub `Gr.fst` that keeps only the symbol table could cut the archive by about half. That needs Kaldi/OpenFst tooling, so it's its own spike.
- **More decoys:** decoys took false hits from 25 to 3 at no measurable CPU cost. A few hundred more common words is cheap to try once there's a real-speech test set.
- **Homophone policy:** "son" will trigger the vampire's "sun", and "my mom" will probably trigger "my mum". That's in the spirit of steak/stake, but it should be a deliberate content decision.

## Draft decision entry (for DECISIONS.md)

> ### D-0xx · Keyword spotting: Vosk WASM with a decoy grammar · 2026-10-31
>
> On-device Vosk (`@lichess-org/vosk-browser@0.0.3`, `vosk-model-small-en-us-0.15` with a shortened endpointer) in a Web Worker, grammar = trigger vocabulary + ~340 decoy words + `[unk]`. Words fire once scored (`'confirmed'`, min confidence ~0.7): ~0.5 s after the word, rare false triggers. A low-latency `'fast'` mode (~0.2 s, more false triggers) exists for comparison. Web Speech is an opt-in fallback only (sends audio off the device in Chrome/Edge). No custom KWS model for now. The model (41 MB, cached in IndexedDB) is installed locally and git-ignored. Supersedes the < 300 ms latency target in TECH.md. See docs/spikes/M5-keyword-spotting.md. Closes Q4.
