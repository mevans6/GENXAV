-- Run after 001_initial.sql. Existing approved entries remain approved.
alter table public.approved_knowledge
  add column status text not null default 'approved'
    check(status in ('draft','approved','archived')),
  add column category text not null default 'General',
  add column updated_at timestamptz not null default now(),
  add column version integer not null default 1,
  add column search_document tsvector generated always as (
    setweight(to_tsvector('english',coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english',coalesce(category,'')), 'B') ||
    setweight(to_tsvector('english',coalesce(redacted_summary,'')), 'C')
  ) stored;
alter table public.approved_knowledge alter column status set default 'draft';
alter table public.approved_knowledge alter column approved_by drop not null;
alter table public.approved_knowledge alter column approved_at drop not null;
alter table public.approved_knowledge alter column approved_at drop default;
alter table public.approved_knowledge add constraint knowledge_approval_required
  check(status <> 'approved' or (approved_by is not null and approved_at is not null));
create index approved_knowledge_search on public.approved_knowledge using gin(search_document)
  where status='approved';

-- Keyword retrieval needs no embedding provider. Drafts and archived entries are excluded.
create function public.search_approved_knowledge(p_query text,p_limit integer default 5)
returns table(id uuid,title text,redacted_summary text,manufacturer_url text,category text)
language sql stable security definer set search_path='' as $$
  with words as (
    select regexp_replace(trim(regexp_replace(left(p_query,1000),'[^[:alnum:] ]',' ','g')),'[[:space:]]+',' OR ','g') as value
  ), query as (
    select websearch_to_tsquery('english',value) as value from words
  )
  select k.id,k.title,left(k.redacted_summary,3000),k.manufacturer_url,k.category
  from public.approved_knowledge k,query q
  where k.status='approved' and k.search_document @@ q.value
  order by ts_rank_cd(k.search_document,q.value) desc,k.updated_at desc
  limit greatest(0,least(coalesce(p_limit,5),5));
$$;
revoke execute on function public.search_approved_knowledge(text,integer) from public,anon,authenticated;
grant execute on function public.search_approved_knowledge(text,integer) to service_role;
-- No public table policies or change feeds are added.
