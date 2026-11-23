import { requestContext } from './cookies';
import { fail } from './lib/server';
export function adapt(dispatch: (request: Request) => Promise<Response>) {
  return async (req: any, res: any) => {
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 3400000) {res.statusCode=413; return res.end('Request too large');} chunks.push(chunk); }
      const headers = new Headers();
      for (const [name,value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      const request = new Request(new URL(req.url, origin), {method:req.method,headers,...(!['GET','HEAD'].includes(req.method) ? {body:Buffer.concat(chunks)} : {})});
      const context={request,cookies:[] as string[]};
      const response = await requestContext.run(context, async () => {try {return await dispatch(request);} catch(error) {return fail(error);}});
      res.statusCode=response.status;
      response.headers.forEach((value,name)=>res.setHeader(name,value));
      res.setHeader('Cache-Control','no-store');
      res.setHeader('X-Content-Type-Options','nosniff');
      if (context.cookies.length) res.setHeader('Set-Cookie',context.cookies);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.statusCode=503; res.end(JSON.stringify({error:'Service unavailable. Please try again.'})); }
  };
}
