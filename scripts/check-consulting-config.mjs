// Safe configuration check: prints only names/status, never credential values.
import { existsSync } from 'node:fs';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const required=['NEXT_PUBLIC_SITE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ACCESS_TOKEN_SECRET','RESEND_API_KEY','EMAIL_FROM','SUPPORT_NOTIFY_EMAIL','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','CALENDLY_API_TOKEN','CALENDLY_RESERVATION_EVENT_TYPE','CALENDLY_WEBHOOK_SIGNING_KEY','CRON_SECRET'];
let missing=0;
for(const name of required){const value=process.env[name];const valid=!!value&&(!['ACCESS_TOKEN_SECRET','CRON_SECRET','CALENDLY_WEBHOOK_SIGNING_KEY'].includes(name)||value.length>=32);if(!valid)missing++;console.log(`${name}: ${valid?'set':'MISSING or too short'}`)}
for(const name of ['CONSULTATIONS_ENABLED','POLICIES_APPROVED','RESERVATION_AUTOMATION_ENABLED'])console.log(`${name}: ${process.env[name]==='true'?'enabled':'disabled'}`);
console.log(missing?'Configuration is incomplete; paid appointment automation must stay disabled.':'Required values are present. Verify webhooks, five-minute scheduler heartbeat, and a sandbox booking before enabling.');
process.exitCode=missing?1:0;
