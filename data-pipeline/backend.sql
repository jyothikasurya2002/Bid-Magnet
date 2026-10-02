-- BidMagnet backend: company profiles, buyer stats, renewal radar, fit score.
-- Run after schema.sql (Supabase → SQL Editor, or psql). Safe to re-run.
-- The frontend calls these directly with supabase-js; see API.md.

-- --------------------------------------------------------------------------
-- 0. Semantic embeddings (embed.py fills them; 384-dim multilingual model, half precision)
-- --------------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated;   -- so functions can use the vector operators

create table if not exists tender_embeddings (
  tender_id  text primary key references tenders(id) on delete cascade,
  embedding  extensions.halfvec(384) not null,
  text_md5   text not null,          -- md5 of the embedded text; re-embed only when it changes
  model      text not null
);
alter table tender_embeddings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'tender_embeddings' and policyname = 'read for signed-in users') then
    create policy "read for signed-in users" on tender_embeddings for select to authenticated using (true);
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 1. Company profile (Screen 1). One user can own several companies.
-- --------------------------------------------------------------------------
create table if not exists companies (
  id               uuid primary key default gen_random_uuid(),
  owner            uuid default auth.uid(),          -- Supabase user; null = shared demo company
  name             text not null,
  description      text,
  cpv_prefixes     text[] not null default '{}',     -- e.g. {7221,7226,48} — sector codes they work in
  keywords         text[] not null default '{}',     -- matched against tender titles, e.g. {portal,web,cloud}
  regions          text[] not null default '{}',     -- e.g. {"Comunitat Valenciana"}; empty = anywhere
  include_national boolean not null default true,    -- also show contracts performed nationwide
  annual_turnover  numeric,                          -- best of last 3 years, EUR
  employees        int,
  certifications   text[] not null default '{}',     -- ISO27001, ISO9001, ISO14001, ENS_BASICA, ENS_MEDIA, ENS_ALTA
  has_classification boolean not null default false, -- business classification (clasificación empresarial)
  rolece           boolean not null default false,   -- registered in ROLECE
  min_budget       numeric,
  max_budget       numeric,
  created_at       timestamptz default now()
);

alter table companies add column if not exists embedding extensions.halfvec(384);  -- from description + keywords
alter table companies add column if not exists embedding_md5 text;

alter table companies enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'companies' and policyname = 'owner manages own companies') then
    create policy "owner manages own companies" on companies for all to authenticated
      using (owner = auth.uid()) with check (owner = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'companies' and policyname = 'demo companies readable') then
    create policy "demo companies readable" on companies for select to authenticated using (owner is null);
  end if;
end $$;

-- Go / No-go / Watch decisions (Screen 3)
create table if not exists tender_decisions (
  id          bigint generated always as identity primary key,
  company_id  uuid references companies(id) on delete cascade,
  tender_id   text references tenders(id) on delete cascade,
  decision    text not null check (decision in ('go', 'no_go', 'watch')),
  reason      text,
  owner_name  text,
  decided_by  uuid default auth.uid(),
  decided_at  timestamptz default now(),
  unique (company_id, tender_id)
);
alter table tender_decisions enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'tender_decisions' and policyname = 'decisions of own companies') then
    create policy "decisions of own companies" on tender_decisions for all to authenticated
      using (exists (select 1 from companies c where c.id = company_id and (c.owner = auth.uid() or c.owner is null)))
      with check (exists (select 1 from companies c where c.id = company_id and (c.owner = auth.uid() or c.owner is null)));
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 1b. Company details + company documents (requested by the frontend team).
--     Profile page: legal data, ROLECE and classification status, and a private
--     document vault (certificates, ROLECE, ENS, ISO, insurance...) with extraction.
-- --------------------------------------------------------------------------
alter table companies add column if not exists nif text;                       -- legal entity; links to past awards
alter table companies add column if not exists website_url text;               -- source for website prefilling
alter table companies add column if not exists rolece_status text not null default 'unknown';
alter table companies add column if not exists rolece_last_verified_at timestamptz;
alter table companies add column if not exists classification_status text not null default 'unknown';
alter table companies add column if not exists classification_codes text[] not null default '{}';  -- e.g. {V-5-4, V-2-3}
alter table companies add column if not exists updated_at timestamptz not null default now();
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'companies_rolece_status_check') then
    alter table companies add constraint companies_rolece_status_check
      check (rolece_status in ('unknown', 'applied', 'active', 'not_registered', 'needs_update'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'companies_classification_status_check') then
    alter table companies add constraint companies_classification_status_check
      check (classification_status in ('unknown', 'active', 'not_held', 'needs_update'));
  end if;
end $$;
create index if not exists companies_nif on companies (nif);

-- updated_at maintained by the database, so autosave conflict checks can trust it
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists companies_updated_at on companies;
create trigger companies_updated_at before update on companies
  for each row execute function set_updated_at();

create table if not exists company_documents (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  storage_path      text not null unique,          -- '<company_id>/<file>' in bucket company-documents
  original_name     text not null,
  mime_type         text,
  byte_size         bigint check (byte_size is null or byte_size <= 20 * 1024 * 1024),
  sha256            text,
  document_type     text,                          -- ROLECE | ENS | ISO | CLASSIFICATION | INSURANCE | OTHER ...
  processing_status text not null default 'uploaded'
                    check (processing_status in ('uploaded', 'extracting', 'needs_review', 'ready', 'failed')),
  extraction        jsonb check (extraction is null or jsonb_typeof(extraction) = 'object'),
  reviewed_at       timestamptz,
  reviewed_by       uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, sha256)                      -- same file uploaded twice for one company
);
create index if not exists company_documents_company on company_documents (company_id);
drop trigger if exists company_documents_updated_at on company_documents;
create trigger company_documents_updated_at before update on company_documents
  for each row execute function set_updated_at();

alter table company_documents enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'company_documents' and policyname = 'owner manages own company documents') then
    create policy "owner manages own company documents" on company_documents for all to authenticated
      using (exists (select 1 from companies c where c.id = company_id and c.owner = auth.uid()))
      with check (exists (select 1 from companies c where c.id = company_id and c.owner = auth.uid()));
  end if;
end $$;

-- Private bucket; files must live under '<company_id>/...' and only that company's owner can touch them
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-documents', 'company-documents', false, 20 * 1024 * 1024,
        array['application/pdf', 'application/xml', 'text/xml', 'application/zip',
              'application/x-zip-compressed', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;
do $$
declare op text;
begin
  foreach op in array array['select', 'insert', 'update', 'delete'] loop
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'company documents ' || op) then
      execute format(
        'create policy %I on storage.objects for %s to authenticated %s',
        'company documents ' || op, op,
        case op
          when 'insert' then 'with check (bucket_id = ''company-documents'' and (storage.foldername(name))[1] in (select id::text from public.companies where owner = auth.uid()))'
          when 'update' then 'using (bucket_id = ''company-documents'' and (storage.foldername(name))[1] in (select id::text from public.companies where owner = auth.uid())) with check (bucket_id = ''company-documents'' and (storage.foldername(name))[1] in (select id::text from public.companies where owner = auth.uid()))'
          else 'using (bucket_id = ''company-documents'' and (storage.foldername(name))[1] in (select id::text from public.companies where owner = auth.uid()))'
        end);
    end if;
  end loop;
end $$;

-- Credentials proven by reviewed documents, mapped to the codes the fit score uses
create or replace view company_credentials with (security_invoker = true) as
select d.company_id, d.id as document_id, d.document_type,
       case
         when d.document_type = 'ENS' and upper(coalesce(d.extraction->>'credential_level', '')) ~ 'ALTA'  then 'ENS_ALTA'
         when d.document_type = 'ENS' and upper(coalesce(d.extraction->>'credential_level', '')) ~ 'MEDIA' then 'ENS_MEDIA'
         when d.document_type = 'ENS' then 'ENS_BASICA'
         when d.document_type = 'ISO' and coalesce(d.extraction->>'credential_code', d.extraction->>'standard_edition', '') ~ '27001' then 'ISO27001'
         when d.document_type = 'ISO' and coalesce(d.extraction->>'credential_code', d.extraction->>'standard_edition', '') ~ '9001'  then 'ISO9001'
         when d.document_type = 'ISO' and coalesce(d.extraction->>'credential_code', d.extraction->>'standard_edition', '') ~ '14001' then 'ISO14001'
       end as certification,
       nullif(d.extraction->>'expiry_date', '')::date as expiry_date
from company_documents d
where d.processing_status = 'ready'
  and (nullif(d.extraction->>'expiry_date', '') is null or (d.extraction->>'expiry_date')::date >= current_date);

-- Expiry alerts for the vault: reviewed documents expiring in the next 90 days (or already expired)
create or replace view company_document_alerts with (security_invoker = true) as
select d.company_id, d.id as document_id, d.document_type, d.original_name,
       (d.extraction->>'expiry_date')::date as expiry_date,
       ((d.extraction->>'expiry_date')::date - current_date) as days_left
from company_documents d
where d.processing_status = 'ready'
  and nullif(d.extraction->>'expiry_date', '') is not null
  and (d.extraction->>'expiry_date')::date <= current_date + 90;

-- Does a company classification satisfy a tender requirement? Tender codes look like 'V5-1'
-- (group V, subgroup 5, minimum category 1; '*' = any subgroup). Company codes: 'V-5-4', 'V54'...
create or replace function classification_covers(company_codes text[], required text)
returns boolean language sql immutable as $$
  select exists (
    select 1 from unnest(company_codes) cc,
      lateral (select regexp_replace(upper(cc), '[^A-Z0-9]', '', 'g') as c,
                      regexp_replace(upper(required), '[^A-Z0-9*]', '', 'g') as r) n
    where left(n.c, 1) = left(n.r, 1)                                         -- group
      and (substr(n.r, 2, 1) = '*' or substr(n.c, 2, 1) = substr(n.r, 2, 1))   -- subgroup
      and coalesce(nullif(regexp_replace(right(n.c, 1), '\D', '', 'g'), '')::int, 0)
          >= coalesce(nullif(regexp_replace(right(n.r, 1), '\D', '', 'g'), '')::int, 0)  -- category
  )
$$;

-- --------------------------------------------------------------------------
-- 2. Buyer stats (Screen 3 "who you're up against"). Refreshed by load_supabase.py.
-- --------------------------------------------------------------------------
drop materialized view if exists buyer_stats;
create materialized view buyer_stats as
with awards as (
  select t.buyer_nif, t.buyer_name, r.*,
         -- discount vs. the budget of the same lot; only competitive procedures (negotiated
         -- without publicity, framework call-offs and dynamic systems have no real price competition)
         case when t.procedure_label not in ('Negociado sin publicidad', 'Derivado de acuerdo marco',
                                             'Basado en sistema dinámico de adquisición')
                   and r.award_amount_no_tax > 0 and b.base > 0
              then 1 - r.award_amount_no_tax / b.base end as discount
  from tenders t
  join tender_results r on r.tender_id = t.id
  cross join lateral (
    select case when r.lot_id is null then t.budget_no_tax
                else (select (l->>'budget_no_tax')::numeric from jsonb_array_elements(t.lots) l
                      where l->>'lot_id' = r.lot_id limit 1) end as base
  ) b
  where t.buyer_nif is not null
),
winners as (
  select buyer_nif, winner_nif, max(winner_name) as winner_name, count(*) as wins
  from awards where winner_nif is not null group by 1, 2
)
select
  t.buyer_nif,
  max(t.buyer_name)                                   as buyer_name,
  max(t.region)                                       as region,
  count(distinct t.id)                                as it_tenders,
  count(distinct t.id) filter (where t.status = 'PUB') as open_tenders,
  (select count(*) from awards a where a.buyer_nif = t.buyer_nif)                         as awards,
  (select percentile_cont(0.5) within group (order by a.received_tenders)
     from awards a where a.buyer_nif = t.buyer_nif)                                       as median_bidders,
  (select count(*) from awards a where a.buyer_nif = t.buyer_nif and a.discount between -0.05 and 0.9) as discount_sample,
  (select case when count(*) >= 3 then percentile_cont(0.5) within group (order by a.discount) end
     from awards a where a.buyer_nif = t.buyer_nif and a.discount between -0.05 and 0.9)  as median_discount,  -- null if < 3 awards
  (select max(a.award_date) from awards a where a.buyer_nif = t.buyer_nif)                as last_award_date,
  (select coalesce(jsonb_agg(jsonb_build_object('name', w.winner_name, 'nif', w.winner_nif, 'wins', w.wins)
                             order by w.wins desc), '[]')
     from (select * from winners w where w.buyer_nif = t.buyer_nif order by wins desc limit 5) w) as top_winners
from tenders t
where t.buyer_nif is not null
group by t.buyer_nif;
create unique index if not exists buyer_stats_nif on buyer_stats (buyer_nif);
-- Materialized views don't support RLS: expose read access to signed-in users only
revoke all on buyer_stats from anon;
grant select on buyer_stats to authenticated;

-- --------------------------------------------------------------------------
-- 3. Renewal radar: awarded contracts ending in the next 12 months.
--    End date = planned end date, else start/award date + duration.
-- --------------------------------------------------------------------------
alter table tender_results add column if not exists start_date date;  -- older databases

create or replace view upcoming_renewals with (security_invoker = true) as
select * from (
  select
    t.id as tender_id, t.title, t.buyer_name, t.buyer_nif, t.region, t.cpv_codes, t.it_segment,
    r.lot_id, r.winner_name as incumbent, r.winner_nif as incumbent_nif,
    r.award_amount_no_tax, r.award_date, t.duration, t.duration_unit,
    coalesce(
      t.period_end,
      coalesce(r.start_date, r.contract_date, r.award_date)
        + case t.duration_unit
            when 'ANN' then make_interval(years => t.duration::int)
            when 'MON' then make_interval(months => t.duration::int)
            when 'DAY' then make_interval(days => t.duration::int)
          end
    )::date as estimated_end
  from tenders t join tender_results r on r.tender_id = t.id
  where r.winner_nif is not null
) x
where estimated_end between current_date and current_date + interval '12 months';

-- --------------------------------------------------------------------------
-- 4. Fit score (Screen 2). Rule-based and explainable: every point has a reason.
--    select * from match_tenders('<company uuid>') order by score desc;
-- --------------------------------------------------------------------------
create or replace function match_tenders(p_company uuid, p_limit int default 200)
returns table (
  tender_id text, title text, buyer_name text, region text, budget_no_tax numeric,
  deadline_date date, days_left int, procedure_label text, it_segment text,
  score int, reasons jsonb, has_checklist boolean, link text
)
language plpgsql stable security invoker
set search_path = public, extensions as $$
#variable_conflict use_column
declare
  c companies%rowtype;
  certs text[];        -- declared certifications + those proven by reviewed, unexpired documents
  rolece_ok boolean;
begin
  select * into c from companies where id = p_company;
  if not found then
    raise exception 'company % not found or not yours', p_company;
  end if;
  select c.certifications || coalesce(array_agg(cc.certification) filter (where cc.certification is not null), '{}')
    into certs from company_credentials cc where cc.company_id = c.id;
  rolece_ok := c.rolece or c.rolece_status = 'active';

  return query
  with open_t as (
    select t.*,
           (t.deadline_date - current_date) as dleft,
           exists (select 1 from unnest(t.cpv_codes) cpv, unnest(c.cpv_prefixes) p where cpv like p || '%') as sector_ok,
           -- Spanish stemming: keyword "aplicaciones" matches "aplicación" in title or buyer
           (select count(*) from unnest(c.keywords) k where t.search @@ plainto_tsquery('spanish', k))      as kw_hits,
           -- annual value ≈ estimated value spread over the duration (default 1 year)
           coalesce(t.estimated_value, t.budget_no_tax)
             / greatest(case t.duration_unit when 'ANN' then t.duration when 'MON' then t.duration / 12.0
                                             when 'DAY' then t.duration / 365.0 end, 1) as annual_value,
           -- requirement text from the XML, plus the cited checklist's eligibility section when we have one
           lower(coalesce((select string_agg(q.description, ' ') from tender_requirements q where q.tender_id = t.id), '') || ' ' ||
                 coalesce((select string_agg(coalesce(el->>'requirement_en', '') || ' ' || coalesce(el->>'threshold', ''), ' ')
                           from tender_extractions e, jsonb_array_elements(e.output->'eligibility') el
                           where e.tender_id = t.id), '')) as req_text,
           (select array_agg(q.code) from tender_requirements q
             where q.tender_id = t.id and q.kind = 'classification' and q.code is not null)       as class_codes,
           -- small simplified tender without solvency requirements in the data: usually no proof of
           -- turnover/experience needed (art. 159.6 LCSP), a way for young companies to build experience
           -- (by law the abbreviated simplified procedure, under 60k €, waives solvency proof)
           (t.procedure_label = 'Abierto simplificado'
            and coalesce(t.estimated_value, t.budget_no_tax) < 60000)                      as solvency_light,
           -- meaning-based similarity between the tender title and the company profile (null if not embedded)
           (select 1 - (e.embedding <=> c.embedding) from tender_embeddings e where e.tender_id = t.id) as sim
    from tenders t
    where t.status = 'PUB' and t.deadline_date >= current_date
      and (c.min_budget is null or t.budget_no_tax >= c.min_budget)
      and (c.max_budget is null or t.budget_no_tax <= c.max_budget)
  ),
  candidates as (
    select o.*, b.median_bidders,
           (o.req_text ~ '27001')                                             as needs_iso27001,
           (o.req_text ~ '9001')                                              as needs_iso9001,
           (o.req_text ~ '(esquema nacional de seguridad|\mens\M)')           as needs_ens
    from open_t o left join buyer_stats b on b.buyer_nif = o.buyer_nif
    where o.sector_ok or o.kw_hits > 0 or o.sim >= 0.5
  ),
  scored as (
    select k.*,
      -- each line: (points, reason). Reasons with 0 points are still shown.
      array_remove(array[
        case when k.sector_ok then jsonb_build_object('type','ok','points',30,'text','Matches your sector codes')
             else jsonb_build_object('type','warn','points',10,'text','Not in your sector codes (matched by keyword or meaning)') end,
        case when k.sim is null then null
             when k.sim >= 0.55 then jsonb_build_object('type','ok','points',15,
                  'text','Very close to what you do (similarity ' || round(k.sim::numeric, 2) || ')')
             when k.sim >= 0.45 then jsonb_build_object('type','ok','points',8,
                  'text','Similar to what you do (similarity ' || round(k.sim::numeric, 2) || ')')
             when k.sim < 0.30 then jsonb_build_object('type','warn','points',-5,
                  'text','Not much like your usual work (similarity ' || round(k.sim::numeric, 2) || ')') end,
        case when k.kw_hits > 0 then jsonb_build_object('type','ok','points',least(k.kw_hits * 5, 10),
                                     'text','Title mentions your keywords') end,
        case when cardinality(c.regions) = 0 then jsonb_build_object('type','ok','points',10,'text','You work anywhere in Spain')
             when k.region = any(c.regions) then jsonb_build_object('type','ok','points',15,'text','In your region (' || k.region || ')')
             when k.region = 'Nacional' and c.include_national then jsonb_build_object('type','ok','points',10,'text','National contract')
             else jsonb_build_object('type','warn','points',0,'text','Outside your regions (' || coalesce(k.region,'unknown') || ')') end,
        case when c.annual_turnover is null or k.annual_value is null then null
             when c.annual_turnover >= 1.5 * k.annual_value then jsonb_build_object('type','ok','points',15,
                  'text','Turnover covers the usual solvency rule (1.5× annual value ≈ ' || round(1.5 * k.annual_value) || ' €)')
             else jsonb_build_object('type','gap','points',-15,
                  'text','Turnover may be below the usual solvency rule (1.5× annual value ≈ ' || round(1.5 * k.annual_value) || ' €): consider bidding with a partner') end,
        case when k.needs_iso27001 and not ('ISO27001' = any(certs))
               then jsonb_build_object('type','gap','points',-10,'text','Asks for ISO 27001 (you don''t have it)')
             when k.needs_iso27001 then jsonb_build_object('type','ok','points',5,'text','Asks for ISO 27001 (you have it)') end,
        case when k.needs_iso9001 and not ('ISO9001' = any(certs))
               then jsonb_build_object('type','gap','points',-10,'text','Asks for ISO 9001 (you don''t have it)')
             when k.needs_iso9001 then jsonb_build_object('type','ok','points',5,'text','Asks for ISO 9001 (you have it)') end,
        case when k.needs_ens and not (certs && array['ENS_BASICA','ENS_MEDIA','ENS_ALTA'])
               then jsonb_build_object('type','gap','points',-10,'text','Mentions ENS security certification (you don''t have it)')
             when k.needs_ens then jsonb_build_object('type','ok','points',5,'text','Mentions ENS (you have it; check the level)') end,
        case when k.class_codes is null then null
             when cardinality(c.classification_codes) > 0
                  and exists (select 1 from unnest(k.class_codes) rc where classification_covers(c.classification_codes, rc))
               then jsonb_build_object('type','ok','points',5,
                    'text','Your classification covers what it asks (' || array_to_string(k.class_codes, ', ') || ')')
             when c.has_classification or c.classification_status = 'active'
               then jsonb_build_object('type','warn','points',0,
                    'text','Asks for classification ' || array_to_string(k.class_codes, ', ') || ': check yours covers it')
             else jsonb_build_object('type','gap','points',-10,
                    'text','Requires business classification ' || array_to_string(k.class_codes, ', ')) end,
        case when rolece_ok then null
             when c.rolece_status = 'applied' then jsonb_build_object('type','warn','points',0,
                  'text','ROLECE application pending: it must be active by the deadline')
             when c.rolece_status = 'needs_update' then jsonb_build_object('type','warn','points',0,
                  'text','Your ROLECE entry needs updating before you bid')
             else jsonb_build_object('type','warn','points',0,
                  'text','Register in ROLECE: many tenders require it by the deadline') end,
        case when k.dleft >= 10 then jsonb_build_object('type','ok','points',10,'text', k.dleft || ' days to prepare')
             when k.dleft >= 5 then jsonb_build_object('type','warn','points',5,'text','Only ' || k.dleft || ' days left')
             when k.dleft >= 3 then jsonb_build_object('type','warn','points',0,'text','Closes in ' || k.dleft || ' days')
             else jsonb_build_object('type','gap','points',-20,'text','Closes in ' || k.dleft || ' days: probably too late') end,
        case when k.median_bidders is null then null
             when k.median_bidders <= 2 then jsonb_build_object('type','ok','points',10,
                  'text','Low competition at this buyer (median ' || k.median_bidders || case when k.median_bidders = 1 then ' bidder)' else ' bidders)' end)
             when k.median_bidders >= 5 then jsonb_build_object('type','warn','points',0,
                  'text','Crowded at this buyer (median ' || k.median_bidders || ' bidders)')
             else jsonb_build_object('type','ok','points',5,'text','Median ' || k.median_bidders || ' bidders at this buyer') end,
        case when k.solvency_light then jsonb_build_object('type','ok','points',5,
                  'text','Small simplified tender: usually no proof of turnover or experience needed (good for building a track record)')
             when k.procedure_label = 'Abierto simplificado' then jsonb_build_object('type','ok','points',5,
                  'text','Simplified procedure: lighter paperwork') end
      ], null) as reason_list
    from candidates k
  )
  select s.id, s.title, s.buyer_name, s.region, s.budget_no_tax, s.deadline_date, s.dleft::int,
         s.procedure_label, s.it_segment,
         greatest(0, least(100, (select sum((r->>'points')::int) from unnest(s.reason_list) r)))::int,
         to_jsonb(s.reason_list),
         exists (select 1 from tender_extractions e where e.tender_id = s.id),
         s.link
  from scored s
  order by 10 desc, s.deadline_date
  limit p_limit;
end $$;

grant execute on function match_tenders(uuid, int) to authenticated;

-- --------------------------------------------------------------------------
-- 4b. Similar past tenders ("tenders like this one: who won, at what discount").
--     select * from similar_tenders('20602902');
-- --------------------------------------------------------------------------
create or replace function similar_tenders(p_tender text, p_limit int default 10, only_awarded boolean default true)
returns table (tender_id text, title text, buyer_name text, region text, budget_no_tax numeric,
               status text, winner_name text, winner_nif text, award_amount_no_tax numeric,
               discount numeric, received_tenders int, award_date date, similarity real)
language sql stable security invoker
set search_path = public, extensions as $$
  with q as (select embedding from tender_embeddings where tender_id = p_tender),
  near as (
    select e.tender_id, (1 - (e.embedding <=> q.embedding))::real as similarity
    from tender_embeddings e, q
    where e.tender_id <> p_tender
    order by e.embedding <=> q.embedding
    limit p_limit * 5
  )
  select t.id, t.title, t.buyer_name, t.region, t.budget_no_tax, t.status,
         r.winner_name, r.winner_nif, r.award_amount_no_tax,
         case when r.lot_id is null and t.budget_no_tax > 0 and r.award_amount_no_tax > 0
              then round(1 - r.award_amount_no_tax / t.budget_no_tax, 3) end,
         r.received_tenders, r.award_date, n.similarity
  from near n join tenders t on t.id = n.tender_id
  left join lateral (select * from tender_results r where r.tender_id = t.id order by r.lot_id nulls first limit 1) r on true
  where not only_awarded or r.winner_name is not null
  order by n.similarity desc
  limit p_limit
$$;
grant execute on function similar_tenders(text, int, boolean) to authenticated;

-- --------------------------------------------------------------------------
-- 5. Search box: Spanish full-text search over title + buyer, best matches first.
--    select * from search_tenders('mantenimiento web ayuntamiento', true);
-- --------------------------------------------------------------------------
create or replace function search_tenders(q text, only_open boolean default true, p_limit int default 50)
returns table (tender_id text, title text, buyer_name text, region text, status text,
               budget_no_tax numeric, deadline_date date, rank real)
language sql stable security invoker as $$
  select t.id, t.title, t.buyer_name, t.region, t.status, t.budget_no_tax, t.deadline_date,
         ts_rank(t.search, websearch_to_tsquery('spanish', q))
  from tenders t
  where t.search @@ websearch_to_tsquery('spanish', q)
    and (not only_open or (t.status = 'PUB' and t.deadline_date >= current_date))
  order by 8 desc, t.deadline_date nulls last
  limit p_limit
$$;
grant execute on function search_tenders(text, boolean, int) to authenticated;

-- --------------------------------------------------------------------------
-- 6. Competitor profiles: every company that won an IT award in our data.
--    Refreshed by load_supabase.py.
-- --------------------------------------------------------------------------
drop materialized view if exists competitor_stats;
create materialized view competitor_stats as
with w as (
  select r.winner_nif as nif, r.winner_name, r.award_amount_no_tax, r.award_date, r.sme_awarded,
         t.id as tender_id, t.buyer_nif, t.buyer_name, t.region, t.cpv_codes,
         case when t.procedure_label not in ('Negociado sin publicidad', 'Derivado de acuerdo marco',
                                             'Basado en sistema dinámico de adquisición')
                   and r.lot_id is null and t.budget_no_tax > 0 and r.award_amount_no_tax > 0
              then 1 - r.award_amount_no_tax / t.budget_no_tax end as discount
  from tender_results r join tenders t on t.id = r.tender_id
  where r.winner_nif is not null
)
select
  nif,
  mode() within group (order by winner_name)            as name,
  count(*)                                              as awards,          -- per lot
  count(distinct tender_id)                             as tenders_won,
  sum(award_amount_no_tax)                              as total_awarded_no_tax,
  count(distinct buyer_nif)                             as buyers,
  -- flagged SME in most of its awards (a single SME flag is often noise for large firms)
  count(*) filter (where sme_awarded) > count(*) filter (where sme_awarded is false) as is_sme,
  max(award_date)                                       as last_win,
  case when count(discount) filter (where discount between -0.05 and 0.9) >= 3
       then percentile_cont(0.5) within group (order by discount) filter (where discount between -0.05 and 0.9)
  end                                                   as median_discount,  -- null if < 3 awards
  (select array_agg(r2 order by n desc) from (select region as r2, count(*) n from w w2
     where w2.nif = w.nif and region is not null group by region order by n desc limit 3) x) as top_regions,
  (select jsonb_agg(jsonb_build_object('name', bn, 'nif', bnif, 'wins', n) order by n desc)
     from (select max(buyer_name) bn, buyer_nif bnif, count(*) n from w w2 where w2.nif = w.nif
           group by buyer_nif order by n desc limit 5) y)  as top_buyers
from w
group by nif;
create unique index if not exists competitor_stats_nif on competitor_stats (nif);
revoke all on competitor_stats from anon;
grant select on competitor_stats to authenticated;

-- --------------------------------------------------------------------------
-- 6b. Partner finder (needs competitor_stats above): who could bid WITH you? Companies that won tenders most similar
--     in meaning to this one, preferring the same region and wins large enough to
--     prove the experience usually asked for (a past contract >= 70% of the yearly value).
--     select * from partner_candidates('20586307', '<company uuid>');
-- --------------------------------------------------------------------------
create or replace function partner_candidates(p_tender text, p_company uuid default null, p_limit int default 10)
returns table (nif text, name text, similar_wins int, best_similarity real, regions text[], same_region boolean,
               largest_similar_award numeric, covers_experience boolean, total_awards bigint, is_sme boolean,
               last_win date, examples jsonb, reasons text[])
language sql stable security invoker
set search_path = public, extensions as $$
  with target as (
    select t.id, t.region,
           coalesce(t.estimated_value, t.budget_no_tax)
             / greatest(case t.duration_unit when 'ANN' then t.duration when 'MON' then t.duration / 12.0
                                             when 'DAY' then t.duration / 365.0 end, 1) as annual_value,
           e.embedding
    from tenders t join tender_embeddings e on e.tender_id = t.id
    where t.id = p_tender
  ),
  me as (select c.nif from companies c where c.id = p_company),
  near as (
    select e.tender_id, (1 - (e.embedding <=> tg.embedding))::real as sim
    from tender_embeddings e, target tg
    where e.tender_id <> tg.id
    order by e.embedding <=> tg.embedding
    limit 400
  ),
  wins as (
    select r.winner_nif as nif, r.winner_name, n.sim, t.region, t.title, t.buyer_name,
           r.award_amount_no_tax, r.award_date
    from near n join tenders t on t.id = n.tender_id join tender_results r on r.tender_id = t.id
    where n.sim >= 0.6 and r.winner_nif is not null and r.winner_nif !~ '\*'
      and r.winner_nif is distinct from (select nif from me)
  ),
  agg as (
    select w.nif, mode() within group (order by w.winner_name) as name, count(*)::int as similar_wins,
           max(w.sim) as best_similarity, sum(w.sim) as weight,
           array_agg(distinct w.region) filter (where w.region is not null) as regions,
           bool_or(w.region = (select region from target)) as same_region,
           max(w.award_amount_no_tax) as largest_similar_award, max(w.award_date) as last_win,
           (select jsonb_agg(jsonb_build_object('title', x.title, 'buyer', x.buyer_name,
                                                 'amount', x.award_amount_no_tax, 'date', x.award_date) order by x.sim desc)
              from (select * from wins w2 where w2.nif = w.nif order by w2.sim desc limit 3) x) as examples
    from wins w group by w.nif
  )
  select a.nif, a.name, a.similar_wins, a.best_similarity, a.regions, coalesce(a.same_region, false),
         a.largest_similar_award,
         a.largest_similar_award >= 0.7 * (select annual_value from target),
         cs.awards, cs.is_sme, a.last_win, a.examples,
         array_remove(array[
           a.similar_wins || ' similar contract' || case when a.similar_wins > 1 then 's' else '' end || ' won',
           case when a.same_region then 'Works in the same region' end,
           case when a.largest_similar_award >= 0.7 * (select annual_value from target)
                then 'Past win large enough to prove the experience usually required' end,
           case when cs.is_sme then 'SME' end
         ], null)
  from agg a left join competitor_stats cs on cs.nif = a.nif
  order by coalesce(a.same_region, false) desc,
           (a.largest_similar_award >= 0.7 * (select annual_value from target)) desc nulls last,
           -- closeness of their best match first, then a small bonus for repeat wins
           a.best_similarity + 0.05 * ln(1 + a.similar_wins) desc
  limit p_limit
$$;
grant execute on function partner_candidates(text, uuid, int) to authenticated;

-- --------------------------------------------------------------------------
-- 7. Bidder history from full bid results (tender_bids): how each company bids,
--    including the tenders it LOST. Grows as more award reports are read.
-- --------------------------------------------------------------------------
create or replace view bidder_history with (security_invoker = true) as
select
  coalesce(b.bidder_nif, b.bidder_name)                         as bidder_key,
  max(b.bidder_nif)                                             as bidder_nif,
  max(b.bidder_name)                                            as bidder_name,
  count(*)                                                      as bids,
  count(*) filter (where b.status = 'awarded')                  as wins,
  count(*) filter (where b.status = 'excluded')                 as exclusions,
  round(avg(b.rank), 1)                                         as avg_rank,
  round(avg(1 - b.offer_no_tax / nullif(t.budget_no_tax, 0)), 3) as avg_discount,   -- vs. budget
  round(avg(b.tech_score), 2)                                   as avg_tech_score,
  array_agg(distinct b.exclusion_reason) filter (where b.exclusion_reason is not null) as exclusion_reasons
from tender_bids b join tenders t on t.id = b.tender_id
where b.lot_id is null
group by 1;

-- --------------------------------------------------------------------------
-- 8. Demo company for the showcase (owner = null → visible to every signed-in user)
-- --------------------------------------------------------------------------
insert into companies (id, owner, name, description, cpv_prefixes, keywords, regions, include_national,
                       annual_turnover, employees, certifications, has_classification, rolece, max_budget)
values ('00000000-0000-0000-0000-000000000001'::uuid, null, 'Soluciones Marta S.L. (demo)',
        '25-person software company in Valencia: web apps, municipal software, IT maintenance, cloud.',
        array['7221','7222','7223','7224','7226','7250','7251','7260','7240','7241','48'],
        array['software','aplicación','plataforma','web','portal','mantenimiento','cloud','nube','gestión'],
        array['Comunitat Valenciana','Murcia'], true,
        1500000, 25, array['ISO27001'], false, false, 600000)
on conflict (id) do nothing;
