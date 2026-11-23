import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {supportConfig} from '../server/lib/server';
const id='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{
 for(const name of ['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','EMAIL_FROM','SUPPORT_NOTIFY_EMAIL','NEXT_PUBLIC_SITE_URL','CALENDLY_API_TOKEN','CALENDLY_RESERVATION_EVENT_TYPE','CALENDLY_WEBHOOK_SIGNING_KEY','STRIPE_WEBHOOK_SECRET','CRON_SECRET'])vi.stubEnv(name,'configured');
 vi.stubEnv('ACCESS_TOKEN_SECRET','x'.repeat(64));vi.stubEnv('POLICIES_APPROVED','true');vi.stubEnv('RESERVATION_AUTOMATION_ENABLED','true');vi.stubEnv('CONSULTATIONS_ENABLED','false');vi.stubEnv('STRIPE_SECRET_KEY','rk_test_fixture');vi.stubEnv('CONSULTATION_SANDBOX_REQUEST_IDS',id);
});
afterEach(()=>vi.unstubAllEnvs());
it('keeps public and unrelated bookings closed during private sandbox testing',()=>{expect(supportConfig().consultationAvailable).toBe(false);expect(supportConfig(crypto.randomUUID()).consultationAvailable).toBe(false);expect(supportConfig(id).consultationAvailable).toBe(true)});
it('never uses the sandbox exception with a live Stripe key',()=>{vi.stubEnv('STRIPE_SECRET_KEY','rk_live_fixture');expect(supportConfig(id).consultationAvailable).toBe(false)});
it('still requires webhook and policy configuration for sandbox requests',()=>{vi.stubEnv('CALENDLY_WEBHOOK_SIGNING_KEY','');expect(supportConfig(id).consultationAvailable).toBe(false)});
