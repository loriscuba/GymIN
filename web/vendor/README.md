# Librerie di terze parti (servite in locale)

| File | Origine | Versione | Licenza |
|---|---|---|---|
| `supabase.js` | `@supabase/supabase-js` (npm), file `dist/umd/supabase.js` | 2.117.2 | MIT |

Servite dal nostro dominio invece che da un CDN: se il CDN venisse compromesso,
il codice malevolo girerebbe con la sessione dello staff e potrebbe leggere tutti i dati.
Per aggiornare: `npm pack @supabase/supabase-js@<versione>` e copia `package/dist/umd/supabase.js`
qui e in `accessi/app/vendor/` (stessa versione), poi aggiorna questa tabella.
