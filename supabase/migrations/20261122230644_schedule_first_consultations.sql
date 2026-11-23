-- Additive reservation billing. Legacy prepaid support cases remain separate.
alter table public.consulting_requests add column reservation_booking_url text;
alter table public.consulting_requests add column reservation_booking_pending boolean not null default false;
alter table public.consulting_requests add column has_reservation boolean not null default false;

create table public.consulting_reservations (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique references public.consulting_requests(id) on delete restrict,
 invitee_uri text not null unique,event_uri text not null unique,
 starts_at timestamptz not null,timezone text not null default 'America/New_York',
 booked_at timestamptz not null,payment_due_at timestamptz not null,
 appointment_status text not null default 'scheduled' check(appointment_status in ('scheduled','rescheduling','canceling','canceled')),
 payment_status text not null default 'unpaid' check(payment_status in ('unpaid','processing','paid','review','refunded')),
 stripe_session_id text unique,stripe_payment_intent text,checkout_url text,
 paid_at timestamptz,canceled_at timestamptz,cancellation_reason text,
 review_reason text,locked_until timestamptz not null default 'epoch',lock_token uuid,
 next_action_at timestamptz not null default now(),attempts integer not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index consulting_reservations_due on public.consulting_reservations(next_action_at);
create table public.consulting_reservation_events (
 invitee_uri text primary key,event_uri text not null unique,
 reservation_id uuid not null references public.consulting_reservations(id) on delete restrict,
 created_at timestamptz not null default now()
);
create index consulting_reservation_events_parent on public.consulting_reservation_events(reservation_id);
create table public.consulting_reservation_notices (
 id uuid primary key default gen_random_uuid(),reservation_id uuid not null references public.consulting_reservations(id) on delete restrict,
 kind text not null check(kind in ('payment_request','reminder_6h','reminder_11h','paid_customer','paid_operator','canceled_customer','operator_review','rescheduled_customer')),
 delivery_key text not null default '',sent_at timestamptz,created_at timestamptz not null default now(),
 unique(reservation_id,kind,delivery_key)
);
create index consulting_reservation_notices_parent on public.consulting_reservation_notices(reservation_id);
create table public.consulting_automation_health (id boolean primary key default true check(id),last_run_at timestamptz not null);
do $$ declare t text; begin foreach t in array array['consulting_reservations','consulting_reservation_events','consulting_reservation_notices','consulting_automation_health'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop; end $$;

create function public.register_consulting_reservation(p_request_id uuid,p_invitee text,p_event text,p_start timestamptz,p_timezone text,p_booked timestamptz,p_old_invitee text default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.consulting_requests; b public.consulting_reservations; bid uuid;
begin
 select * into r from public.consulting_requests where id=p_request_id for update;
 if not found or r.review_status<>'approved' or r.invitation_hash is null or r.case_id is not null then raise exception 'Request is not eligible'; end if;
 select * into b from public.consulting_reservations where request_id=p_request_id for update;
 if found then
  if exists(select 1 from public.consulting_reservation_events where invitee_uri=p_invitee and reservation_id=b.id) then return b.id; end if;
  if b.locked_until>now() then raise exception 'Reservation busy'; end if;
  if p_old_invitee is null or p_old_invitee<>b.invitee_uri or b.appointment_status in ('canceling','canceled') or b.payment_status in ('review','refunded') then raise exception 'Existing reservation needs review'; end if;
  if p_start<now()+interval '24 hours'-interval '2 minutes' then raise exception 'Insufficient notice'; end if;
  update public.consulting_reservations set invitee_uri=p_invitee,event_uri=p_event,starts_at=p_start,timezone=p_timezone,appointment_status='scheduled',next_action_at=now(),updated_at=now() where id=b.id;
  insert into public.consulting_reservation_events(invitee_uri,event_uri,reservation_id) values(p_invitee,p_event,b.id);
  insert into public.consulting_reservation_notices(reservation_id,kind,delivery_key) values(b.id,'rescheduled_customer',p_invitee) on conflict do nothing;
  return b.id;
 end if;
 if p_start<p_booked+interval '24 hours'-interval '2 minutes' then raise exception 'Insufficient notice'; end if;
 bid=gen_random_uuid();
 insert into public.consulting_reservations(id,request_id,invitee_uri,event_uri,starts_at,timezone,booked_at,payment_due_at)
 values(bid,p_request_id,p_invitee,p_event,p_start,p_timezone,p_booked,now()+interval '12 hours');
 insert into public.consulting_reservation_events(invitee_uri,event_uri,reservation_id) values(p_invitee,p_event,bid);
 update public.consulting_requests set has_reservation=true,updated_at=now() where id=p_request_id;
 insert into public.consulting_reservation_notices(reservation_id,kind) values(bid,'payment_request');
 return bid;
end; $$;

create function public.claim_consulting_reservations(p_id uuid default null,p_limit integer default 10)
returns setof public.consulting_reservations language sql security invoker set search_path='' as $$
 update public.consulting_reservations set locked_until=now()+interval '5 minutes',lock_token=gen_random_uuid(),attempts=attempts+1
 where id in (select id from public.consulting_reservations where (p_id is null or id=p_id) and next_action_at<=now() and locked_until<=now() order by next_action_at for update skip locked limit greatest(1,least(p_limit,20))) returning *;
$$;

create function public.record_consulting_payment(p_id uuid,p_session text,p_intent text,p_amount integer)
returns void language plpgsql security invoker set search_path='' as $$
declare b public.consulting_reservations;
begin
 select * into b from public.consulting_reservations where id=p_id for update;
 if not found or b.stripe_session_id is distinct from p_session or p_amount<>9900 then raise exception 'Payment mismatch'; end if;
 if b.payment_status in ('paid','refunded') then return; end if;
 if b.appointment_status in ('canceling','canceled') or b.payment_status='review' then
  update public.consulting_reservations set payment_status='review',paid_at=coalesce(paid_at,now()),stripe_payment_intent=p_intent,review_reason='Payment received for a reservation requiring review; arrange service or refund.',next_action_at=now(),updated_at=now() where id=p_id;
  insert into public.consulting_reservation_notices(reservation_id,kind) values(p_id,'operator_review') on conflict do nothing;
 else
  update public.consulting_reservations set payment_status='paid',stripe_payment_intent=p_intent,paid_at=now(),next_action_at=now(),updated_at=now() where id=p_id;
  insert into public.consulting_reservation_notices(reservation_id,kind) values(p_id,'paid_customer'),(p_id,'paid_operator') on conflict do nothing;
 end if;
end; $$;

revoke execute on function public.register_consulting_reservation(uuid,text,text,timestamptz,text,timestamptz,text),public.claim_consulting_reservations(uuid,integer),public.record_consulting_payment(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.register_consulting_reservation(uuid,text,text,timestamptz,text,timestamptz,text),public.claim_consulting_reservations(uuid,integer),public.record_consulting_payment(uuid,text,text,integer) to service_role;
