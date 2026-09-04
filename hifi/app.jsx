// ─── app.jsx ───
// Top-level Evee app. Mounts the iso SVG stage, manages camera (home ↔ room),
// chat sidebar/bubble, side panels, global overlays, and the floor-plan editor.

const VIEWS = { HOME: 'home', ROOM: 'room', EDITOR: 'editor', ROOM_EDIT: 'roomEdit' };
const STORAGE_KEY = 'evee-plan-v2';

function useKey(handler) {
  React.useEffect(() => {
    const f = (e) => handler(e);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [handler]);
}

// Cached plan = { apt, furniture, storageAreas }. This is no longer the source
// of truth — the server is (GET/PUT /api/plan) — but it still seeds the first
// paint instantly and is what keeps the app renderable when the server is
// unreachable. Falls back to the module defaults from world.jsx.
function loadStoredPlan() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.apt && d.apt.rooms) return d;
    }
  } catch {}
  return null;
}

function App() {
  // Apartment data lifted into state so it can be edited at runtime. Mirror
  // to the original globals each render so existing scene components (which
  // still read window.APARTMENT etc.) see the live values.
  const stored = React.useMemo(loadStoredPlan, []);
  const [apt, setApt] = React.useState(() => stored?.apt || APARTMENT);
  const [furniture, setFurniture] = React.useState(() => stored?.furniture || HOME_FURNITURE);
  const [storageAreas, setStorageAreas] = React.useState(() => stored?.storageAreas || STORAGE_AREAS);
  // Saved furniture assemblies, shared across rooms (and devices — it rides the
  // same plan sync as the layout, so a cabinet saved on the Mac is there on the
  // iPad).
  const [catalog, setCatalog] = React.useState(() => stored?.catalog || CATALOG);
  // Inventory items, loaded from the Notion-backed API on mount. Keyed by
  // container id (== storage-area id). Source of truth is Notion; the
  // floor-plan layout above stays in localStorage.
  const [inventory, setInventory] = React.useState({});
  // Reassign the top-level `let` bindings (declared in world.jsx) so that
  // every component that references APARTMENT / HOME_FURNITURE / STORAGE_AREAS /
  // INVENTORY directly sees the live React state. Just assigning to window.* is
  // not enough — those bindings live in the script's lexical scope, not on window.
  APARTMENT = apt;
  HOME_FURNITURE = furniture;
  STORAGE_AREAS = storageAreas;
  INVENTORY = inventory;
  CATALOG = catalog;
  // Camera angle being dragged right now. null = use the saved THEME.tilt.
  // Kept out of `apt` on purpose: a drag would otherwise stream writes to the
  // server and push a rev to every other device on every frame.
  const [tiltDraft, setTiltDraft] = React.useState(null);
  const [zoomDraft, setZoomDraft] = React.useState(null);

  // Resolved scene theme. Unset keys fall back to DEFAULT_THEME, so a plan
  // saved before themes existed (or with `theme` cleared) renders stock.
  THEME = { ...DEFAULT_THEME, ...(apt.theme || {}) };
  // proj() reads ISO.TILT at call time, so mirroring it here (before children
  // render) is enough for every projected path to follow.
  ISO.TILT = tiltDraft != null ? tiltDraft : (THEME.tilt || 0.5);
  // Same mirroring for the light: faceShade() reads LIGHT at call time, so
  // setting it here (before children render) is enough for every face to follow.
  LIGHT.azimuth   = THEME.lightAzimuth;
  LIGHT.intensity = THEME.lightIntensity;
  LIGHT.sky       = THEME.lightSky;
  LIGHT.ambient   = THEME.lightAmbient;
  // Mirror to window for debugging/console use too.
  window.APARTMENT = apt;
  window.HOME_FURNITURE = furniture;
  window.STORAGE_AREAS = storageAreas;
  window.INVENTORY = inventory;
  window.CATALOG = catalog;
  window.THEME = THEME;
  React.useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ apt, furniture, storageAreas, catalog })); } catch {}
  }, [apt, furniture, storageAreas, catalog]);

  // ─── Plan sync (server-side layout) ───────────────────────
  // The server owns the layout so every device sees one apartment. Three refs
  // do the bookkeeping:
  //   planRev     — the rev our current state is based on, sent with each write
  //                 so the server can refuse a stale one.
  //   lastSynced  — serialized copy of what the server last confirmed. The
  //                 flush compares against it and skips a no-op write, which is
  //                 what stops an adopted remote change from being echoed
  //                 straight back as a local edit.
  //   hydrated    — false until the first GET lands, so first paint from the
  //                 cache never writes itself back over newer server state.
  const planRev = React.useRef(null);
  const lastSynced = React.useRef(null);
  const hydrated = React.useRef(false);
  const planTimer = React.useRef(null);
  const [online, setOnline] = React.useState(true);
  const PLAN_DEBOUNCE_MS = 600;

  // Take the server's copy as truth, without echoing it back.
  function adoptPlan(rev, plan) {
    planRev.current = rev;
    // Exposed so tests (and the console) can tell "hydrated from the server"
    // apart from "still showing the world.jsx defaults" — the two look alike on
    // first paint, and measuring the wrong one silently tests stale geometry.
    window.__eveePlanRev = rev;
    lastSynced.current = JSON.stringify(plan);
    setApt(plan.apt);
    setFurniture(plan.furniture || {});
    setStorageAreas(plan.storageAreas || {});
    setCatalog(plan.catalog || []);
  }

  React.useEffect(() => {
    let dead = false;
    apiGetPlan()
      .then(d => {
        if (dead) return;
        adoptPlan(d.rev, d.plan);
        setOnline(true);
      })
      .catch(() => { if (!dead) setOnline(false); })
      .finally(() => { hydrated.current = true; });
    return () => { dead = true; };
  }, []);

  // Debounced + coalesced write, same shape as the per-item inventory writes
  // below: a furniture drag must not be one request per frame.
  React.useEffect(() => {
    if (!hydrated.current) return;
    clearTimeout(planTimer.current);
    planTimer.current = setTimeout(() => {
      const plan = { apt, furniture, storageAreas, catalog };
      const body = JSON.stringify(plan);
      if (body === lastSynced.current) return;   // nothing of ours changed
      apiPutPlan(plan, planRev.current)
        .then(res => {
          setOnline(true);
          if (res && res.conflict) {
            // Someone else wrote first. The server wins — adopting is safer
            // than merging blind, and the push below makes this rare.
            adoptPlan(res.rev, res.plan);
            return;
          }
          planRev.current = res.rev;
          lastSynced.current = body;
        })
        .catch(() => setOnline(false));
    }, PLAN_DEBOUNCE_MS);
    return () => clearTimeout(planTimer.current);
  }, [apt, furniture, storageAreas, catalog]);

  // Live push: the livereload stream carries the plan rev alongside its own
  // {boot, v}. Its own EventSource on purpose — the reloader in Evee.html is a
  // plain <script> so a JSX error can never cost the page its ability to
  // reload, and that property is worth more than sharing one socket.
  React.useEffect(() => {
    let es;
    try { es = new EventSource('/api/livereload'); } catch { return; }
    es.onmessage = (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (typeof d.rev !== 'number' || d.rev === planRev.current) return;
      if (planRev.current === null) return;      // not hydrated yet
      apiGetPlan().then(s => adoptPlan(s.rev, s.plan)).catch(() => {});
    };
    es.onerror = () => setOnline(false);
    es.onopen = () => setOnline(true);
    return () => { try { es.close(); } catch {} };
  }, []);

  // ─── Inventory (Notion-backed) ────────────────────────────
  // Load (or reload) the whole inventory from the backend and group it by
  // container id. Called on mount and after the AI makes changes. Failures are
  // non-fatal: the app keeps the legacy scalar counts so it degrades gracefully
  // when the backend/Notion isn't configured.
  function loadInventory() {
    return apiListInventory()
      .then(items => {
        const byContainer = {};
        for (const it of items) {
          (byContainer[it.containerId] = byContainer[it.containerId] || []).push(it);
        }
        setInventory(byContainer);
      })
      .catch(err => console.warn('Evee: inventory load failed (offline?) —', err.message));
  }
  React.useEffect(() => { loadInventory(); }, []);

  // Inventory mutations funnel through here. The UI updates optimistically and
  // instantly, while the network write is COALESCED + DEBOUNCED per item — a
  // burst of clicks (e.g. the qty stepper) collapses into a single Notion write
  // carrying the final value. This keeps us under Notion's ~3 req/s rate limit;
  // any residual 429 is retried server-side (see inventory_service.py).
  // Pending writes live in a ref keyed by item id: { patch, containerId, timer }.
  const pendingWrites = React.useRef({});
  const WRITE_DEBOUNCE_MS = 400;

  function flushWrite(itemId) {
    const slot = pendingWrites.current[itemId];
    if (!slot) return;
    if (String(itemId).startsWith('tmp-')) return; // not persisted yet; addItem flushes after create
    clearTimeout(slot.timer);
    const patch = slot.patch;
    delete pendingWrites.current[itemId];
    apiUpdateItem(itemId, patch).catch(err => console.warn('Evee: item update failed —', err.message));
  }
  function queueWrite(containerId, itemId, patch) {
    const slot = pendingWrites.current[itemId] || (pendingWrites.current[itemId] = { patch: {}, containerId });
    slot.patch = { ...slot.patch, ...patch };
    slot.containerId = containerId;
    clearTimeout(slot.timer);
    slot.timer = setTimeout(() => flushWrite(itemId), WRITE_DEBOUNCE_MS);
  }

  function addItem(containerId, roomId, fields) {
    const area = (STORAGE_AREAS[roomId] || []).find(a => a.id === containerId);
    const room = APARTMENT.rooms.find(r => r.id === roomId);
    const payload = {
      name: fields.name || '',
      quantity: fields.quantity ?? null,
      notes: fields.notes || '',
      containerId, roomId,
      container: area?.label || '',
      room: room?.name || '',
    };
    const tempId = 'tmp-' + Date.now();
    setInventory(inv => ({ ...inv, [containerId]: [...(inv[containerId] || []), { id: tempId, ...payload }] }));
    apiAddItem(payload)
      .then(created => {
        // Adopt the real Notion id, but keep any edits made while the create was
        // in flight (queued under the temp id), then flush them to the real id.
        const pending = pendingWrites.current[tempId];
        const edits = pending ? pending.patch : null;
        if (pending) { clearTimeout(pending.timer); delete pendingWrites.current[tempId]; }
        setInventory(inv => ({
          ...inv,
          [containerId]: (inv[containerId] || []).map(it => it.id === tempId ? { ...created, ...(edits || {}) } : it),
        }));
        if (edits) apiUpdateItem(created.id, edits).catch(err => console.warn('Evee: item update failed —', err.message));
      })
      .catch(err => {
        const pending = pendingWrites.current[tempId];
        if (pending) { clearTimeout(pending.timer); delete pendingWrites.current[tempId]; }
        setInventory(inv => ({ ...inv, [containerId]: (inv[containerId] || []).filter(it => it.id !== tempId) }));
        alert('Could not add item: ' + err.message);
      });
  }
  function updateItem(containerId, itemId, patch) {
    // Optimistic + instant. The value the user sees is authoritative; we do NOT
    // overwrite it from the write response (avoids out-of-order stomping).
    setInventory(inv => ({
      ...inv,
      [containerId]: (inv[containerId] || []).map(it => it.id === itemId ? { ...it, ...patch } : it),
    }));
    queueWrite(containerId, itemId, patch);
  }
  function deleteItem(containerId, itemId) {
    const before = inventory[containerId] || [];
    const slot = pendingWrites.current[itemId];
    if (slot) { clearTimeout(slot.timer); delete pendingWrites.current[itemId]; } // cancel queued write
    setInventory(inv => ({ ...inv, [containerId]: (inv[containerId] || []).filter(it => it.id !== itemId) }));
    if (String(itemId).startsWith('tmp-')) return; // never persisted
    apiDeleteItem(itemId).catch(err => {
      setInventory(inv => ({ ...inv, [containerId]: before }));
      alert('Could not delete item: ' + err.message);
    });
  }

  // Orphaned inventory: items whose container id no longer matches any storage
  // area (the piece was deleted, storage turned off, or a plan loaded). Surfaced
  // in the Alerts drawer with re-link / delete. Item rows still carry the old
  // container/room *labels* from Notion, so we can show what they were.
  function reassignOrphan(fromContainerId, target) {
    apiReassignContainer(fromContainerId, {
      containerId: target.id, roomId: target.roomId,
      container: target.label, room: target.room,
    }).then(loadInventory).catch(err => alert('Could not move items: ' + err.message));
  }
  function deleteOrphan(containerId, items) {
    Promise.all(items.map(it => apiDeleteItem(it.id)))
      .then(loadInventory).catch(err => alert('Could not delete items: ' + err.message));
  }

  const [view, setView] = React.useState(VIEWS.HOME);
  const [activeRoom, setActiveRoom] = React.useState(null);
  const [hoverRoom, setHoverRoom] = React.useState(null);
  const [hoverArea, setHoverArea] = React.useState(null);
  const [selectedArea, setSelectedArea] = React.useState(null);

  const [chatOpen, setChatOpen] = React.useState(false);
  const [messages, setMessages] = React.useState([EVEE_GREETING]);

  // Speech-to-text for the blob: tap once → listen → auto-stop on silence
  // (browser default cutoff) → send to Evee. 20s hard cap; tap again mid-listen
  // to cancel. Voice results open the chat so Evee's (text) reply is visible
  // until she can speak it aloud. `sendUserMessage` is hoisted below.
  // The blob's wait bubble outlives the mic. The recognition hook shows a line
  // while it owns the turn (waking the mic, then transcribing) and then goes
  // idle — but Evee still owes a round trip to /api/chat and, after that, the
  // first mp3 bytes: a couple of seconds where the bubble used to simply vanish
  // and leave a silent blob. `waiting` holds it up until she actually starts
  // talking, and `waitLine` remembers the last line the hook showed so the text
  // doesn't change mid-wait — the whole point is time to read it.
  const [waiting, setWaiting] = React.useState(false);
  const [waitLine, setWaitLine] = React.useState('');
  const endWait = React.useCallback(() => setWaiting(false), []);

  const voice = useSpeechRecognition({
    maxMs: 20000,
    onResult: (text) => { setChatOpen(true); setWaiting(true); sendUserMessage(text); },
  });
  const listening = voice.listening;
  const arming = voice.arming;   // tap registered, mic not live yet
  // Latch the hook's line — the non-empty ones only. It clears `interim` in the
  // same batch that hands the transcript over, so by then this holds the line
  // that was already on screen and the handoff is invisible.
  React.useEffect(() => { if (voice.interim) setWaitLine(voice.interim); }, [voice.interim]);

  // Evee's spoken voice (ElevenLabs, via the /api/tts backend).
  // `voiceOn` lets the user mute her and persists across reloads; a ref mirrors
  // it so the reveal effect reads the live value without re-speaking an old
  // reply when the toggle flips. Muting also stops her mid-sentence.
  const speech = useSpeech();
  const [voiceOn, setVoiceOn] = React.useState(() => {
    try { return localStorage.getItem('evee-voice-on') !== '0'; } catch { return true; }
  });
  const voiceOnRef = React.useRef(voiceOn);
  voiceOnRef.current = voiceOn;
  React.useEffect(() => {
    try { localStorage.setItem('evee-voice-on', voiceOn ? '1' : '0'); } catch {}
  }, [voiceOn]);
  // The caption is revealed BY audio playback progress, so cancelling the audio
  // on its own freezes the message mid-sentence — or leaves it blank, if we were
  // still waiting on /api/tts. Muting should silence her, not truncate her. The
  // full reply text already exists (the backend returns it in one piece), so
  // just show all of it.
  const typeTextRef = React.useRef(null);
  function toggleVoice() {
    setVoiceOn(v => {
      const nv = !v;
      if (!nv) {
        speech.cancel();
        endWait();                    // she's not going to speak now; stop promising it
        if (typeTextRef.current) setReveal(typeTextRef.current.length);
      }
      return nv;
    });
  }

  // Reveal Evee's latest reply as a caption (the backend returns the full text
  // at once). When her voice is on, the spoken audio drives the reveal; when
  // muted/unsupported it falls back to a client-side typewriter. This lives in
  // App — not in the chat — so both the chat header avatar and the always-on
  // voice blob share one mood, and the reveal survives the chat closing and
  // reopening (no re-typing).
  const [reveal, setReveal] = React.useState(0);
  // On the first render after a page load, the only message present is whatever
  // was already on screen (the greeting — chat history is in-memory, so a
  // refresh wipes it). Reveal that one in full but never speak it; only replies
  // that arrive *during* the session should be read aloud.
  const initialRevealRef = React.useRef(true);
  const lastMsg = messages[messages.length - 1];
  const typeText = lastMsg && lastMsg.who === 'evee' && !lastMsg.pending ? lastMsg.text : null;
  typeTextRef.current = typeText;   // so muting can reveal the rest of it
  React.useEffect(() => {
    if (typeText == null) { setReveal(0); return; }
    if (initialRevealRef.current) {
      initialRevealRef.current = false;
      setReveal(typeText.length);   // show it, don't type or speak it
      return;
    }
    setReveal(0);

    // Reveal the caption in step with Evee's voice. When voice is on we ask the
    // speech hook to speak (ElevenLabs → browser fallback); it reports progress
    // as a character index, applied monotonically so the text never jumps back.
    // If nothing could speak (or voice is muted) we fall back to the timed
    // typewriter so the caption still moves.
    let cancelled = false, timer = null;
    const runTypewriter = (from = 0) => {
      let n = from;
      const tick = () => {
        if (cancelled) return;
        n += 1; setReveal(n);
        if (n >= typeText.length) return;
        const ch = typeText[n - 1];
        const d = /[.!?]/.test(ch) ? 200 : /[,;:]/.test(ch) ? 110 : /\s/.test(ch) ? 36 : 22;
        timer = setTimeout(tick, d);
      };
      timer = setTimeout(tick, from ? 0 : 120);
    };
    const onProgress = (idx) => {
      if (!cancelled) setReveal(r => Math.max(r, Math.min(typeText.length, idx)));
    };

    if (voiceOnRef.current) {
      // Speak; if no audio was produced, drive the caption on the typewriter.
      // `onStart` is the real end of the wait — it fires on the first frame of
      // sound, not when we commit to speak (the /api/tts fetch sits between the
      // two, and that gap is the dead air the blob is covering).
      speech.speak(typeText, {
        onStart: endWait,
        onProgress,
        onEnd: () => { endWait(); if (!cancelled) setReveal(typeText.length); },
      }).then(spoke => { if (!spoke && !cancelled) { endWait(); runTypewriter(0); } });
      return () => { cancelled = true; if (timer) clearTimeout(timer); speech.cancel(); };
    }

    endWait();                        // muted: the caption is all she's going to give
    runTypewriter(0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [typeText]);
  // Speaking = audio playing/loading OR caption still revealing (muted typewriter).
  const eveeSpeaking = speech.speaking || (typeText != null && reveal < typeText.length);
  const eveeThinking = !!(lastMsg && lastMsg.pending);
  // `waiting` outranks `eveeSpeaking`: speech.speaking goes true the moment we
  // commit to speak, which is a fetch too early — the orb would settle into
  // 'speaking' while she's still silent.
  const eveeMood = listening ? 'listening' : arming ? 'waking'
    : waiting ? 'thinking' : eveeSpeaking ? 'speaking' : eveeThinking ? 'thinking' : 'idle';
  const eveeStatus = listening ? '● listening…' : arming ? '● waking the mic…'
    : waiting || eveeThinking ? '● thinking…' : eveeSpeaking ? '● speaking…' : 'home · online';
  // Read by the live-reload script in Evee.html so an edit never yanks the page
  // out from under a conversation — it waits for her to finish first.
  window.__eveeBusy = listening || arming || waiting || eveeSpeaking;

  const [overlay, setOverlay] = React.useState(null); // 'search' | 'timeline' | 'alerts' | 'theme' | null

  // ─── Navigation ───────────────────────────────────────────
  function enterRoom(id) {
    setActiveRoom(id);
    setView(VIEWS.ROOM);
    setHoverRoom(null);
  }
  function backToHome() {
    setView(VIEWS.HOME);
    setSelectedArea(null);
    setHoverArea(null);
    setTimeout(() => setActiveRoom(null), 400);
  }
  // Per-room view rotation (90° snaps), stored on the room so it persists as
  // the default the next time that room is opened.
  function rotateActiveRoom(delta) {
    if (!activeRoom || !online) return;
    setApt(a => ({
      ...a,
      rooms: a.rooms.map(r => r.id === activeRoom
        ? { ...r, viewRot: ((((r.viewRot || 0) + delta) % 4) + 4) % 4 }
        : r),
    }));
  }
  const activeRot = (APARTMENT.rooms.find(r => r.id === activeRoom) || {}).viewRot || 0;

  // ─── Keyboard ─────────────────────────────────────────────
  useKey((e) => {
    if (e.key === 'Escape') {
      if (overlay) return setOverlay(null);
      if (selectedArea) return setSelectedArea(null);
      if (view === VIEWS.ROOM) return backToHome();
      if (chatOpen) return setChatOpen(false);
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault(); setOverlay('search');
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault(); setChatOpen(o => !o);
    }
  });

  // ─── Chat ─────────────────────────────────────────────────
  // Send the user's message to the AI assistant (/api/chat). We pass the full
  // chat history plus a live directory of rooms + containers (with ids) so
  // Claude can resolve "the fridge" → a container id. The backend runs a tool
  // loop over the same inventory_service functions the manual panel uses; when
  // it reports changes we reload inventory so the scene reflects them.
  function sendUserMessage(text) {
    // Composer submit is a real gesture — bless the audio element here too, so a
    // typed-only session still gets Evee's voice on iOS (see useSpeech.unlock).
    speech.unlock();
    const history = [...messages, { who: 'me', text }];
    setMessages(history);
    setMessages(m => [...m, { who: 'evee', text: '…', pending: true }]);

    const directory = {
      rooms: APARTMENT.rooms
        .filter(r => !r.noInteract)
        .map(r => ({ id: r.id, name: r.name })),
      containers: Object.entries(STORAGE_AREAS).flatMap(([roomId, areas]) =>
        (areas || []).map(a => ({ id: a.id, label: a.label, roomId }))),
    };
    const apiMessages = history.map(m => ({
      role: m.who === 'me' ? 'user' : 'assistant',
      content: m.text,
    }));

    const settle = (msg) => setMessages(m => {
      const base = m.length && m[m.length - 1].pending ? m.slice(0, -1) : m;
      return [...base, msg];
    });

    apiChat(apiMessages, directory)
      .then(res => {
        settle({ who: 'evee', text: res.reply || '(no reply)' });
        if (res.changes && res.changes.length) loadInventory();
        // She can drive the view: `open_room` comes back as a navigation target
        // rather than an inventory change (the server owns Notion, we own the router).
        if (res.navigate && res.navigate.roomId) {
          if (res.navigate.roomId === 'home') goHome();
          else goTo(res.navigate.roomId, res.navigate.containerId);
        }
      })
      .catch(err => settle({ who: 'evee', text: 'Sorry — ' + err.message }));
  }
  function onAction(action) {
    if (action.kind === 'goto') {
      enterRoom(action.payload);
    }
  }

  // ─── Theme (⋮ → Customize) ────────────────────────────────
  // The theme lives on `apt`, so it persists to localStorage and travels in a
  // saved plan for free. `setTheme(null)` drops the key back to the stock look.
  function setTheme(patch) {
    if (!online) return;
    setApt(a => {
      // NB: no object-rest here — Babel's `_excluded` helper is top-level
      // and every text/babel file shares one scope, so a second use of
      // rest-destructuring anywhere collides and the app fails to boot.
      if (patch === null) { const next = { ...a }; delete next.theme; return next; }
      return { ...a, theme: { ...(a.theme || {}), ...patch } };
    });
  }

  // Preset slots. A slot the user has saved over lives in `apt.presets[name]`;
  // absent means the built-in from BUILTIN_PRESETS still applies, so resetting
  // a slot is a delete rather than a copy of the original back in.
  function savePreset(name) {
    if (!online) return;
    setApt(a => ({ ...a, presets: { ...(a.presets || {}), [name]: { ...THEME } } }));
  }
  function resetPreset(name) {
    if (!online) return;
    setApt(a => {
      const ps = { ...(a.presets || {}) };
      delete ps[name];
      if (Object.keys(ps).length) return { ...a, presets: ps };
      const cleared = { ...a }; delete cleared.presets; return cleared;
    });
  }

  // Drop every room's own colour so they all follow THEME.floor. Skips
  // `noInteract` rooms — those are the wall infills, whose grey is structural
  // rather than decorative, and washing them with the floor colour would read
  // as the walls disappearing. Destructive to hand-tuned colours, so it
  // confirms first, the way Load Plan does.
  function resetRoomColors() {
    if (!online) return;
    const n = apt.rooms.filter(r => !r.noInteract && r.color).length;
    if (!n) return;
    if (!window.confirm(
        `Discard the individual colours on ${n} room${n === 1 ? '' : 's'}? They will follow the theme from now on. ` +
        `A theme floor already overrides them without deleting anything — this is only needed to remove them for good.`)) return;
    setApt(a => ({ ...a, rooms: a.rooms.map(r => {
      if (r.noInteract) return r;
      const next = { ...r }; delete next.color; return next;
    }) }));
  }

  // ─── Floor-plan menu actions ──────────────────────────────
  function exportPlanJson() {
    const data = { version: 1, ...apt, furniture, storageAreas, catalog };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'evee-plan.json'; a.click();
    URL.revokeObjectURL(url);
  }
  function importPlanJson() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = (e) => {
      const file = e.target.files[0]; if (!file || !online) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const d = JSON.parse(reader.result);
          if (!d.rooms || !Array.isArray(d.rooms)) throw new Error('missing rooms');
          // Loading a plan reassigns container ids, which unlinks them from any
          // Notion items keyed by the old ids. Warn if there's anything to lose.
          const hasContainers = Object.values(STORAGE_AREAS).some(a => (a || []).length);
          const hasItems = Object.values(INVENTORY).some(x => (x || []).length);
          if ((hasContainers || hasItems) && !window.confirm(
              'Loading a plan replaces your current layout and containers. Items already saved in Notion stay in Notion, but may become unlinked from the new containers. Continue?')) {
            return;
          }
          setApt({ width: d.width, depth: d.depth, rooms: d.rooms, name: d.name || '',
                   theme: d.theme, presets: d.presets });
          setFurniture(d.furniture || {});
          setStorageAreas(d.storageAreas || {});
          // A plan file from before the catalog existed shouldn't wipe the saved
          // furniture — the library isn't part of the layout it replaces.
          if (Array.isArray(d.catalog)) setCatalog(d.catalog);
          // Get out of any room view since ids may have changed
          setActiveRoom(null); setSelectedArea(null); setView(VIEWS.HOME);
        } catch (err) { alert('Could not load plan: ' + err.message); }
      };
      reader.readAsText(file);
    };
    input.click();
  }
  function openPlanEditor() {
    if (!online) return;
    setSelectedArea(null); setActiveRoom(null); setView(VIEWS.EDITOR);
  }
  function openRoomEditor() {
    if (!activeRoom || !online) return;
    setSelectedArea(null); setHoverArea(null); setView(VIEWS.ROOM_EDIT);
  }

  // ─── Editor view ──────────────────────────────────────────
  if (view === VIEWS.EDITOR) {
    return <FloorPlanEditor apt={apt} setApt={setApt}
      onFinish={() => setView(VIEWS.HOME)}
      onExport={exportPlanJson} />;
  }
  if (view === VIEWS.ROOM_EDIT) {
    return <RoomEditor roomId={activeRoom}
      apt={apt} setApt={setApt}
      furniture={furniture} setFurniture={setFurniture}
      storageAreas={storageAreas} setStorageAreas={setStorageAreas}
      catalog={catalog} setCatalog={setCatalog}
      onFinish={() => setView(VIEWS.ROOM)} />;
  }

  // Derive orphaned inventory + the container picker list for the Alerts drawer.
  const validContainerIds = new Set(Object.values(storageAreas).flat().map(a => a.id));
  const orphans = Object.entries(inventory)
    .filter(([cid, items]) => items && items.length && !validContainerIds.has(cid))
    .map(([cid, items]) => ({
      containerId: cid,
      items,
      label: items[0].container || '',
      room: items[0].room || '',
    }));
  const orphanItemCount = orphans.reduce((n, o) => n + o.items.length, 0);
  const allContainers = apt.rooms.flatMap(r =>
    (storageAreas[r.id] || []).map(a => ({ id: a.id, roomId: r.id, label: a.label, room: r.name })));
  // Flat item list for Search + Recent; low-stock list for Alerts (≤1 in a real
  // container — orphaned items are handled in their own section).
  const allItems = Object.values(inventory).flat();
  const LOW_STOCK = 1;
  const lowStock = allItems.filter(it =>
    validContainerIds.has(it.containerId) && it.quantity != null && it.quantity <= LOW_STOCK);
  const alertCount = orphanItemCount + lowStock.length;
  // Navigate to an item's container (used by Search / Recent / Alerts results).
  function goTo(roomId, containerId) {
    setOverlay(null);
    enterRoom(roomId);
    if (containerId) setTimeout(() => setSelectedArea(containerId), 500);
  }
  // Zoom back out to the dollhouse. The home view is not a room, so Evee targets
  // it with the reserved id 'home' (see open_room in chat_service.py).
  function goHome() {
    setOverlay(null); setSelectedArea(null); setActiveRoom(null); setView(VIEWS.HOME);
  }

  return (
    <div style={{ position:'fixed', inset: 0, background:'#efe1c6', overflow:'hidden',
      fontFamily:'Inter, system-ui, sans-serif', color:'#3a2a1e' }}>
      <SceneStage view={view} activeRoom={activeRoom}
        hoverRoom={hoverRoom} setHoverRoom={setHoverRoom}
        onEnterRoom={enterRoom}
        hoverArea={hoverArea} setHoverArea={setHoverArea}
        selectedArea={selectedArea} setSelectedArea={setSelectedArea}
        rot={activeRot} onRotate={rotateActiveRoom} offline={!online}
        tilt={tiltDraft != null ? tiltDraft : (THEME.tilt || 0.5)}
        zoom={zoomDraft != null ? zoomDraft : (THEME.zoom || 1)}
        tiltActive={tiltDraft != null || zoomDraft != null}
        tiltDirty={
          (tiltDraft != null && Math.abs(tiltDraft - (THEME.tilt || 0.5)) > 1e-6) ||
          (zoomDraft != null && Math.abs(zoomDraft - (THEME.zoom || 1)) > 1e-6)}
        onTiltDraft={setTiltDraft} onZoomDraft={setZoomDraft}
        onTiltCommit={() => {
          // Angle and zoom save as a pair — they describe one view, and letting
          // one persist without the other is how you end up with a saved angle
          // framed by a zoom you never chose.
          setTheme({
            tilt: tiltDraft != null ? tiltDraft : (THEME.tilt || DEFAULT_THEME.tilt),
            zoom: zoomDraft != null ? zoomDraft : (THEME.zoom || DEFAULT_THEME.zoom),
          });
          setTiltDraft(null); setZoomDraft(null);
        }}
        // Reset DISCARDS the drag and falls back to the saved view — it does not
        // reset to stock. Dropping both drafts is the whole implementation, and
        // it writes nothing, so it works offline too. To get back to stock
        // isometric, Customize → Reset theme to default.
        onTiltReset={() => { setTiltDraft(null); setZoomDraft(null); }}
        chatOpen={chatOpen} />

      <TopBar view={view} room={activeRoom} onBack={backToHome}
        chatOpen={chatOpen}
        onToggleChat={() => { speech.unlock(); setChatOpen(o => !o); }}
        homeName={apt.name || ''}
        alertCount={alertCount}
        onRenameHome={(name) => setApt(a => ({ ...a, name }))}
        onOpenSearch={() => setOverlay('search')}
        onOpenTimeline={() => setOverlay('timeline')}
        onOpenAlerts={() => setOverlay('alerts')}
        onCustomize={() => setOverlay('theme')}
        offline={!online}
        onCreatePlan={openPlanEditor}
        onModifyRoom={openRoomEditor}
        onSavePlan={exportPlanJson}
        onLoadPlan={importPlanJson} />

      {/* Evee — always-on voice blob (right), opens the text chat (left).
          A transparent scrim closes the chat on any outside click; the blob
          sits above it (zIndex 62) so it stays tappable while chatting. */}
      <VoiceWidget onOpen={() => { speech.unlock(); setChatOpen(true); }}
        onMic={() => {
          // iOS: this tap is the only chance to unlock audio playback, because
          // Evee speaks after an async fetch. Must run before any await.
          speech.unlock();
          speech.cancel();                         // barge-in: stop Evee mid-sentence
          endWait();                               // ...and drop the last turn's bubble
          if (voice.supported) voice.toggle(); else setChatOpen(true);
        }}
        listening={listening} arming={arming} waiting={waiting}
        caption={voice.interim || (listening ? '' : waitLine)}
        mood={eveeMood} panelOpen={!!selectedArea} />
      {chatOpen && (
        <React.Fragment>
          <div onClick={() => setChatOpen(false)} style={{
            position:'fixed', inset: 0, zIndex: 58, background:'transparent' }} />
          <ChatSidebar messages={messages} onSend={sendUserMessage}
            onClose={() => setChatOpen(false)} onAction={onAction}
            reveal={reveal} mood={eveeMood} status={eveeStatus}
            voiceOn={voiceOn} voiceSupported={speech.supported} onToggleVoice={toggleVoice} />
        </React.Fragment>
      )}

      {/* Selected area → item panel */}
      {selectedArea && (
        <ItemSidePanel areaId={selectedArea} roomId={activeRoom}
          items={inventory[selectedArea] || []}
          onAddItem={(fields) => addItem(selectedArea, activeRoom, fields)}
          onUpdateItem={(itemId, patch) => updateItem(selectedArea, itemId, patch)}
          onDeleteItem={(itemId) => deleteItem(selectedArea, itemId)}
          onClose={() => setSelectedArea(null)} />
      )}

      {/* Overlays */}
      {overlay === 'search'   && <SearchOverlay   onClose={() => setOverlay(null)}
        items={allItems} onGoTo={goTo} />}
      {overlay === 'timeline' && <TimelineOverlay onClose={() => setOverlay(null)}
        items={allItems} onGoTo={goTo} />}
      {overlay === 'alerts'   && <AlertsOverlay   onClose={() => setOverlay(null)}
        orphans={orphans} lowStock={lowStock} containers={allContainers}
        onReassign={reassignOrphan} onDelete={deleteOrphan} onGoTo={goTo} />}
      {overlay === 'theme'    && <ThemePanel      onClose={() => setOverlay(null)}
        theme={THEME} onChange={setTheme} onResetRooms={resetRoomColors}
        presetOverrides={apt.presets} onSavePreset={savePreset} onResetPreset={resetPreset} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// TopBar — minimal header with navigation, search, alerts, etc.
// ──────────────────────────────────────────────────────────────
function TopBar({ view, room, onBack, chatOpen, onToggleChat, homeName, onRenameHome, alertCount = 0,
                  onOpenSearch, onOpenTimeline, onOpenAlerts, onCustomize, offline = false,
                  onCreatePlan, onModifyRoom, onSavePlan, onLoadPlan }) {
  const r = APARTMENT.rooms.find(x => x.id === room);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef(null);
  React.useEffect(() => {
    if (!menuOpen) return;
    function onDown(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);
  function pick(action) { setMenuOpen(false); action && action(); }

  // Inline editing of the home name (HOME view only).
  const HOME_PLACEHOLDER = 'Your Home Name Here';
  const [editingName, setEditingName] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  function startEdit() { setDraft(homeName || ''); setEditingName(true); }
  function commitEdit() { onRenameHome && onRenameHome(draft.trim()); setEditingName(false); }
  return (
    <div style={{
      position:'fixed', top: 0, right: 0, left: chatOpen ? 320 : 0, height: 56,
      display:'flex', alignItems:'center', gap: 12, padding:'0 22px',
      background:`linear-gradient(to bottom, ${rgbaOf(THEME.bg || '#efe1c6', .92)}, ${rgbaOf(THEME.bg || '#efe1c6', .7)} 70%, transparent)`,
      zIndex: 59, pointerEvents:'none', transition:'left .26s',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap: 10, pointerEvents:'auto', minWidth: 0 }}>
        {/* Second way into the chat, next to where the sidebar actually appears.
            The blob's "Ask Evee" tab only opens; this one toggles. */}
        <button onClick={onToggleChat}
          style={{ ...topBtn, background: chatOpen ? 'rgba(138,127,209,.22)' : topBtn.background }}
          title={chatOpen ? 'Close chat (⌘E)' : 'Chat with Evee (⌘E)'}
          aria-label={chatOpen ? 'Close chat' : 'Open chat'}
          aria-pressed={chatOpen}>
          {/* Panel-left glyph — this opens a side panel, so it should read as a
              sidebar toggle, not a "new message" bubble. Rail fills when open. */}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"
               stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            {chatOpen && (
              <rect x="4.1" y="5.6" width="4.4" height="12.8" rx="1.3"
                    fill="currentColor" stroke="none" opacity=".5" />
            )}
            <rect x="3.2" y="4.7" width="17.6" height="14.6" rx="2.4" />
            <line x1="9.4" y1="4.7" x2="9.4" y2="19.3" />
          </svg>
        </button>
        {view === VIEWS.ROOM && (
          <button onClick={onBack} style={topBtn} title="Back to home (esc)">
            ←
          </button>
        )}
        <div style={{ lineHeight: 1.05, minWidth: 0 }}>
          {view === VIEWS.HOME ? (
            editingName ? (
              <input autoFocus value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                  if (e.key === 'Escape') { e.stopPropagation(); setEditingName(false); }
                }}
                placeholder={HOME_PLACEHOLDER}
                style={{ fontFamily:'Caveat, cursive', fontSize: 22, fontWeight: 700, color:'#3a2a1e',
                  background:'rgba(255,248,235,.7)', border:'1.5px solid rgba(58,42,30,.25)', borderRadius: 6,
                  padding:'0 6px', outline:'none', minWidth: 220, maxWidth: '60vw' }} />
            ) : (
              <div onClick={startEdit} title="Click to rename"
                style={{ fontFamily:'Caveat, cursive', fontSize: 22, fontWeight: 700,
                  color: homeName ? '#3a2a1e' : 'rgba(58,42,30,.45)', whiteSpace:'nowrap', cursor:'text' }}>
                {homeName || HOME_PLACEHOLDER}
              </div>
            )
          ) : (
            <div style={{ fontFamily:'Caveat, cursive', fontSize: 22, fontWeight: 700, color:'#3a2a1e', whiteSpace:'nowrap' }}>
              {r?.name}
            </div>
          )}
          <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 9, color:'rgba(58,42,30,.6)', marginTop: 3, whiteSpace:'nowrap' }}>
            {view === VIEWS.HOME
              ? (() => {
                  const allAreas = Object.values(STORAGE_AREAS).flat();
                  const items = allAreas.reduce((s, a) => s + itemCount(a), 0);
                  return `${items} items · ${allAreas.length} containers`;
                })()
              : (() => {
                  const roomAreas = STORAGE_AREAS[r?.id] || [];
                  const items = roomAreas.reduce((s, a) => s + itemCount(a), 0);
                  return `${items} items · ${roomAreas.length} storage areas`;
                })()}
            {offline && (
              <span style={{ marginLeft: 8, padding:'1px 6px', borderRadius: 99,
                background:'rgba(196,115,88,.16)', color:'#a2543c',
                border:'1px solid rgba(196,115,88,.35)' }}
                title="The layout lives on the server. Until it is reachable again, this device shows its last copy and cannot edit.">
                offline · view only
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display:'flex', alignItems:'center', gap: 6, pointerEvents:'auto' }}>
        <button onClick={onOpenSearch} style={topBtnLabel} title="Search · ⌘K">
          <span>🔍</span><span>Search</span>
          <kbd style={kbdMini}>⌘K</kbd>
        </button>
        <button onClick={onOpenTimeline} style={topBtn} title="Recent">⏱</button>
        <button onClick={onOpenAlerts} style={{ ...topBtn, position:'relative' }}
          title={alertCount ? `Alerts · ${alertCount} need${alertCount === 1 ? 's' : ''} attention` : 'Alerts'}>
          ⚠
          {alertCount > 0 && (
            <span style={{ position:'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: 99,
              background:'#c47358', border:'1.5px solid #fbf3e1' }} />
          )}
        </button>
        <div style={{ width: 1, height: 22, background:'rgba(58,42,30,.2)', margin:'0 4px' }} />
        <div ref={menuRef} style={{ position:'relative' }}>
          <button style={topBtn} title="More" onClick={() => setMenuOpen(o => !o)}>⋮</button>
          {menuOpen && (
            <div style={{ position:'absolute', top:'calc(100% + 6px)', right: 0, minWidth: 200,
              background:'rgba(255,248,235,.98)', border:'1.5px solid rgba(58,42,30,.18)',
              borderRadius: 10, padding: 6, boxShadow:'0 8px 24px rgba(58,42,30,.18)',
              backdropFilter:'blur(8px)', fontSize: 13, zIndex: 50 }}>
              {view === VIEWS.ROOM && (
                <button style={offline ? menuItemOff : menuItem} disabled={offline}
                  onClick={() => pick(onModifyRoom)}>✦  Modify Room…</button>
              )}
              <button style={offline ? menuItemOff : menuItem} disabled={offline}
                onClick={() => pick(onCustomize)}>✧  Customize…</button>
              <button style={offline ? menuItemOff : menuItem} disabled={offline}
                onClick={() => pick(onCreatePlan)}>✎  Create Floor Plan</button>
              <button style={offline ? menuItemOff : menuItem} disabled={offline}
                onClick={() => pick(onLoadPlan)}>↑  Load Floor Plan…</button>
              <button style={menuItem} onClick={() => pick(onSavePlan)}>↓  Save Plan (backup)</button>
              {offline && (
                <div style={{ padding:'6px 12px 4px', fontSize: 11, color:'rgba(58,42,30,.55)',
                  lineHeight: 1.35, maxWidth: 200 }}>
                  Editing is off while the server is unreachable, so devices can't drift apart.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
const menuItemOff = {
  display:'block', width:'100%', textAlign:'left', padding:'8px 12px',
  background:'transparent', border:'none', borderRadius: 6, cursor:'default',
  color:'rgba(58,42,30,.35)', fontFamily:'Inter, system-ui, sans-serif', fontSize: 13,
};

const menuItem = {
  display:'block', width:'100%', textAlign:'left', padding:'8px 12px',
  background:'transparent', border:'none', borderRadius: 6, cursor:'pointer',
  color:'#3a2a1e', fontFamily:'Inter, system-ui, sans-serif', fontSize: 13,
};

const topBtn = {
  width: 36, height: 36, borderRadius: 10,
  border:'1.5px solid rgba(58,42,30,.2)', background:'rgba(255,248,235,.6)',
  cursor:'pointer', color:'#3a2a1e', fontSize: 14, lineHeight: 1,
  display:'inline-flex', alignItems:'center', justifyContent:'center',
  fontFamily:'Inter, system-ui, sans-serif',
  backdropFilter:'blur(8px)',
};
const topBtnLabel = {
  ...topBtn, width:'auto', padding:'0 12px', gap: 6, fontSize: 12, fontWeight: 500,
};
const kbdMini = {
  fontFamily:'JetBrains Mono, monospace', fontSize: 9, color:'rgba(58,42,30,.6)',
  border:'1px solid rgba(58,42,30,.2)', borderRadius: 4, padding:'1px 5px', marginLeft: 4,
};
const rotateBtn = {
  width: 44, height: 44, borderRadius: 12,
  border:'1.5px solid rgba(58,42,30,.2)', background:'rgba(255,248,235,.75)',
  cursor:'pointer', color:'#3a2a1e', fontSize: 20, lineHeight: 1,
  display:'inline-flex', alignItems:'center', justifyContent:'center',
  fontFamily:'Inter, system-ui, sans-serif', backdropFilter:'blur(8px)',
  boxShadow:'0 4px 12px rgba(58,42,30,.15)',
};

const tiltBtn = {
  padding:'6px 10px', borderRadius: 8, cursor:'pointer', fontSize: 12,
  border:'1.5px solid rgba(58,42,30,.25)', background:'rgba(255,255,255,.6)',
  color:'#3a2a1e', fontFamily:'Inter, system-ui, sans-serif', whiteSpace:'nowrap',
};

const rotateBtnOff = {
  ...rotateBtn, cursor:'default', opacity: .4, boxShadow:'none',
};

// ──────────────────────────────────────────────────────────────
// SceneStage — the SVG canvas that hosts isometric scenes
// ──────────────────────────────────────────────────────────────
function SceneStage({ view, activeRoom, hoverRoom, setHoverRoom, onEnterRoom,
                       hoverArea, setHoverArea, selectedArea, setSelectedArea,
                       rot = 0, onRotate, chatOpen, offline = false,
                       tilt = 0.5, zoom = 1, tiltDirty = false, tiltActive = false,
                       onTiltDraft, onZoomDraft, onTiltCommit, onTiltReset }) {
  // Camera: home shows the whole apartment, room zooms in on the active room.
  // We compute viewBox in screen coords (after iso projection).
  const PAD = 80;

  const homeBounds = React.useMemo(() => svgBounds([
    { x: 0, y: 0 }, { x: APARTMENT.width, y: 0 },
    { x: APARTMENT.width, y: APARTMENT.depth }, { x: 0, y: APARTMENT.depth },
  ], 12), [APARTMENT.width, APARTMENT.depth, tilt]);

  const roomBounds = React.useMemo(() => {
    if (!activeRoom) return homeBounds;
    const r = APARTMENT.rooms.find(x => x.id === activeRoom);
    if (!r) return homeBounds;
    // Support both polygon rooms (r.points) and legacy rect rooms (r.w/r.d).
    const bb = r.points ? bbox(r.points) : { w: r.w, d: r.d };
    // Odd quarter-turns swap the rendered footprint's width/depth.
    const W = rot % 2 === 0 ? bb.w : bb.d;
    const D = rot % 2 === 0 ? bb.d : bb.w;
    return svgBounds([
      { x: 0, y: 0 }, { x: W, y: 0 },
      { x: W, y: D }, { x: 0, y: D },
    ], 9); // include wall height
  }, [activeRoom, APARTMENT, rot, tilt]);

  const bounds = view === VIEWS.HOME ? homeBounds : roomBounds;
  const vb = (() => {
    const x = bounds.x - PAD, y = bounds.y - PAD;
    const w = bounds.w + PAD * 2, h = bounds.h + PAD * 2;
    const z = zoom || 1;
    // Scale about the centre so zooming does not also pan.
    const cw = w / z, ch = h / z;
    return `${x + (w - cw) / 2} ${y + (h - ch) / 2} ${cw} ${ch}`;
  })();

  // Background gradient varies by room mood. Pull color directly off the room
  // (PALETTE.floor map was removed when polygon rooms got their own color field).
  const activeColor = themeFloor(APARTMENT.rooms.find(x => x.id === activeRoom));
  const homeBg = THEME.bg
    ? `radial-gradient(ellipse at 50% 55%, ${shade(THEME.bg, +22)} 0%, ${THEME.bg} 55%, ${shade(THEME.bg, -21)} 100%)`
    : STOCK_BG_GRADIENT;
  const bgGradient = view === VIEWS.HOME
    ? homeBg
    : `radial-gradient(ellipse at 50% 55%, ${shade(activeColor, +28)} 0%, ${shade(activeColor, -10)} 90%)`;

  // ─── Drag to change the camera angle ──────────────────────
  // A vertical drag anywhere on the stage tilts the camera. The threshold
  // matters: without it every room click would register as a 1px drag, and
  // swallowing the click on any movement would make rooms feel unclickable.
  const drag = React.useRef(null);
  const didDrag = React.useRef(false);
  const TILT_MIN = 0.28, TILT_MAX = 0.95;
  const ZOOM_MIN = 0.6, ZOOM_MAX = 2.2;
  const TILT_PER_PX = 0.0017;   // ~full range over a 400px drag

  function tiltPointerDown(e) {
    if (e.button !== 0 || !onTiltDraft) return;
    if (e.target.closest && e.target.closest('[data-no-tilt]')) return;
    drag.current = { y: e.clientY, tilt };
    didDrag.current = false;
    // NB: no setPointerCapture here. Capturing on pointerdown retargets the
    // click to this container, so a plain tap would never reach the room's hit
    // path and rooms would stop opening. Capture only once it is really a drag.
  }
  function tiltPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!didDrag.current && Math.abs(dy) < 4) return;   // still a click
    if (!didDrag.current) {
      didDrag.current = true;
      // Now it is a drag: capture so it keeps tracking outside the element.
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
      // Surface zoom alongside the angle — going top-down shrinks the
      // apartment on screen, so it is almost always the next thing adjusted.
      if (onZoomDraft) onZoomDraft(z => (z == null ? zoom : z));
    }
    // Drag DOWN to look down from higher — you are tipping the apartment's far
    // edge toward you, the "grab the model" reading rather than "move the
    // camera". The opposite mapping was tried first and read as backwards.
    onTiltDraft(Math.max(TILT_MIN, Math.min(TILT_MAX, d.tilt + dy * TILT_PER_PX)));
  }
  function tiltPointerUp(e) {
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }
  // Capture phase: a drag that happens to end over a room must not also open it.
  function tiltClickCapture(e) {
    if (!didDrag.current) return;
    e.stopPropagation();
    e.preventDefault();
    didDrag.current = false;
  }

  return (
    <div style={{ position:'absolute', inset: 0, transition:'left .26s',
      left: chatOpen ? 320 : 0, touchAction:'none',
      background: bgGradient }}
      onPointerDown={tiltPointerDown} onPointerMove={tiltPointerMove}
      onPointerUp={tiltPointerUp} onPointerCancel={tiltPointerUp}
      onClickCapture={tiltClickCapture}>

      {/* Subtle vignette */}
      <div style={{ position:'absolute', inset: 0,
        background:'radial-gradient(ellipse at 50% 60%, transparent 50%, rgba(58,42,30,.18) 100%)',
        pointerEvents:'none' }} />

      <svg viewBox={vb} preserveAspectRatio="xMidYMid meet"
        style={{ width:'100%', height:'100%', display:'block',
          transition:'all .55s cubic-bezier(.7,.05,.25,1)' }}>
        <defs>
          {/* Soft ambient occlusion under platform */}
          <radialGradient id="aoFloor" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="rgba(58,42,30,0.4)" />
            <stop offset="100%" stopColor="rgba(58,42,30,0)" />
          </radialGradient>
        </defs>

        {/* Floor ambient occlusion ellipse */}
        {view === VIEWS.HOME && (
          <ellipse cx={0} cy={(APARTMENT.depth * ISO.S) / 2 + 20}
            rx={(APARTMENT.width + APARTMENT.depth) * ISO.S * 0.7}
            ry={(APARTMENT.width + APARTMENT.depth) * ISO.S * 0.32}
            fill="url(#aoFloor)" opacity="0.45" />
        )}

        {view === VIEWS.HOME ? (
          <HomeScene hoverRoom={hoverRoom} onHover={setHoverRoom}
            onEnterRoom={onEnterRoom} />
        ) : (
          <RoomScene roomId={activeRoom} rot={rot}
            hoverArea={hoverArea} onHoverArea={setHoverArea}
            selectedArea={selectedArea}
            onPickArea={setSelectedArea} />
        )}
      </svg>

      {tiltActive && (
        <div data-no-tilt style={{ position:'absolute', left: 22, bottom: 22, zIndex: 40,
          display:'flex', flexDirection:'column', gap: 8, padding:'10px 12px',
          borderRadius: 12, minWidth: 210,
          background:'rgba(255,248,235,.92)', border:'1.5px solid rgba(58,42,30,.2)',
          boxShadow:'0 6px 18px rgba(58,42,30,.18)', backdropFilter:'blur(8px)',
          fontFamily:'Inter, system-ui, sans-serif' }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize: 12, color:'#3a2a1e' }}>
            <span>Camera angle</span>
            <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 11, opacity:.65 }}>
              {tilt.toFixed(2)}
            </span>
          </div>
          <input type="range" min={TILT_MIN} max={TILT_MAX} step="0.01" value={tilt}
            onChange={e => onTiltDraft && onTiltDraft(Number(e.target.value))}
            style={{ width:'100%' }} />

          <div style={{ display:'flex', justifyContent:'space-between', fontSize: 12,
            color:'#3a2a1e', marginTop: 2 }}>
            <span>Zoom</span>
            <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 11, opacity:.65 }}>
              {zoom.toFixed(2)}×
            </span>
          </div>
          <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step="0.01" value={zoom}
            onChange={e => onZoomDraft && onZoomDraft(Number(e.target.value))}
            style={{ width:'100%' }} />

          {tiltDirty && (
            <div style={{ display:'flex', gap: 6 }}>
              <button onClick={onTiltCommit} disabled={offline}
                title={offline ? 'Unavailable while offline' : 'Save as the default angle'}
                style={{ ...tiltBtn, flex: 1, opacity: offline ? .45 : 1,
                  background:'#5c4a32', color:'#fbf3e1', borderColor:'#5c4a32' }}>
                Set as default
              </button>
              <button onClick={onTiltReset}
                title="Discard these changes and go back to your saved view"
                style={tiltBtn}>
                Reset
              </button>
            </div>
          )}
        </div>
      )}

      {/* Rotate room view (90° snaps) — saved per room */}
      {view === VIEWS.ROOM && (
        <div style={{ position:'absolute', right: 24, bottom: 176, display:'flex', gap: 8, pointerEvents:'auto' }}>
          <button onClick={() => onRotate && onRotate(-1)} disabled={offline}
            style={offline ? rotateBtnOff : rotateBtn}
            title={offline ? 'Unavailable while offline' : 'Rotate left'}>↺</button>
          <button onClick={() => onRotate && onRotate(1)} disabled={offline}
            style={offline ? rotateBtnOff : rotateBtn}
            title={offline ? 'Unavailable while offline' : 'Rotate right'}>↻</button>
        </div>
      )}
    </div>
  );
}

// Helper: given some world-space rectangle corners, return iso-projected bounds.
function svgBounds(worldPoints, topHeight = 10) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of worldPoints) {
    // Project bottom and "top of walls" so we include vertical extent
    for (const z of [0, topHeight]) {
      const [sx, sy] = proj(p.x, p.y, z);
      if (sx < minX) minX = sx;
      if (sy < minY) minY = sy;
      if (sx > maxX) maxX = sx;
      if (sy > maxY) maxY = sy;
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
