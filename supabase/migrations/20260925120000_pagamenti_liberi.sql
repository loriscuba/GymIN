-- Pagamenti registrati direttamente (senza creare un abbonamento):
--  - saldo di un abbonamento già utilizzato ma non pagato
--  - entrate libere / prezzo libero
-- Il pagamento può quindi non avere abbonamento; il socio è salvato direttamente (facoltativo per le entrate libere).

alter table pagamenti alter column abbonamento_id drop not null;
alter table pagamenti add column if not exists socio_id uuid references soci(id) on delete cascade;
alter table pagamenti add column if not exists descrizione text;

update pagamenti p set socio_id = a.socio_id
  from abbonamenti a
 where a.id = p.abbonamento_id and p.socio_id is null;

create index if not exists idx_pag_socio on pagamenti(socio_id);
create index if not exists idx_pag_data on pagamenti(data);
