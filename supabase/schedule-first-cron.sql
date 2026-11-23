-- Run once after deployment and API/webhook setup. No secrets belong in this file.
-- First add Vault secrets in Supabase Dashboard:
-- genxav_maintenance_url = https://genxav.com/api/consulting/maintenance
-- genxav_cron_secret = the same server-only CRON_SECRET as the website.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
do $$ begin
 if not exists (select 1 from vault.decrypted_secrets where name='genxav_maintenance_url') or
    not exists (select 1 from vault.decrypted_secrets where name='genxav_cron_secret') then
   raise exception 'Configure the Gen X AV URL and cron secret in Vault first';
 end if;
end $$;
select cron.schedule('genxav-consultation-maintenance','*/5 * * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='genxav_maintenance_url'),
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='genxav_cron_secret'),'x-genxav-scheduler','five-minute'),
  body := '{}'::jsonb,timeout_milliseconds := 120000
 );
$job$);
