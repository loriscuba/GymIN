-- Pagamenti creati automaticamente dall'import abbonamenti (prezzo di listino del piano):
-- restano "da verificare" finché lo staff non conferma importo e metodo dalla modifica pagamento.
alter table pagamenti add column if not exists da_verificare boolean not null default false;
create index if not exists idx_pag_da_verificare on pagamenti(data) where da_verificare;
