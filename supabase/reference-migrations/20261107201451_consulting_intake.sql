-- Additive consulting workflow. Existing paid tickets, knowledge, and accounts remain.
alter table public.support_cases drop constraint support_cases_plan_check;
alter table public.support_cases add constraint support_cases_plan_check check(plan in ('expert','video','consultation'));
alter table public.support_cases add column expected_amount integer check(expected_amount>0);
create table public.consulting_requests (
 id uuid primary key,visitor_hash text not null,name text not null,email text not null,phone text not null default '',location text not null,need text not null,description text not null,
 review_status text not null default 'new' check(review_status in ('new','reviewing','approved','custom_quote_needed','declined','completed')),
 internal_notes text not null default '',invitation_hash text,case_id uuid unique references public.support_cases(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index consulting_requests_created on public.consulting_requests(created_at);
create index consulting_requests_visitor on public.consulting_requests(visitor_hash,created_at);
create table public.consulting_attachments (
 id uuid primary key,visitor_hash text not null,request_id uuid references public.consulting_requests on delete set null,
 storage_path text not null unique,filename text not null,mime text not null check(mime in ('image/jpeg','application/pdf')),bytes integer not null check(bytes between 1 and 3145728),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '1 day'
);
create index consulting_attachments_request on public.consulting_attachments(request_id);
create index consulting_attachments_visitor on public.consulting_attachments(visitor_hash,created_at);
create index consulting_attachments_expiry on public.consulting_attachments(expires_at);
create table public.consulting_quotes (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.consulting_requests on delete cascade,
 service text not null,scope text not null,price_cents integer not null check(price_cents>0 and price_cents<=100000000),
 approval_status text not null default 'pending' check(approval_status in ('pending','approved','declined')),
 payment_status text not null default 'unpaid' check(payment_status in ('unpaid','paid','partially_paid','refunded')),
 project_status text not null default 'proposed' check(project_status in ('proposed','active','completed','canceled')),
 internal_notes text not null default '',created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index consulting_quotes_request on public.consulting_quotes(request_id);
create table public.consulting_notifications (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.consulting_requests on delete cascade,
 kind text not null check(kind in ('owner','invitation','response')),delivery_key text not null,body text not null default '',attempts integer not null default 0,
 retry_after timestamptz not null default now(),locked_until timestamptz not null default 'epoch',sent_at timestamptz,created_at timestamptz not null default now(),unique(request_id,kind,delivery_key)
);
create index consulting_notifications_request on public.consulting_notifications(request_id);
create index consulting_notifications_pending on public.consulting_notifications(retry_after) where sent_at is null;
do $$ declare t text; begin foreach t in array array['consulting_requests','consulting_attachments','consulting_quotes','consulting_notifications'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop; end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('consulting-attachments','consulting-attachments',false,3145728,array['image/jpeg','application/pdf']) on conflict(id) do nothing;
create function public.reserve_consulting_attachment(p_id uuid,p_owner text,p_filename text,p_mime text,p_bytes integer) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner,1));
 if (select count(*) from public.consulting_attachments where visitor_hash=p_owner and created_at>now()-interval '1 day')>=12 then raise exception 'Attachment limit reached'; end if;
 insert into public.consulting_attachments(id,visitor_hash,storage_path,filename,mime,bytes) values(p_id,p_owner,p_owner||'/'||p_id::text,p_filename,p_mime,p_bytes);
end; $$;
create function public.submit_consulting_request(p_id uuid,p_owner text,p_name text,p_email text,p_phone text,p_location text,p_need text,p_description text,p_attachments uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.consulting_requests; n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner,2));
 select * into r from public.consulting_requests where id=p_id;
 if found then
  if r.visitor_hash<>p_owner or r.name<>p_name or r.email<>p_email or r.description<>p_description or r.need<>p_need or r.location<>p_location or r.phone<>p_phone then raise exception 'Request changed'; end if;
  return r.id;
 end if;
 if (select count(*) from public.consulting_requests where visitor_hash=p_owner and created_at>now()-interval '1 day')>=5 then raise exception 'Request limit reached'; end if;
 if cardinality(p_attachments)>6 then raise exception 'Too many attachments'; end if;
 perform 1 from public.consulting_attachments where id=any(p_attachments) order by id for update;
 select count(*) into n from public.consulting_attachments where id=any(p_attachments) and visitor_hash=p_owner and request_id is null and expires_at>now();
 if n<>cardinality(p_attachments) then raise exception 'Attachment ownership mismatch'; end if;
 insert into public.consulting_requests(id,visitor_hash,name,email,phone,location,need,description) values(p_id,p_owner,p_name,p_email,p_phone,p_location,p_need,p_description);
 update public.consulting_attachments set request_id=p_id,expires_at=now()+interval '90 days' where id=any(p_attachments);
 insert into public.consulting_notifications(request_id,kind,delivery_key) values(p_id,'owner','submission');
 return p_id;
end; $$;
create function public.prepare_consultation(p_id uuid,p_owner text,p_case_id uuid,p_ticket_hash text,p_amount integer) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.consulting_requests; c public.support_cases; cid uuid;
begin
 select * into r from public.consulting_requests where id=p_id for update;
 if not found or r.review_status<>'approved' or r.invitation_hash is null then raise exception 'Consultation has not been approved'; end if;
 if r.case_id is not null then
  select * into c from public.support_cases where id=r.case_id;
  if c.payment_status='refunded' then raise exception 'Contact the consultant after a refund'; end if;
  if c.payment_status='pending' then update public.support_cases set visitor_hash=p_owner where id=c.id; end if;
  return c.id;
 end if;
 -- The server supplies a pre-generated case id and matching access hash.
 cid=p_case_id;
 insert into public.support_cases(id,visitor_hash,plan,name,email,issue,equipment,summary,token_hash,expected_amount)
 values(cid,p_owner,'consultation',r.name,r.email,r.description,'Location: '||r.location,'Request: '||r.need||E'\nOriginal intake: '||r.id::text,p_ticket_hash,p_amount);
 update public.consulting_requests set case_id=cid,updated_at=now() where id=p_id;
 return cid;
end; $$;
create function public.claim_consulting_notifications(p_limit integer default 5) returns setof public.consulting_notifications language sql security definer set search_path='' as $$
 update public.consulting_notifications set attempts=attempts+1,locked_until=now()+interval '5 minutes' where id in
 (select id from public.consulting_notifications where sent_at is null and retry_after<=now() and locked_until<=now() order by created_at for update skip locked limit greatest(1,least(p_limit,20))) returning *;
$$;
create function public.expire_consulting_attachments() returns trigger language plpgsql security definer set search_path='' as $$ begin
 update public.consulting_attachments set expires_at=now() where request_id=old.id; return old;
end; $$;
create trigger expire_consulting_attachments before delete on public.consulting_requests for each row execute function public.expire_consulting_attachments();
create or replace function public.fulfill_checkout(p_case_id uuid,p_session_id text,p_amount integer,p_event_id text) returns void language plpgsql security definer set search_path='' as $$
declare c public.support_cases; begin
 select * into c from public.support_cases where id=p_case_id for update;
 if not found or c.stripe_session_id is distinct from p_session_id or p_amount<>coalesce(c.expected_amount,case when c.plan='expert' then 2900 when c.plan='video' then 7900 else -1 end) then raise exception 'Payment mismatch'; end if;
 if c.payment_status='refunded' then raise exception 'Refunded request'; end if;
 insert into public.payments(case_id,stripe_session_id,event_id,amount) values(p_case_id,p_session_id,p_event_id,p_amount) on conflict(stripe_session_id) do nothing;
 update public.support_cases set payment_status='paid' where id=p_case_id;
 insert into public.support_notifications(case_id,kind) values(p_case_id,'paid_customer'),(p_case_id,'paid_operator') on conflict do nothing;
end; $$;
revoke execute on function public.reserve_consulting_attachment(uuid,text,text,text,integer),public.submit_consulting_request(uuid,text,text,text,text,text,text,text,uuid[]),public.prepare_consultation(uuid,text,uuid,text,integer),public.claim_consulting_notifications(integer),public.expire_consulting_attachments() from public,anon,authenticated;
grant execute on function public.reserve_consulting_attachment(uuid,text,text,text,integer),public.submit_consulting_request(uuid,text,text,text,text,text,text,text,uuid[]),public.prepare_consultation(uuid,text,uuid,text,integer),public.claim_consulting_notifications(integer) to service_role;
