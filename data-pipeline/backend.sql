-- BidMagnet backend: company profiles, buyer stats, renewal radar, fit score.
-- Run after schema.sql (Supabase → SQL Editor, or psql). Safe to re-run.
-- The frontend calls these directly with supabase-js; see API.md.

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
language plpgsql stable security invoker as $$
#variable_conflict use_column
declare
  c companies%rowtype;
begin
  select * into c from companies where id = p_company;
  if not found then
    raise exception 'company % not found or not yours', p_company;
  end if;

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
           exists (select 1 from tender_requirements q where q.tender_id = t.id and q.kind = 'classification') as needs_class
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
    where o.sector_ok or o.kw_hits > 0
  ),
  scored as (
    select k.*,
      -- each line: (points, reason). Reasons with 0 points are still shown.
      array_remove(array[
        case when k.sector_ok then jsonb_build_object('type','ok','points',30,'text','Matches your sector codes')
             else jsonb_build_object('type','warn','points',10,'text','Only matched by keyword, not sector code') end,
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
                  'text','Turnover may be below the usual solvency rule (1.5× annual value ≈ ' || round(1.5 * k.annual_value) || ' €)') end,
        case when k.needs_iso27001 and not ('ISO27001' = any(c.certifications))
               then jsonb_build_object('type','gap','points',-10,'text','Asks for ISO 27001 (you don''t have it)')
             when k.needs_iso27001 then jsonb_build_object('type','ok','points',5,'text','Asks for ISO 27001 (you have it)') end,
        case when k.needs_iso9001 and not ('ISO9001' = any(c.certifications))
               then jsonb_build_object('type','gap','points',-10,'text','Asks for ISO 9001 (you don''t have it)')
             when k.needs_iso9001 then jsonb_build_object('type','ok','points',5,'text','Asks for ISO 9001 (you have it)') end,
        case when k.needs_ens and not (c.certifications && array['ENS_BASICA','ENS_MEDIA','ENS_ALTA'])
               then jsonb_build_object('type','gap','points',-10,'text','Mentions ENS security certification (you don''t have it)')
             when k.needs_ens then jsonb_build_object('type','ok','points',5,'text','Mentions ENS (you have it; check the level)') end,
        case when k.needs_class and not c.has_classification
               then jsonb_build_object('type','gap','points',-10,'text','Requires business classification') end,
        case when not c.rolece then jsonb_build_object('type','warn','points',0,
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
        case when k.procedure_label = 'Abierto simplificado' then jsonb_build_object('type','ok','points',5,
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
  bool_or(sme_awarded)                                  as is_sme,
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
-- 7. Demo company for the showcase (owner = null → visible to every signed-in user)
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
