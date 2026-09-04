// ─── api.jsx ───
// Thin client for Evee's backend inventory API (serve.py → Notion).
// Same-origin, so paths are relative. Each helper throws on a non-2xx
// response with the server's error message; callers decide how to surface it.

const API_BASE = '/api';

async function _json(res) {
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (data && data.error) || `request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// List all items, optionally scoped to one container (storage-area id).
async function apiListInventory(containerId) {
  const q = containerId ? `?containerId=${encodeURIComponent(containerId)}` : '';
  return _json(await fetch(`${API_BASE}/inventory${q}`));
}

// Create an item. `fields` = { name, quantity, notes, containerId, roomId, container, room }.
async function apiAddItem(fields) {
  return _json(await fetch(`${API_BASE}/inventory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }));
}

// Patch an item's properties (only the provided keys are written).
async function apiUpdateItem(itemId, patch) {
  return _json(await fetch(`${API_BASE}/inventory/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }));
}

// Archive an item in Notion.
async function apiDeleteItem(itemId) {
  return _json(await fetch(`${API_BASE}/inventory/${itemId}`, { method: 'DELETE' }));
}

// Update the human-readable Container label on all of a container's Notion rows.
async function apiRelabelContainer(containerId, container) {
  return _json(await fetch(`${API_BASE}/inventory/relabel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ containerId, container }),
  }));
}

// Re-link all rows of an orphaned container to another container.
// target = { containerId, roomId, container, room }.
async function apiReassignContainer(fromContainerId, target) {
  return _json(await fetch(`${API_BASE}/inventory/reassign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromContainerId, ...target }),
  }));
}

// Send the chat history + a room/container directory to the AI assistant.
// Returns { reply, changes } — reload inventory when changes is non-empty.
async function apiChat(messages, directory) {
  return _json(await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, directory }),
  }));
}

// Ask the backend to synthesize Evee's voice for `text` (ElevenLabs) and resolve
// to a URL an <audio> element can stream. Two steps on purpose: the text rides
// up in a POST body (her replies name the user's own things — those don't belong
// in a URL) and config/auth failures surface here, where the caller can catch
// them, while the returned GET streams the mp3 so playback starts on the first
// bytes instead of after the whole file. Throws if TTS isn't configured or the
// request failed (the caller then just shows the caption — Evee stays quiet,
// no browser fallback).
async function apiSpeakUrl(text) {
  const res = await fetch(`${API_BASE}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    let msg = `tts failed (${res.status})`;
    try { const d = await res.json(); if (d && d.error) msg = d.error; } catch {}
    throw new Error(msg);
  }
  return (await res.json()).url;
}

// Transcribe recorded audio. The blob goes up as the raw body — its own MIME
// type is the Content-Type, which tells the backend what MediaRecorder produced
// (audio/mp4 on Safari, audio/webm on Chrome).
async function apiTranscribe(blob) {
  const res = await fetch(`${API_BASE}/stt`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob,
  });
  if (!res.ok) {
    let msg = `stt failed (${res.status})`;
    try { const d = await res.json(); if (d && d.error) msg = d.error; } catch {}
    throw new Error(msg);
  }
  return (await res.json()).text || '';
}

// ─── Floor plan (server-side, serve.py → state/plan.json) ───
// The layout used to live only in localStorage, which is per-origin — so the
// iPad and the Mac kept separate copies and drifted. The server now holds it.

// { rev, updated, plan } where plan is { apt, furniture, storageAreas } — the
// same shape App keeps in state.
async function apiGetPlan() {
  return _json(await fetch(`${API_BASE}/plan`));
}

// Save the plan, declaring the rev it was based on. A conflict is an expected
// outcome, not a failure — the server returns its current copy so the caller
// can adopt it — so it comes back as { conflict: true, rev, plan } rather than
// throwing, and only real errors throw.
async function apiPutPlan(plan, rev) {
  const res = await fetch(`${API_BASE}/plan`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, rev }),
  });
  if (res.status === 409) {
    const d = await res.json();
    return { conflict: true, rev: d.rev, plan: d.plan };
  }
  return _json(res);
}

Object.assign(window, { apiGetPlan, apiPutPlan, apiListInventory, apiAddItem, apiUpdateItem, apiDeleteItem, apiRelabelContainer, apiReassignContainer, apiChat, apiSpeakUrl, apiTranscribe });
