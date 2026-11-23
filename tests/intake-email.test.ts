import {beforeEach,describe,it,expect,vi} from 'vitest';
const {database,send,download,updates,files,request}=vi.hoisted(()=>({database:{rpc:vi.fn(),from:vi.fn(),storage:{from:vi.fn()}},send:vi.fn(),download:vi.fn(),updates:[] as any[],files:[] as any[],request:{id:'request-1',name:'Synthetic Customer',email:'customer@example.com',phone:'7042477074',location:'Charlotte, NC',need:'Reviewing an AV proposal',description:'Please review my proposed home technology system.',created_at:'2026-11-22T20:00:00Z',review_status:'new',invitation_hash:null}}));
vi.mock('../server/lib/server',()=>({db:()=>database,email:send,checked:({data,error}:any)=>{if(error)throw Error('Storage failed');return data},HttpError:class extends Error{constructor(public status:number,message:string){super(message)}}}));
import {flushConsultingNotifications} from '../server/lib/consulting';
import {intakeEmailAttachments,intakeEmailText} from '../server/lib/intake-email';
beforeEach(()=>{
 process.env.RESEND_API_KEY='test';process.env.EMAIL_FROM='Gen X AV <intake@example.com>';process.env.SUPPORT_NOTIFY_EMAIL='consulting@genxav.com';process.env.NEXT_PUBLIC_SITE_URL='https://genxav.com';
 updates.length=0;files.length=0;files.push({filename:'proposal.pdf',storage_path:'private/request-1/file-1',bytes:4});
 send.mockReset().mockResolvedValue(undefined);download.mockReset().mockResolvedValue({data:new Blob(['test']),error:null});
 database.rpc.mockReset().mockResolvedValue({data:[{id:'notice-1',request_id:request.id,kind:'owner',attempts:0}],error:null});
 database.storage.from.mockReset().mockReturnValue({download});
 database.from.mockReset().mockImplementation((table:string)=>{const query:any={select:vi.fn(()=>query),eq:vi.fn(()=>query),gt:vi.fn(()=>query),order:vi.fn(async()=>({data:[...files],error:null})),single:vi.fn(async()=>({data:request,error:null})),update:vi.fn((value:any)=>{updates.push(value);return query}),then:(resolve:any)=>Promise.resolve({data:null,error:null}).then(resolve)};return query});
});
describe('consulting email with private attachments',()=>{
 it('emails all intake fields and the actual file with requester reply-to',async()=>{
  expect(await flushConsultingNotifications()).toEqual({sent:1,pending:false});
  expect(send).toHaveBeenCalledWith('consulting@genxav.com','Gen X AV — new request',expect.any(String),'consulting-notice-1',request.email,[{filename:'proposal.pdf',content:Buffer.from('test').toString('base64')}]);
  const body=send.mock.calls[0][2];for(const value of Object.values(request).filter(v=>typeof v==='string'&&v!=='new'))expect(body).toContain(value);
  expect(updates.some(value=>value.sent_at)).toBe(true);expect(download).toHaveBeenCalledWith('private/request-1/file-1');
 });
 it('supports submissions without files',async()=>{files.length=0;await flushConsultingNotifications();expect(send.mock.calls[0][2]).toContain('Attachments: None');expect(send.mock.calls[0][5]).toEqual([])});
 it('does not mark an email sent if a private file cannot be downloaded',async()=>{download.mockResolvedValue({data:null,error:Error('offline')});expect(await flushConsultingNotifications()).toEqual({sent:0,pending:true});expect(send).not.toHaveBeenCalled();expect(updates.some(value=>value.sent_at)).toBe(false);expect(updates.some(value=>value.retry_after)).toBe(true)});
 it('retains a retry when the mail provider rejects the email',async()=>{send.mockRejectedValue(Error('offline'));expect(await flushConsultingNotifications()).toEqual({sent:0,pending:true});expect(updates.some(value=>value.sent_at)).toBe(false)});
 it('refuses inconsistent attachment bytes',async()=>{files[0].bytes=100;await expect(intakeEmailAttachments(request.id)).rejects.toThrow('verified')});
 it('does not fetch files when sending a customer response',async()=>{database.rpc.mockResolvedValue({data:[{id:'notice-2',request_id:request.id,kind:'response',body:'Your response',attempts:0}],error:null});await flushConsultingNotifications();expect(download).not.toHaveBeenCalled();expect(send.mock.calls[0][0]).toBe(request.email);expect(send.mock.calls[0][5]).toEqual([])});
});
