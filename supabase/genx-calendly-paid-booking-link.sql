-- Applied additively to the existing dedicated consulting database.
-- Keeps new paid Calendly booking links separate from legacy prepaid tickets.
alter table public.consulting_requests
  add column if not exists calendly_booking_url text,
  add column if not exists calendly_booking_pending boolean not null default false;
