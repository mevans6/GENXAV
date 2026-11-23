import { AsyncLocalStorage } from 'node:async_hooks';
export const requestContext = new AsyncLocalStorage<any>();
export async function cookies() {
  const context = requestContext.getStore();
  if (!context) throw new Error('Missing request context');
  return {
    get(name: string) { const item = context.request.headers.get('cookie')?.split(';').map((v: string) => v.trim()).find((v: string) => v.startsWith(name+'=')); return item ? {value: decodeURIComponent(item.slice(name.length+1))} : undefined; },
    set(name: string, value: string, options: any = {}) {
      let cookie = `${name}=${encodeURIComponent(value)}; Path=${options.path || '/'}; SameSite=${options.sameSite || 'lax'}`;
      if (options.httpOnly) cookie += '; HttpOnly';
      if (options.secure) cookie += '; Secure';
      if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
      context.cookies.push(cookie);
    }
  };
}
