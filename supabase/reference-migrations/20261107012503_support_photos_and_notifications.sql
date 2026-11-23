create table public.support_photos (
  id uuid primary key,
  visitor_hash text not null,
  case_id uuid references public.support_cases(id) on delete set null,
  storage_path text not null unique,
  bytes integer not null check (bytes between 1 and 3145728),
  width integer not null check (width between 1 and 1600),
  height integer not null check (height between 1 and 1600),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 day'
);
create index support_photos_case on public.support_photos(case_id);
create index support_photos_visitor on public.support_photos(visitor_hash,created_at);
create index support_photos_expiry on public.support_photos(expires_at);
alter table public.support_photos enable row level security;
revoke all on public.support_photos from anon,authenticated;
grant all on public.support_photos to service_role;

create function public.reserve_support_photo(p_id uuid,p_owner text,p_bytes integer,p_width integer,p_height integer) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner,0));
  if (select count(*) from public.support_photos where visitor_hash=p_owner and created_at>now()-interval '1 day') >= 12 then
    raise exception 'Photo upload limit reached';
  end if;
  insert into public.support_photos(id,visitor_hash,storage_path,bytes,width,height)
  values(p_id,p_owner,p_owner||'/'||p_id::text||'.jpg',p_bytes,p_width,p_height);
end; $$;

create function public.attach_support_photos(p_case_id uuid,p_owner text,p_photo_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  perform 1 from public.support_cases where id=p_case_id and visitor_hash=p_owner and payment_status='pending' for update;
  if not found then raise exception 'Request ownership mismatch'; end if;
  if cardinality(p_photo_ids)>6 then raise exception 'Too many photos'; end if;
  perform 1 from public.support_photos where id=any(p_photo_ids) order by id for update;
  select count(*) into n from public.support_photos where id=any(p_photo_ids) and visitor_hash=p_owner and (case_id is null or case_id=p_case_id) and expires_at>now();
  if n<>cardinality(p_photo_ids) then raise exception 'Photo ownership or expiry mismatch'; end if;
  if (select count(*) from public.support_photos where case_id=p_case_id or id=any(p_photo_ids))>6 then raise exception 'Too many photos'; end if;
  update public.support_photos set case_id=p_case_id,expires_at=now()+interval '90 days' where id=any(p_photo_ids);
end; $$;

-- Keep the storage paths until the Storage API has removed the bytes.
create function public.expire_case_photos() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.support_photos set expires_at=now() where case_id=old.id;
  return old;
end; $$;
create trigger expire_case_photos before delete on public.support_cases for each row execute function public.expire_case_photos();

create table public.support_notifications (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  kind text not null check(kind in ('paid_customer','paid_operator','expert_reply','clarification')),
  message_id uuid references public.ticket_messages(id) on delete cascade,
  attempts integer not null default 0,
  retry_after timestamptz not null default now(),
  locked_until timestamptz not null default 'epoch',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique nulls not distinct(case_id,kind,message_id)
);
create index support_notifications_case on public.support_notifications(case_id);
create index support_notifications_message on public.support_notifications(message_id);
create index support_notifications_pending on public.support_notifications(retry_after) where sent_at is null;
alter table public.support_notifications enable row level security;
revoke all on public.support_notifications from anon,authenticated;
grant all on public.support_notifications to service_role;

create function public.claim_support_notifications(p_case_id uuid default null,p_limit integer default 2) returns setof public.support_notifications
language sql security definer set search_path='' as $$
  update public.support_notifications set attempts=attempts+1,locked_until=now()+interval '5 minutes'
  where id in (
    select id from public.support_notifications
    where sent_at is null and retry_after<=now() and locked_until<=now() and (p_case_id is null or case_id=p_case_id)
    order by created_at for update skip locked limit greatest(1,least(p_limit,20))
  ) returning *;
$$;

create or replace function public.fulfill_checkout(p_case_id uuid,p_session_id text,p_amount integer,p_event_id text) returns void language plpgsql security definer set search_path='' as $$
declare c public.support_cases; begin
 select * into c from public.support_cases where id=p_case_id for update;
 if not found or c.stripe_session_id is distinct from p_session_id or p_amount != (case when c.plan='expert' then 2900 else 7900 end) then raise exception 'Payment mismatch'; end if;
 if c.payment_status='refunded' then raise exception 'Refunded request'; end if;
 insert into public.payments(case_id,stripe_session_id,event_id,amount) values(p_case_id,p_session_id,p_event_id,p_amount) on conflict(stripe_session_id) do nothing;
 update public.support_cases set payment_status='paid' where id=p_case_id;
 insert into public.support_notifications(case_id,kind) values(p_case_id,'paid_customer'),(p_case_id,'paid_operator') on conflict do nothing;
 end; $$;

create or replace function public.add_clarification(p_case_id uuid,p_content text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.support_cases; mid uuid; begin
 select * into c from public.support_cases where id=p_case_id for update;
 if not found or c.payment_status!='paid' or c.plan!='expert' or c.status!='answered' or c.clarification_used then return null; end if;
 insert into public.ticket_messages(case_id,role,content) values(p_case_id,'customer',p_content) returning id into mid;
 update public.support_cases set clarification_used=true,status='clarified' where id=p_case_id;
 insert into public.support_notifications(case_id,kind,message_id) values(p_case_id,'clarification',mid);
 return mid; end; $$;

create or replace function public.expert_reply(p_case_id uuid,p_content text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.support_cases; mid uuid; begin
 select * into c from public.support_cases where id=p_case_id for update;
 if not found or c.payment_status!='paid' or c.plan!='expert' or c.status!='open' then return null; end if;
 insert into public.ticket_messages(case_id,role,content) values(p_case_id,'expert',p_content) returning id into mid;
 update public.support_cases set status='answered' where id=p_case_id;
 insert into public.support_notifications(case_id,kind,message_id) values(p_case_id,'expert_reply',mid);
 return mid; end; $$;

revoke execute on function public.reserve_support_photo(uuid,text,integer,integer,integer),public.attach_support_photos(uuid,text,uuid[]),public.expire_case_photos(),public.claim_support_notifications(uuid,integer) from public,anon,authenticated;
grant execute on function public.reserve_support_photo(uuid,text,integer,integer,integer),public.attach_support_photos(uuid,text,uuid[]),public.claim_support_notifications(uuid,integer) to service_role;
update storage.buckets set public=false,file_size_limit=3145728,allowed_mime_types=array['image/jpeg'] where id='support-attachments';
