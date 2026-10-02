-- BidMagnet: Supabase schema for PLACSP tender data.
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists tenders (
  id                text primary key,          -- PLACSP entry id (stable across versions)
  folder_id         text,                      -- expediente number set by the buyer
  title             text not null,
  link              text,                      -- tender page on PLACSP
  updated           timestamptz,               -- version timestamp; newer wins on upsert
  status            text,                      -- PRE, PUB (open), EV, ADJ, RES, ANUL
  status_label      text,
  buyer_name        text,
  buyer_nif         text,
  buyer_dir3        text,
  buyer_city        text,
  buyer_hierarchy   text[],
  region            text,
  contract_type     text,
  contract_type_label text,
  procedure_code    text,
  procedure_label   text,
  budget_no_tax     numeric,
  budget_with_tax   numeric,
  estimated_value   numeric,
  cpv_codes         text[],
  it_segment        text,                      -- core | hardware | telecom_network
  nuts_code         text,
  duration          numeric,
  duration_unit     text,                      -- ANN, MON, DAY
  deadline_date     date,
  deadline_time     time,
  over_eu_threshold boolean,
  has_lots          boolean,
  lots              jsonb,
  raw               jsonb,                     -- full parsed record, for anything not in a column
  ingested_at       timestamptz default now()
);
create index if not exists tenders_status_deadline on tenders (status, deadline_date);
create index if not exists tenders_buyer_nif on tenders (buyer_nif);
create index if not exists tenders_cpv on tenders using gin (cpv_codes);

create table if not exists tender_criteria (
  id          bigint generated always as identity primary key,
  tender_id   text references tenders(id) on delete cascade,
  lot_id      text,
  type        text,          -- OBJ = scored by formula, SUBJ = scored by judgement
  subtype     text,          -- 1 = price
  description text,
  note        text,
  weight      numeric
);
create index if not exists tender_criteria_tender on tender_criteria (tender_id);

create table if not exists tender_documents (
  id           bigint generated always as identity primary key,
  tender_id    text references tenders(id) on delete cascade,
  kind         text,         -- pcap, ppt, additional, general, notice
  name         text,
  doc_type     text,
  notice_type  text,
  url          text,
  hash         text,
  issue_date   date,
  storage_path text           -- set once the PDF is copied to Supabase Storage
);
create index if not exists tender_documents_tender on tender_documents (tender_id);

create table if not exists tender_results (
  id                    bigint generated always as identity primary key,
  tender_id             text references tenders(id) on delete cascade,
  lot_id                text,
  result_code           text,
  award_date            date,
  received_tenders      int,
  sme_received_tenders  int,
  lowest_bid            numeric,
  highest_bid           numeric,
  winner_nif            text,
  winner_name           text,
  award_amount_no_tax   numeric,
  award_amount_with_tax numeric,
  sme_awarded           boolean,
  contract_date         date
);
create index if not exists tender_results_tender on tender_results (tender_id);
create index if not exists tender_results_winner on tender_results (winner_nif);

create table if not exists tender_requirements (
  id          bigint generated always as identity primary key,
  tender_id   text references tenders(id) on delete cascade,
  lot_id      text,
  kind        text,          -- declaration, technical_solvency, financial_solvency, classification
  code        text,
  description text,
  threshold   numeric
);
create index if not exists tender_requirements_tender on tender_requirements (tender_id);

-- Output of the Claude PDF extraction (checklist with page citations)
create table if not exists tender_extractions (
  id          bigint generated always as identity primary key,
  tender_id   text references tenders(id) on delete cascade,
  document_id bigint references tender_documents(id) on delete set null,
  model       text,
  output      jsonb not null,
  created_at  timestamptz default now()
);

-- Logged-in users can read tender data; only the service key (pipeline) writes.
do $$
declare t text;
begin
  foreach t in array array['tenders','tender_criteria','tender_documents','tender_results',
                           'tender_requirements','tender_extractions'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'read for signed-in users') then
      execute format('create policy "read for signed-in users" on %I for select to authenticated using (true)', t);
    end if;
  end loop;
end $$;
