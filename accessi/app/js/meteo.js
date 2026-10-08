// Meteo di oggi per la schermata d'attesa del terminale (Open-Meteo: gratuito, senza chiave).
// Facoltativo: se la rete manca o la chiamata fallisce il riquadro resta nascosto.
// Posizione configurabile con METEO_LAT / METEO_LON / METEO_LUOGO (vuoto METEO_LAT = meteo spento).

// Codici WMO -> descrizione italiana e icona
const CODICI = [
  [[0], 'Sereno', '☀️'],
  [[1], 'Poco nuvoloso', '🌤️'],
  [[2], 'Parzialmente nuvoloso', '⛅'],
  [[3], 'Coperto', '☁️'],
  [[45, 48], 'Nebbia', '🌫️'],
  [[51, 53, 55, 56, 57], 'Pioviggine', '🌦️'],
  [[61, 63, 66, 80, 81], 'Pioggia', '🌧️'],
  [[65, 67, 82], 'Pioggia forte', '🌧️'],
  [[71, 73, 75, 77, 85, 86], 'Neve', '🌨️'],
  [[95, 96, 99], 'Temporale', '⛈️'],
];

/** codice WMO -> { testo, icona } (pura, testata) */
export function descriviMeteo(codice) {
  const c = Number(codice);
  for (const [lista, testo, icona] of CODICI) if (lista.includes(c)) return { testo, icona };
  return { testo: '', icona: '🌡️' };
}

/** risposta Open-Meteo -> dati da mostrare, o null se incompleta (pura, testata) */
export function leggiMeteo(j) {
  const t = j?.current?.temperature_2m;
  if (!Number.isFinite(t)) return null;
  const d = j.daily || {};
  const num = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  return {
    ...descriviMeteo(j.current.weather_code ?? d.weather_code?.[0]),
    temp: Math.round(t),
    min: num(d.temperature_2m_min?.[0]),
    max: num(d.temperature_2m_max?.[0]),
    pioggia: num(d.precipitation_probability_max?.[0]),
  };
}

export async function scaricaMeteo(lat, lon, { fetch: f = fetch, timeoutMs = 8000 } = {}) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,weather_code'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&timezone=Europe%2FRome&forecast_days=1';
  const r = await f(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`Meteo HTTP ${r.status}`);
  return leggiMeteo(await r.json());
}
