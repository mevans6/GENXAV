import {describe,it,expect} from 'vitest';
import {Readable} from 'node:stream';
import {adapt} from '../server/adapter';
import {cookies} from '../server/cookies';
it('preserves raw webhook bytes and writes separate scoped HttpOnly cookies',async()=>{
 const raw='{ "raw": true }';const req:any=Readable.from([Buffer.from(raw)]);req.url='/api/consulting/webhooks/stripe';req.method='POST';req.headers={'content-type':'application/json',cookie:'test=original'};
 const headers:any={};let bytes:Buffer|undefined;const res:any={setHeader:(k:string,v:any)=>headers[k]=v,end:(b:Buffer)=>bytes=b};
 await adapt(async r=>{expect(await r.text()).toBe(raw);const jar=await cookies();expect(jar.get('test')?.value).toBe('original');jar.set('one','a',{httpOnly:true,secure:true,path:'/api/consulting'});jar.set('two','b',{httpOnly:true});return Response.json({ok:true})})(req,res);
 expect(headers['Set-Cookie']).toHaveLength(2);expect(headers['Set-Cookie'][0]).toContain('HttpOnly');expect(headers['Set-Cookie'][0]).toContain('Path=/api/consulting');expect(headers['Cache-Control']).toBe('no-store');expect(JSON.parse(bytes!.toString())).toEqual({ok:true});
});
