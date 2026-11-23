-- Apply once in a new Supabase project's SQL Editor. Server routes alone use the service role.
create table public.conversations(id uuid primary key default gen_random_uuid(),visitor_hash text not null,category text not null,created_at timestamptz not null default now());
create table public.messages(id uuid primary key default gen_random_uuid(),seq bigint generated always as identity,conversation_id uuid not null references public.conversations on delete cascade,role text not null check(role in ('user','assistant')),content text not null,created_at timestamptz not null default clock_timestamp());
create index messages_conversation on public.messages(conversation_id,seq);
create index conversations_owner on public.conversations(visitor_hash);
create table public.support_cases(id uuid primary key,visitor_hash text not null,plan text not null check(plan in ('expert','video')),name text not null,email text not null,issue text not null,equipment text not null default '',summary text not null default '',token_hash text not null,payment_status text not null default 'pending' check(payment_status in ('pending','paid','refunded')),stripe_session_id text unique,status text not null default 'open' check(status in ('open','answered','clarified','closed')),clarification_used boolean not null default false,booking_url text,booking_pending boolean not null default false,notified_at timestamptz,created_at timestamptz not null default now());
create table public.ticket_messages(id uuid primary key default gen_random_uuid(),seq bigint generated always as identity,case_id uuid not null references public.support_cases on delete cascade,role text not null check(role in ('expert','customer')),content text not null,created_at timestamptz not null default clock_timestamp());
create table public.payments(id uuid primary key default gen_random_uuid(),case_id uuid references public.support_cases on delete set null,stripe_session_id text not null unique,event_id text not null unique,amount integer not null,currency text not null default 'usd',created_at timestamptz not null default now());
create view public.tickets with(security_invoker=true) as select id,plan,name,issue,status,created_at from public.support_cases where payment_status='paid';
create table public.guides(slug text primary key,category text not null,title text not null,description text not null,minutes integer not null check(minutes between 1 and 60),steps jsonb not null,warning text not null,source text not null,published boolean not null default false,updated_at timestamptz not null default now());
create table public.inquiries(id uuid primary key default gen_random_uuid(),name text not null,email text not null,message text not null,created_at timestamptz not null default now());
create table public.approved_knowledge(id uuid primary key default gen_random_uuid(),title text not null,redacted_summary text not null,manufacturer_url text,approved_by uuid not null references auth.users,approved_at timestamptz not null default now());
create table public.rate_limits(key text primary key,count integer not null,expires_at timestamptz not null);
create function public.consume_rate_limit(p_key text,p_limit integer,p_window integer) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; begin
 insert into public.rate_limits as r(key,count,expires_at) values(p_key,1,now()+make_interval(secs=>p_window))
 on conflict(key) do update set count=case when r.expires_at<now() then 1 else r.count+1 end,expires_at=case when r.expires_at<now() then now()+make_interval(secs=>p_window) else r.expires_at end returning count into n;
 return n<=p_limit; end; $$;
create function public.fulfill_checkout(p_case_id uuid,p_session_id text,p_amount integer,p_event_id text) returns void language plpgsql security definer set search_path='' as $$
declare c public.support_cases; begin
 select * into c from public.support_cases where id=p_case_id for update;
 if not found or c.stripe_session_id is distinct from p_session_id or p_amount != (case when c.plan='expert' then 2900 else 7900 end) then raise exception 'Payment mismatch'; end if;
 if c.payment_status='refunded' then raise exception 'Refunded request'; end if;
 insert into public.payments(case_id,stripe_session_id,event_id,amount) values(p_case_id,p_session_id,p_event_id,p_amount) on conflict(stripe_session_id) do nothing;
 update public.support_cases set payment_status='paid' where id=p_case_id;
 end; $$;
create function public.add_clarification(p_case_id uuid,p_content text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.support_cases; mid uuid; begin
 select * into c from public.support_cases where id=p_case_id for update;
 if not found or c.payment_status!='paid' or c.plan!='expert' or c.status!='answered' or c.clarification_used then return null; end if;
 insert into public.ticket_messages(case_id,role,content) values(p_case_id,'customer',p_content) returning id into mid;
 update public.support_cases set clarification_used=true,status='clarified' where id=p_case_id;
 return mid; end; $$;
create function public.expert_reply(p_case_id uuid,p_content text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.support_cases; mid uuid; begin
 select * into c from public.support_cases where id=p_case_id for update;
 if not found or c.payment_status!='paid' or c.plan!='expert' or c.status!='open' then return null; end if;
 insert into public.ticket_messages(case_id,role,content) values(p_case_id,'expert',p_content) returning id into mid;
 update public.support_cases set status='answered' where id=p_case_id; return mid; end; $$;
create function public.purge_expired() returns void language plpgsql security definer set search_path='' as $$ begin
 delete from public.conversations where created_at<now()-interval '30 days';
 delete from public.support_cases where created_at<now()-interval '90 days' or (payment_status='pending' and created_at<now()-interval '1 day');
 delete from public.inquiries where created_at<now()-interval '90 days';
 delete from public.rate_limits where expires_at<now();
 end; $$;
do $$ declare t text; begin foreach t in array array['conversations','messages','support_cases','ticket_messages','payments','guides','inquiries','approved_knowledge','rate_limits'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop; end $$;
grant usage on schema public to service_role;
grant usage,select on sequence public.messages_seq_seq,public.ticket_messages_seq_seq to service_role;
grant select on public.tickets to service_role;
revoke all on public.tickets from anon,authenticated;
revoke execute on function public.consume_rate_limit(text,integer,integer),public.fulfill_checkout(uuid,text,integer,text),public.add_clarification(uuid,text),public.expert_reply(uuid,text),public.purge_expired() from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer),public.fulfill_checkout(uuid,text,integer,text),public.add_clarification(uuid,text),public.expert_reply(uuid,text),public.purge_expired() to service_role;
-- Private storage reserved for a later explicit upload flow. No browser policies are granted.
insert into storage.buckets(id,name,public) values('support-attachments','support-attachments',false) on conflict(id) do nothing;
-- No public Realtime publication: support tickets are fetched only after capability authorization.
