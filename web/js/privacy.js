// Privacy dei soci: informativa versionata, presa visione, consenso marketing email.
// Lo stato sul socio (soci.privacy_* / soci.marketing_email_*) è derivato dal DB
// a partire dallo storico `consensi_eventi`: qui si inseriscono solo eventi.
//
// Distinzione delle comunicazioni:
//  - SERVIZIO (promemoria scadenza, ricevute, benvenuto): legate al rapporto,
//    NON richiedono il consenso marketing (flag soci.consenso_mail).
//  - MARKETING (promozioni, offerte): solo con marketing_email_consent = true.

export const MARKETING_TEXT = 'Acconsento a ricevere comunicazioni commerciali e promozionali via email.';
export const ACK_TEXT = 'Ho preso visione dell’Informativa Privacy';
export const MAIL_CATEGORIA = { benvenuto: 'servizio', ricevuta: 'servizio', rinnovo: 'servizio', scaduto: 'servizio', promo: 'marketing' };
export const puoRicevere = (m, tipo) => MAIL_CATEGORIA[tipo] === 'marketing' ? !!m.marketing?.consent : true;

const MODALITA = { socio_in_reception: 'dal socio in reception', socio_online: 'dal socio online', richiesta_socio: 'su richiesta del socio' };
const AZIONE = { presa_visione: 'Presa visione informativa', concesso: 'Consenso marketing email', revocato: 'Revoca consenso marketing email' };

const fmtDT = (d) => d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–/–/––';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Mappa le colonne DB sul modello socio usato dall'app.
export const privacyFromRow = (s) => ({
  privacy: { ack: !!s.privacy_acknowledged, at: s.privacy_acknowledged_at, version: s.privacy_policy_version },
  marketing: { consent: !!s.marketing_email_consent, at: s.marketing_email_consent_at, revokedAt: s.marketing_email_revoked_at },
});

let _informative = null;
export async function loadInformative(supa) {
  if (_informative) return _informative;
  const { data, error } = await supa.from('informative_privacy').select('versione,testo,attiva,pubblicata_il').order('pubblicata_il', { ascending: false });
  if (error) throw error;
  _informative = data || [];
  return _informative;
}
export const informativaAttiva = (list) => list.find((i) => i.attiva) || list[0] || null;

export async function loadEventi(supa, sid) {
  const { data, error } = await supa.from('consensi_eventi')
    .select('tipo,azione,versione_informativa,modalita,registrato_il').eq('socio_id', sid)
    .order('registrato_il', { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}

// Inserisce gli eventi: data/ora e operatore li imposta il DB.
export async function registraEventi(supa, sid, eventi) {
  if (!eventi.length) return;
  const { error } = await supa.from('consensi_eventi').insert(eventi.map((e) => ({ socio_id: sid, ...e })));
  if (error) throw error;
}

// Eventi da registrare a partire dalla compilazione del socio.
export function eventiDaModulo(m, versione, { ack, marketing }) {
  const out = [];
  if (ack) out.push({ tipo: 'informativa_privacy', azione: 'presa_visione', versione_informativa: versione, modalita: 'socio_in_reception' });
  if (marketing && !m.marketing?.consent) out.push({ tipo: 'marketing_email', azione: 'concesso', versione_informativa: versione, testo: MARKETING_TEXT, modalita: 'socio_in_reception' });
  return out;
}
export const eventoRevoca = () => ({ tipo: 'marketing_email', azione: 'revocato', modalita: 'richiesta_socio' });

// Sezione "Privacy" della scheda socio (sola lettura per l'operatore).
export function schedaPrivacyHtml(m, versioneAttiva) {
  const p = m.privacy || {}, mk = m.marketing || {};
  const box = (checked) => `<span class="pv-box${checked ? ' on' : ''}" aria-hidden="true">${checked ? '✓' : ''}</span>`;
  const outdated = p.ack && versioneAttiva && p.version !== versioneAttiva;
  return `
    <div class="pv-sec">
      <div class="pv-h">PRIVACY <button type="button" class="linkbtn" data-informativa>Leggi l’Informativa Privacy</button></div>
      <div class="pv-row">${box(p.ack)} ${ACK_TEXT}</div>
      <div class="pv-meta">Data: <b>${fmtDT(p.at)}</b> · Versione: <b>${esc(p.version || versioneAttiva || '—')}</b></div>
      ${outdated ? `<div class="pv-warn">Informativa aggiornata alla versione ${esc(versioneAttiva)}: far prendere visione della nuova versione.</div>` : ''}
      <div class="pv-h" style="margin-top:14px">COMUNICAZIONI COMMERCIALI</div>
      <div class="pv-row">${box(mk.consent)} ${MARKETING_TEXT}</div>
      <div class="pv-meta">Data consenso: <b>${mk.consent ? fmtDT(mk.at) : '–/–/––'}</b>${mk.revokedAt ? ` · Revocato il: <b>${fmtDT(mk.revokedAt)}</b>` : ''}</div>
      <div class="pv-note">Facoltativo. Non riguarda le comunicazioni di servizio (es. scadenza dell’abbonamento).</div>
      <div class="pv-actions">
        <button type="button" class="btn-row" data-privacy-socio="${m.sid}" data-tip="Il socio legge l’informativa e spunta personalmente le caselle">Compila con il socio</button>
        <button type="button" class="btn-ghost btn-xs" data-revoca="${m.sid}" ${mk.consent ? '' : 'disabled'}>Revoca consenso marketing</button>
      </div>
      <details class="pv-hist" data-hist="${m.sid}"><summary>Storico</summary><div class="pv-histbody">Caricamento…</div></details>
    </div>`;
}

export function storicoHtml(eventi) {
  if (!eventi.length) return '<div class="pv-note">Nessun evento registrato.</div>';
  return '<ul>' + eventi.map((e) => `<li><b>${fmtDT(e.registrato_il)}</b> · ${AZIONE[e.azione] || esc(e.azione)}${e.versione_informativa ? ` (v. ${esc(e.versione_informativa)})` : ''} · ${MODALITA[e.modalita] || esc(e.modalita)}</li>`).join('') + '</ul>';
}

// Modale informativa con selettore delle versioni.
export function informativaHtml(list, versione) {
  const cur = list.find((i) => i.versione === versione) || informativaAttiva(list);
  if (!cur) return '<div class="pv-note">Nessuna informativa pubblicata.</div>';
  const opts = list.map((i) => `<option value="${esc(i.versione)}" ${i.versione === cur.versione ? 'selected' : ''}>Versione ${esc(i.versione)}${i.attiva ? ' (in vigore)' : ''} · ${new Date(i.pubblicata_il).toLocaleDateString('it-IT')}</option>`).join('');
  return `<div class="field"><label for="inf-ver">Versione</label><select id="inf-ver">${opts}</select></div>
    <div class="pv-text">${esc(cur.testo.trim())}</div>`;
}

// Modulo compilato dal socio sul dispositivo della reception. Caselle mai preselezionate.
export function moduloSocioHtml(m, inf) {
  const giaAck = m.privacy?.ack && m.privacy.version === inf.versione;
  return `
    <div class="pv-banner">Da compilare a cura del socio · consegna il dispositivo a <b>${esc(m.firstName || m.nome)}</b></div>
    <div class="pv-text" style="max-height:34vh">${esc(inf.testo.trim())}</div>
    <label class="check pv-check"><input type="checkbox" id="ps-ack" ${giaAck ? 'checked disabled' : ''}> ${ACK_TEXT} (versione ${esc(inf.versione)})${giaAck ? ' — già registrata' : ''}</label>
    <div class="pv-h" style="margin-top:16px">COMUNICAZIONI COMMERCIALI (facoltativo)</div>
    <label class="check pv-check"><input type="checkbox" id="ps-mkt" ${m.marketing?.consent ? 'checked disabled' : ''}> ${MARKETING_TEXT}${m.marketing?.consent ? ' — già prestato' : ''}</label>
    <div class="pv-note">Il consenso è facoltativo e revocabile in ogni momento; non incide sull’abbonamento né sulle comunicazioni di servizio.</div>`;
}
