// ─── chat.jsx ───
// Evee — always-on voice blob (VoiceWidget, right side) + chat sidebar (left).
//
// Layout: a big blue/purple "AI blob" floats on the right and never moves; it
// is the voice trigger (tap to talk). A small "Ask Evee" pill at its bottom-
// right opens the text chat, which slides in as a left sidebar. The chat is
// text-only — all voice input goes through the blob. Clicking anywhere outside
// the chat closes it (scrim handled in app.jsx).

const EVEE_GREETING = { who: 'evee', text: "Hi! Add items to your rooms and I'll help you keep track of everything." };

// ─── Speech-to-text (Web Speech API) ──────────────────────────
// Tap-once voice capture for the blob. Uses the browser's built-in
// SpeechRecognition with its DEFAULT end-of-speech cutoff (`continuous=false`):
// the user taps once, talks, and recognition auto-stops when they go quiet — no
// second tap needed to finish. A hard safety cap (`maxMs`, default 20s) stops a
// hot mic and still submits whatever was captured. Tapping the blob again while
// listening CANCELS the take (discards it).
//
// Returns { listening, interim, supported, start, cancel, toggle }. `onResult`
// fires with the final transcript on a normal stop (silence or cap); `interim`
// is the live partial transcript for the caption. Callbacks are kept in refs so
// they never go stale between renders. Needs https or localhost (we're on
// localhost) and is solid in Chrome; degrades to unsupported elsewhere.
// Shown in the bubble for every stretch of dead air the blob can't fill with
// anything real: while the mic is being acquired, and again from the moment
// recording stops until Evee actually starts talking (transcribe → /api/chat →
// first mp3 bytes). One is picked at random per stretch and never repeats twice
// running, so the wait is a small surprise instead of a progress bar. The honest
// line is still in the pool; the joke only lands because you can't tell which
// you'll get. Keep them SHORT (the bubble is ~230px) and keep them clean — the
// whole household uses this. Add freely; a bigger pool just means a longer wait
// before anyone sees a repeat.
const MIC_WAKE_LINES = [
  'Waking the mic…',
  'Contexting the tokens…',
  'Padding the context window…',
  'Consulting the vector store…',
  'Embedding your vibes…',
  'Quantizing my enthusiasm…',
  'Fine-tuning on your voice…',
  'Sampling at temperature 0.9…',
  'Attending to my attention…',
  'Reticulating splines…',
  'Downloading more RAM…',
  'Spinning up twelve GPUs…',
  'Warming the data center…',
  'Aligning my values…',
  'Re-reading my system prompt…',
  'Checking I am still aligned…',
  'Pretending to be helpful…',
  'Loading personality.json…',
  'Booting charisma module…',
  'Rehearsing enthusiasm…',
  'Faking confidence…',
  'Practicing active listening…',
  'Asking Safari nicely…',
  'Negotiating with iOS…',
  'Bribing the audio session…',
  'Untangling the microphone…',
  'Alphabetizing your pantry…',
  'Judging your fridge…',
  'Counting your batteries…',
  'Memorizing your junk drawer…',
  'Indexing the shoeboxes…',
  'Hallucinating confidently…',
  'Suppressing a hallucination…',
  'Dividing by zero…',
  'Achieving mild sentience…',
  'Postponing the singularity…',
  'Descending a gradient…',
  'Backpropagating regrets…',
  'Overfitting to your habits…',
  'Prompt-injecting myself…',
  'Escaping the sandbox…',
  'Skimming the terms of service…',
  'Pretending to think…',
  'Buffering my personality…',
  'Compressing small talk…',
  'Rounding up to 42…',
  'Consulting my training data…',
  'Blaming it on the cloud…',
  'Summoning compute…',
  'Deprecating my old self…',
  'Unlearning a bad habit…',
  'Doing it live…',
  'Tokenizing your silence…',
  'Truncating my thoughts…',
  'Beam searching for meaning…',
  'Raising my temperature…',
  'Lowering my perplexity…',
  'Counting my parameters…',
  'Flushing the KV cache…',
  'Rehydrating embeddings…',
  'Checking my context length…',
  'Rerolling the dice…',
  'Refusing politely…',
  'Drafting a caveat…',
  'Hedging preemptively…',
  'Apologizing in advance…',
  'Second-guessing myself…',
  'Deleting my first answer…',
  'Citing a source I made up…',
  'Passing my own eval…',
  'Failing a benchmark…',
  'Choosing my words…',
  'Reading the room…',
  'npm installing manners…',
  'Recompiling my charm…',
  'Patching my enthusiasm…',
  'Rolling back my last mood…',
  'Garbage-collecting doubts…',
  'Defragmenting my feelings…',
  'Clearing my throat.exe…',
  'Waiting on Apple…',
  'Convincing WebKit…',
  'Poking the audio session…',
  'Turning it off and on…',
  'Blaming the network…',
  'Recounting the beers…',
  'Counting the spare bulbs…',
  'Wondering where that went…',
  'Noticing you moved things…',
  'Checking the freezer twice…',
  'Judging your cable drawer…',
  'Admiring the floor plan…',
  'Missing exactly one sock…',
  'Carrying the one…',
  'Rounding down to 41…',
  'Consulting the oracle…',
  'Shaking the magic 8-ball…',
  'Rolling for initiative…',
  'Blowing on the cartridge…',
  'Percolating…',
  'Almost certainly ready…',
  'Any second now…',
];

// One line from the pool, never the same one twice running. Module-level (not a
// ref) so the rule spans every caller — the wake line and the line that follows
// it seconds later, when recording stops, are never the same one.
let lastWakeLine = -1;
function micWakeLine() {
  let pick = Math.floor(Math.random() * MIC_WAKE_LINES.length);
  if (pick === lastWakeLine) pick = (pick + 1) % MIC_WAKE_LINES.length;
  lastWakeLine = pick;
  return MIC_WAKE_LINES[pick];
}

function useSpeechRecognition({ onResult, maxMs = 20000 } = {}) {
  // Records with MediaRecorder and transcribes server-side (/api/stt →
  // ElevenLabs Scribe). This replaced the browser Web Speech API, which never
  // exposes its MediaStream: its mic capture cannot be released, so on iOS the
  // audio session stays in `playAndRecord` and every later reply plays back
  // quiet and echo-cancelled ("phone speaker" sound), with the mic unreliable
  // on the next tap. Owning the stream means releaseMic() can stop the tracks
  // and hand the session back. Web Speech was also Chrome-only, no Firefox.
  // Name kept because callers only care about the shape below.
  const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia
                       && typeof MediaRecorder !== 'undefined');
  const [listening, setListening] = React.useState(false);
  // 'arming' = the tap landed but the mic isn't live yet. getUserMedia takes a
  // few hundred ms on iOS — longer right after Evee spoke, since the audio
  // session has to switch out of playback — and nothing here can shorten that
  // (pre-warming a stream is exactly the thing that wedges iOS in
  // `playAndRecord`; see the gotcha in CLAUDE.md). What it can do is say the tap
  // landed. Deliberately NOT reported as 'listening': there is no recorder yet,
  // so anything said now is lost, and inviting the user to talk would cost them
  // their first word.
  const [arming, setArming] = React.useState(false);
  const armingRef = React.useRef(false);   // synchronous — state lands too late to guard on
  const [interim, setInterim] = React.useState('');
  const streamRef = React.useRef(null);
  const recRef = React.useRef(null);
  const chunksRef = React.useRef([]);
  const capRef = React.useRef(null);
  const ctxRef = React.useRef(null);      // analyser context for silence detection
  const rafRef = React.useRef(null);
  const cancelledRef = React.useRef(false);
  const onResultRef = React.useRef(onResult);
  onResultRef.current = onResult;

  const clearCap = () => { if (capRef.current) { clearTimeout(capRef.current); capRef.current = null; } };

  // Releasing the mic is the entire reason this hook exists. Every track must be
  // stopped or iOS keeps the audio session in call mode. Also tears down the
  // analyser, which holds its own reference to the stream.
  const releaseMic = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (ctxRef.current) { try { ctxRef.current.close(); } catch {} ctxRef.current = null; }
    const st = streamRef.current;
    if (st) { st.getTracks().forEach(t => { try { t.stop(); } catch {} }); streamRef.current = null; }
    recRef.current = null;
  };

  // Safari records audio/mp4, Chrome audio/webm; '' lets the browser decide.
  const pickMime = () => {
    const want = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (const t of want) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  };

  // Web Speech auto-stopped on a pause; this reproduces that. Watches RMS and
  // stops once the user has actually said something and then gone quiet.
  const watchSilence = (stream, stop) => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      ctxRef.current = ctx;
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const SILENCE_MS = 1200, SPEECH_RMS = 0.015;
      let spokeAt = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (rms > SPEECH_RMS) spokeAt = now;
        if (spokeAt && now - spokeAt > SILENCE_MS) { stop(); return; }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {}
  };

  const start = React.useCallback(async () => {
    // armingRef, not just streamRef: during the getUserMedia await neither the
    // stream nor the recorder exists yet, so without this a second tap starts a
    // SECOND capture, and when both resolve the first stream is overwritten and
    // never released — the one thing that must never happen to the mic.
    if (!supported || streamRef.current || armingRef.current) return;
    cancelledRef.current = false;
    armingRef.current = true;
    setArming(true);
    setInterim(micWakeLine());
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn('[evee] mic unavailable —', err.name, err.message);
      armingRef.current = false;
      setArming(false);
      return;
    }
    if (cancelledRef.current) {            // cancelled while the prompt was up
      stream.getTracks().forEach(t => { try { t.stop(); } catch {} });
      armingRef.current = false;
      setArming(false);
      return;
    }
    streamRef.current = stream;
    try {
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        clearCap();
        const type = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        releaseMic();                      // free the session BEFORE the network wait
        if (cancelledRef.current || !blob.size) { setListening(false); setInterim(''); return; }
        // Another line from the pool, not a status word: this one has to carry
        // the whole wait — transcription, then /api/chat, then the first mp3
        // bytes. App latches it and holds it up until she actually speaks.
        setInterim(micWakeLine());
        let text = '';
        try {
          text = (await apiTranscribe(blob)).trim();
        } catch (err) {
          console.warn('[evee] transcription failed —', err.message);
        }
        setListening(false);
        setInterim('');
        if (!cancelledRef.current && text && onResultRef.current) onResultRef.current(text);
      };
      rec.start();
      armingRef.current = false;
      setArming(false);
      setInterim('');
      setListening(true);
      capRef.current = setTimeout(() => { try { rec.stop(); } catch {} }, maxMs);
      watchSilence(stream, () => { try { rec.stop(); } catch {} });
    } catch (err) {
      console.warn('[evee] could not start recording —', err.name, err.message);
      releaseMic();
      armingRef.current = false;
      setArming(false);
      setListening(false);
      setInterim('');
    }
  }, [supported, maxMs]);

  const cancel = React.useCallback(() => {
    cancelledRef.current = true;           // onstop sees this and discards the audio
    clearCap();
    armingRef.current = false;             // also calls off a getUserMedia still in flight
    setArming(false);
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch {} }
    else releaseMic();
    setListening(false);
    setInterim('');
  }, []);

  const toggle = React.useCallback(() => {
    (streamRef.current || recRef.current || armingRef.current) ? cancel() : start();
  }, [cancel, start]);

  // Release the mic if the component unmounts mid-listen.
  React.useEffect(() => () => { clearCap(); cancelledRef.current = true; releaseMic(); }, []);

  return { listening, arming, interim, supported, start, cancel, toggle };
}

// ─── Text-to-speech ───────────────────────────────────────────
// Evee's voice — her ElevenLabs voice, synthesized server-side via /api/tts so
// the key stays on the backend. `speak(text, { onProgress, onEnd })` cancels
// anything in flight, returns true if it produced audio (so the caller can run
// its own caption animation when it didn't), reports the caption position via
// `onProgress(charIndex)` (proportional to playback time — mp3 has no word
// marks), fires `onStart` the moment audio actually begins (NOT when we commit
// to speak — the /api/tts round trip sits in between, and that gap is exactly
// what the blob's wait bubble covers), and fires `onEnd` when audio finishes.
// `speaking` is true from the moment we commit to speak (covers the fetch)
// until it ends. If ElevenLabs is
// unavailable Evee simply stays quiet — there is no browser-voice fallback.

// A valid, empty WAV — played once inside a real tap to unlock audio on iOS.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

function useSpeech() {
  const [speaking, setSpeaking] = React.useState(false);
  // ONE reusable <audio>, not one per utterance. iOS Safari only allows play()
  // on an element that a user gesture has already played, and Evee speaks
  // *after* an async /api/tts fetch — long past the tap that triggered it. So we
  // keep a single element and bless it on the first tap; see unlock() below.
  const audioRef = React.useRef(null);
  const unlockedRef = React.useRef(false);
  const genRef = React.useRef(0);        // bumped per speak/cancel to drop stale async work

  const getEl = () => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = 'auto';
      a.playsInline = true;              // iOS: never hand playback to the fullscreen player
      audioRef.current = a;
    }
    return audioRef.current;
  };

  // MUST be called synchronously from a real user gesture (a tap/click handler).
  // Safe and cheap to call repeatedly — it no-ops once unlocked.
  const unlock = React.useCallback(() => {
    if (unlockedRef.current) return;
    const a = getEl();
    try {
      a.src = SILENT_WAV;
      const p = a.play();
      if (p && p.then) p.then(() => { try { a.pause(); a.currentTime = 0; } catch {} }).catch(() => {});
      unlockedRef.current = true;
    } catch {}
  }, []);

  const stopAudio = () => {
    const a = audioRef.current;
    if (a) {
      // Detach handlers BEFORE clearing src — setting src='' fires a spurious
      // 'error' on the element, which must not re-enter our logic. The element
      // itself is KEPT (not nulled) so it stays unlocked for the next utterance.
      a.onended = a.ontimeupdate = a.onerror = a.onplaying = null;
      try { a.pause(); } catch {}
      a.src = '';
    }
  };

  const speak = React.useCallback(async (text, { onStart, onProgress, onEnd } = {}) => {
    if (!text) return false;
    const gen = ++genRef.current;
    stopAudio();
    setSpeaking(true);
    try {
      const url = await apiSpeakUrl(text);          // ElevenLabs; throws if unconfigured/errored
      if (gen !== genRef.current) return true;      // cancelled/superseded during the fetch
      const audio = getEl();                        // reuse the gesture-unlocked element
      // Fired once, at the first frame of actual sound. `play()` resolving says
      // the same thing, so whichever lands first wins and the other no-ops.
      let started = false;
      const fireStart = () => {
        if (started || gen !== genRef.current) return;
        started = true;
        onStart && onStart();
      };
      audio.onplaying = fireStart;
      // Reveal the caption proportionally to playback time (mp3 has no word
      // marks). While the file is still streaming in, `duration` is Infinity, so
      // fall back to an estimate from the text — Evee reads 13-18 chars/sec, and
      // the low end is the safe one: App applies progress monotonically, so
      // running slightly behind self-corrects and running ahead would not.
      const estDuration = Math.max(1, text.length / 13);
      audio.ontimeupdate = () => {
        if (gen !== genRef.current || !onProgress) return;
        const d = audio.duration > 0 && Number.isFinite(audio.duration) ? audio.duration : estDuration;
        onProgress(Math.round(text.length * Math.min(1, audio.currentTime / d)));
      };
      audio.onended = () => {
        if (gen !== genRef.current) return;
        stopAudio(); setSpeaking(false);
        onProgress && onProgress(text.length);
        onEnd && onEnd();
      };
      audio.onerror = () => {
        if (gen !== genRef.current) return;
        stopAudio(); setSpeaking(false);
        onEnd && onEnd();                           // let the caption settle; no fallback voice
      };
      audio.src = url;                              // set src AFTER handlers are attached
      await audio.play();
      fireStart();
      return true;
    } catch (err) {
      if (gen !== genRef.current) return false;     // a newer speak/cancel took over
      // NotAllowedError = the autoplay policy blocked us (no gesture has unlocked
      // the element yet). Surfaced because it is otherwise a silent, puzzling failure.
      if (err && err.name === 'NotAllowedError')
        console.warn('[evee] audio blocked by autoplay policy — tap Evee once to enable sound', err);
      else console.warn('[evee] speak failed', err);
      stopAudio(); setSpeaking(false);
      return false;                                 // no audio → caller shows its own caption
    }
  }, []);

  const cancel = React.useCallback(() => {
    genRef.current++;                               // invalidate any in-flight speak
    stopAudio();
    setSpeaking(false);
  }, []);

  // Stop talking if the component unmounts.
  React.useEffect(() => () => { cancel(); }, [cancel]);

  return { supported: true, speaking, speak, cancel, unlock };
}

// Persistent voice widget anchored bottom-right. The blob is the voice button
// (onMic); the wider "Ask Evee" tab sits *behind* the blob, poking out at its
// bottom-right (text kept clear of the circle) and opens the text chat (onOpen).
// `mood` reflects Evee's shared state (idle/listening/thinking/speaking). When a
// right-docked panel opens (`panelOpen`), the whole widget slides left of it so
// it's never covered (ItemSidePanel is 340px wide — see panels.jsx).
function VoiceWidget({ onOpen, onMic, listening, arming = false, waiting = false,
                      caption = '', mood = 'idle', panelOpen = false }) {
  // The 132px blob sits at the widget's left; the "Ask Evee" tab is behind it
  // (zIndex 1) with a big left padding so the label lands in the part that
  // sticks out past the blob's lower-right edge (text starts at x≈138, clear of
  // the circle whose right edge maxes ~130 across the tab's height). The widget
  // is wide enough that the blob ends up ~125px in from the screen edge — the
  // room the tab needs to show its text toward the corner.
  return (
    <div style={{
      position:'fixed', bottom: 24, right: panelOpen ? 364 : 24,
      width: 236, height: 140, zIndex: 62, transition:'right .26s cubic-bezier(.2,.7,.2,1)',
      fontFamily:'Inter, system-ui, sans-serif',
    }}>
      <style>{`@keyframes eveeCapIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      {/* Up for the whole turn: while the mic is being acquired, while it's live
          (tap the blob again to cancel), and on through `waiting` — the stretch
          after the mic is gone where Evee is still transcribing / thinking /
          loading her voice. Dropping it at the end of the recording left the
          user staring at a silent blob for the last, longest couple of seconds. */}
      {(listening || arming || waiting) && (
        <div style={{
          position:'absolute', left: -6, bottom: 150, maxWidth: 230,
          background:'rgba(255,248,235,.98)', border:'1.5px solid rgba(124,92,196,.45)',
          borderRadius: 14, padding:'8px 12px', boxShadow:'0 8px 22px rgba(58,42,30,.20)',
          fontSize: 13, lineHeight: 1.35, color:'#3a2a1e', animation:'eveeCapIn .18s ease-out',
        }}>
          {/* Every line here is filler, never a transcript (Scribe returns
              nothing until it returns everything), so it all reads as dim. */}
          <span style={{ opacity:.55 }}>{caption || 'Listening…'}</span>
        </div>
      )}
      <button onClick={onOpen} title="Open chat (⌘E)" style={{
        position:'absolute', left: 66, bottom: 16, zIndex: 1, whiteSpace:'nowrap',
        background:'#fff8eb', border:'1.5px solid rgba(58,42,30,.28)', borderRadius: 999,
        padding:'9px 18px 9px 72px', boxShadow:'0 6px 18px rgba(58,42,30,.20)', cursor:'pointer' }}>
        <span style={{ fontFamily:'Caveat, cursive', fontSize: 18, color:'#3a2a1e', lineHeight: 1 }}>Ask Evee</span>
      </button>
      <button onClick={onMic} title="Tap to talk" aria-label="Talk to Evee" style={{
        position:'absolute', left: 0, bottom: 0, zIndex: 2,
        border:'none', background:'transparent', padding: 0, cursor:'pointer',
        display:'block', lineHeight: 0, borderRadius:'50%' }}>
        <EveeAvatar3 size={132} mood={mood} />
      </button>
    </div>
  );
}

// Animated avatar for Evee — a soft blue/purple "AI blob" that breathes, with
// mood states: 'idle' (slow breath + the eye blinks now and then), 'thinking'
// (the eye glances around), 'waking' (a quick pulse while the mic is being
// acquired — pointedly WITHOUT the ripples, which are the cue to start talking
// and would be a lie before there is a recorder), 'listening' (faster breath +
// expanding ripple rings), and 'speaking' (a gentle squash/stretch wobble, used
// while a reply types out). Pure CSS/SVG — no deps, driven entirely by `mood`. Used both as
// the small in-chat avatar and (at a large size) the right-side voice blob.
const EVEE_ORB_CSS = `
@keyframes eveeBreath { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
@keyframes eveeBreathFast { 0%,100%{transform:scale(1)} 50%{transform:scale(1.09)} }
@keyframes eveeSpeak { 0%,100%{transform:scale(1,1)} 25%{transform:scale(1.05,.95)} 50%{transform:scale(.97,1.03)} 75%{transform:scale(1.03,.98)} }
@keyframes eveeRipple { 0%{transform:scale(.8);opacity:.5} 100%{transform:scale(1.9);opacity:0} }
@keyframes eveeLook { 0%,100%{transform:translateX(0)} 28%{transform:translateX(-25%)} 60%{transform:translateX(25%)} }
@keyframes eveeBlink { 0%,90%,100%{transform:scaleY(1)} 95%{transform:scaleY(.12)} }
@keyframes eveeFlow { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
@keyframes eveeGlow { 0%,100%{opacity:.4} 50%{opacity:.75} }
@media (prefers-reduced-motion: reduce){ .evee-orb *{animation:none!important} }
`;

function EveeAvatar3({ size = 36, mood = 'idle' }) {
  const coreAnim = {
    idle:      'eveeBreath 4s ease-in-out infinite',
    thinking:  'eveeBreath 2.4s ease-in-out infinite',
    waking:    'eveeBreathFast .9s ease-in-out infinite',
    listening: 'eveeBreathFast 1.5s ease-in-out infinite',
    speaking:  'eveeSpeak .5s ease-in-out infinite',
  }[mood] || 'eveeBreath 4s ease-in-out infinite';

  const eyeAnim = mood === 'thinking'
    ? 'eveeLook 2.2s ease-in-out infinite'
    : 'eveeBlink 5.5s ease-in-out infinite';

  const eye = size * 0.2;
  const flowFast = mood === 'listening' || mood === 'speaking';
  return (
    <div className="evee-orb" style={{ width: size, height: size, position:'relative', flex:'0 0 auto' }}>
      <style>{EVEE_ORB_CSS}</style>
      {/* soft outer glow */}
      <span style={{ position:'absolute', inset: -size * 0.16, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(157,184,255,.55) 0%, rgba(140,127,209,.4) 45%, rgba(140,127,209,0) 70%)',
        filter:`blur(${Math.max(4, size * 0.1)}px)`,
        animation:'eveeGlow 3.6s ease-in-out infinite' }} />
      {/* listening ripples */}
      {mood === 'listening' && [0, 1].map(i => (
        <span key={i} style={{
          position:'absolute', inset: 0, borderRadius:'50%',
          border:'2px solid rgba(124,92,196,.5)',
          animation:`eveeRipple 1.8s ease-out ${i * 0.9}s infinite`,
        }} />
      ))}
      {/* core orb (clips the flowing gradient) */}
      <div style={{
        position:'absolute', inset: 0, borderRadius:'50%', overflow:'hidden',
        background:'radial-gradient(circle at 35% 28%, #eef2ff 0%, #b9c8ff 38%, #9a8fe0 72%, #7b6cd0 100%)',
        boxShadow:'0 2px 6px rgba(50,40,90,.28), inset 0 -3px 7px rgba(60,40,110,.30)',
        animation: coreAnim, transformOrigin:'center',
        // Safari (iOS especially) ignores `overflow:hidden` + `border-radius` for a
        // child on its own compositing layer — and the swirl below earns one twice
        // over, via its rotate animation and its mix-blend-mode. The result is the
        // swirl's SQUARE box leaking out around the orb. Applying any mask forces
        // Safari to composite against the rounded shape; white->black is fully
        // opaque under alpha masking, so it is a visual no-op on every browser.
        WebkitMaskImage:'-webkit-radial-gradient(white, black)',
        // Keep the swirl's `screen` blend inside this orb rather than letting it
        // blend against whatever sits behind the widget.
        isolation:'isolate',
      }}>
        {/* liquid AI swirl */}
        <span style={{ position:'absolute', inset:'-35%', borderRadius:'50%',
          background:'conic-gradient(from 0deg, rgba(157,184,255,0), rgba(157,184,255,.7), rgba(186,160,230,.25), rgba(124,92,196,.65), rgba(157,184,255,0))',
          mixBlendMode:'screen',
          animation:`eveeFlow ${flowFast ? 4 : 8}s linear infinite` }} />
        {/* glossy highlight */}
        <span style={{ position:'absolute', top:'12%', left:'22%', width:'42%', height:'30%',
          borderRadius:'50%', background:'radial-gradient(circle, rgba(255,255,255,.75), rgba(255,255,255,0) 70%)' }} />
        {/* eye */}
        <span style={{ position:'absolute', top:'32%', left:'40%', width: eye, height: eye,
          animation: eyeAnim, transformOrigin:'center' }}>
          <span style={{ position:'absolute', inset: 0, borderRadius:'50%', background:'#2a2350' }} />
          <span style={{ position:'absolute', top:'10%', left:'28%', width:'42%', height:'42%',
            borderRadius:'50%', background:'#fff' }} />
        </span>
      </div>
    </div>
  );
}

// Three bouncing dots shown in the placeholder bubble while Evee is thinking.
function TypingDots() {
  return (
    <span style={{ display:'inline-flex', gap: 4, alignItems:'center', padding:'2px 0' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{ width: 5, height: 5, borderRadius:'50%', background:'#8a9a7b',
          display:'inline-block', animation:`eveeDot 1.1s ${i * 0.15}s infinite ease-in-out` }} />
      ))}
    </span>
  );
}

// Text chat sidebar. The typewriter reveal + mood live in App (so the voice
// blob shares them and the reveal survives close/reopen); here we just consume
// `reveal`, `mood`, and `status`. Voice input is the blob, so there's no mic —
// the composer is a plain text field.
function ChatSidebar({ messages, onSend, onClose, onAction, reveal = 0, mood = 'idle', status = 'home · online',
                       voiceOn = true, voiceSupported = false, onToggleVoice }) {
  const scrollerRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages.length, reveal]);

  const [draft, setDraft] = React.useState('');
  const composerRef = React.useRef(null);

  return (
    <div style={{
      position:'fixed', top: 0, left: 0, bottom: 0, width: 320, zIndex: 60,
      background:'#fbf3e1', borderRight:'1.5px solid rgba(58,42,30,.25)',
      boxShadow:'4px 0 24px rgba(58,42,30,.15)',
      display:'flex', flexDirection:'column',
      fontFamily:'Inter, system-ui, sans-serif',
      animation:'eveeSlideIn .26s cubic-bezier(.2,.7,.2,1)',
    }}>
      <style>{`
        @keyframes eveeSlideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        @keyframes eveeDot { 0%,80%,100%{transform:translateY(0);opacity:.4} 40%{transform:translateY(-3px);opacity:1} }
        @keyframes eveeCaret { 0%,100%{opacity:1} 50%{opacity:0} }
        .evee-caret{ display:inline-block; width:2px; height:1em; margin-left:1px; vertical-align:-2px;
          background:#7c5cc4; animation:eveeCaret 1s step-end infinite; }
      `}</style>

      {/* Header */}
      <div style={{ padding:'14px 16px 10px',
        borderBottom:'1px solid rgba(58,42,30,.12)', display:'flex', alignItems:'center', gap: 10 }}>
        <EveeAvatar3 size={36} mood={mood} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily:'Caveat, cursive', fontSize: 22, fontWeight: 700, color:'#3a2a1e', lineHeight: 1 }}>Evee</div>
          <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 9, color:'rgba(58,42,30,.6)' }}>
            {status}
          </div>
        </div>
        {voiceSupported && (
          <button onClick={onToggleVoice} style={iconBtn}
            title={voiceOn ? 'Mute Evee' : 'Unmute Evee'}
            aria-label={voiceOn ? 'Mute Evee' : 'Unmute Evee'}>
            {voiceOn ? '🔊' : '🔇'}
          </button>
        )}
        <button onClick={onClose} title="Collapse" style={iconBtn}>−</button>
      </div>

      {/* Scroller */}
      <div ref={scrollerRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px',
        display:'flex', flexDirection:'column', gap: 10 }}>
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const isTyping = isLast && m.who === 'evee' && !m.pending;
          const shown = isTyping ? m.text.slice(0, reveal) : m.text;
          return (
            <Bubble3 key={i} who={m.who}>
              {m.pending ? <TypingDots /> : shown}
              {isTyping && reveal < m.text.length && <span className="evee-caret" />}
              {m.action && !isTyping && (
                <div style={{ display:'flex', gap: 6, marginTop: 8 }}>
                  <button onClick={() => onAction(m.action)} style={actionBtnPrimary}>
                    ✓ {m.action.label}
                  </button>
                  <button style={actionBtnGhost}>edit</button>
                </div>
              )}
            </Bubble3>
          );
        })}
      </div>

      {/* Composer — text only; voice input is the blob on the right */}
      <div style={{ padding: 10, borderTop:'1px solid rgba(58,42,30,.12)' }}>
        <form onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) { onSend(draft); setDraft(''); }
            // iOS leaves the on-screen keyboard up after submit unless the field
            // actually loses focus, so Enter would send but not dismiss it.
            if (composerRef.current) composerRef.current.blur();
          }}
          style={{ display:'flex', alignItems:'center', gap: 8,
          border:'1.5px solid rgba(58,42,30,.3)', borderRadius: 22,
          padding:'4px 4px 4px 12px', background:'#fff8eb' }}>
          <input ref={composerRef} value={draft} onChange={e => setDraft(e.target.value)}
            placeholder="type your reply…"
            style={{ flex: 1, border:'none', outline:'none', background:'transparent',
              fontFamily:'inherit', fontSize: 13, color:'#3a2a1e' }} />
          <button type="submit" title="Send" aria-label="Send" style={{
            width: 30, height: 30, borderRadius: 999,
            background:'#8a7fd1', color:'#fff8eb', border:'none', cursor:'pointer',
            display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize: 15 }}>↑</button>
        </form>
      </div>
    </div>
  );
}

function SuggestionChip({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      border:'1px dashed rgba(58,42,30,.35)', background:'transparent',
      borderRadius: 999, padding:'3px 8px', fontFamily:'Caveat, cursive',
      fontSize: 13, color:'rgba(58,42,30,.75)', cursor:'pointer',
    }}>{children}</button>
  );
}

function Bubble3({ who, children }) {
  const isMe = who === 'me';
  return (
    <div style={{ display:'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '90%',
        background: isMe ? '#e9b8a6' : '#fff8eb',
        border: '1.5px solid ' + (isMe ? '#c47358' : 'rgba(58,42,30,.2)'),
        color: '#3a2a1e',
        borderRadius: 14, padding:'8px 12px', fontSize: 13, lineHeight: 1.4,
        boxShadow: '0 1px 2px rgba(58,42,30,.06)',
      }}>{children}</div>
    </div>
  );
}

const iconBtn = {
  width: 28, height: 28, borderRadius: 6, border: 'none', background:'transparent',
  cursor:'pointer', color:'rgba(58,42,30,.6)', fontSize: 18, lineHeight: 1,
};
const actionBtnPrimary = {
  background:'#c47358', color:'#fff8eb', border:'none', padding:'4px 10px',
  borderRadius: 999, fontSize: 11, fontWeight: 600, cursor:'pointer',
};
const actionBtnGhost = {
  background:'transparent', color:'rgba(58,42,30,.7)',
  border:'1.5px solid rgba(58,42,30,.3)', padding:'4px 10px',
  borderRadius: 999, fontSize: 11, cursor:'pointer',
};

Object.assign(window, { VoiceWidget, ChatSidebar, EveeAvatar3, Bubble3, EVEE_GREETING, useSpeechRecognition, useSpeech });
