// Suoni con Web Audio API (nessun file audio).
// OK: tono breve e acuto. NEGATO: tono grave doppio. Partono dopo RITARDO ms
// per non coprire il bip (non disattivabile) del lettore.
// Nel kiosk Chrome va avviato con --autoplay-policy=no-user-gesture-required.
let ctx = null;

export function sbloccaAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* audio non disponibile */ }
  return ctx;
}

function tono(freq, inizio, durata, { vol = 0.35, forma = 'sine' } = {}) {
  const t0 = ctx.currentTime + inizio;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = forma;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.setValueAtTime(vol, t0 + durata - 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durata);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + durata + 0.02);
}

export function suona(tipo, ritardoMs = 150) {
  if (!sbloccaAudio()) return;
  const r = Math.max(0, ritardoMs) / 1000;
  if (tipo === 'ok') tono(1320, r, 0.16);
  else if (tipo === 'negato') { tono(220, r, 0.22, { forma: 'square', vol: 0.25 }); tono(220, r + 0.32, 0.22, { forma: 'square', vol: 0.25 }); }
  else if (tipo === 'lieve') tono(660, r, 0.06, { vol: 0.12 });
}
