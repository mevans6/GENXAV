-- Applied additively to the existing home-av-rescue project on November 22, 2026.
-- Existing records remain 'legacy'; new Gen X AV submissions explicitly use 'integrator'.
alter table public.inquiries
  add column if not exists lead_category text not null default 'legacy',
  add column if not exists notified_at timestamptz;
create index if not exists inquiries_genx_pending on public.inquiries(created_at)
  where lead_category='integrator' and notified_at is null;
