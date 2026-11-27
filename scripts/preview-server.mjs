import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Apply this project's checked-in static routing rules during local verification.
// Vercel-only platform behavior (e.g. deployment protection) is not emulated.
export function routeMatches(source, pathname) {
  if (source.endsWith('/(.*)')) return pathname.startsWith(source.slice(0, -4));
  const catchAll = source.match(/^(.*)\/:path([*+])$/);
  if (catchAll) {
    const [, prefix, mode] = catchAll;
    return (mode === '*' && pathname === prefix) ||
      (pathname.startsWith(`${prefix}/`) && (mode === '*' || pathname.length > prefix.length + 1));
  }
  return pathname === source;
}

export async function createPreviewServer({directory = 'dist'} = {}) {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  const types = {'.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.png':'image/png', '.svg':'image/svg+xml', '.txt':'text/plain', '.xml':'application/xml'};
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      for (const rule of config.headers || []) {
        if (routeMatches(rule.source, url.pathname)) for (const {key, value} of rule.headers) res.setHeader(key, value);
      }
      const redirect = (config.redirects || []).find(rule => rule.source === url.pathname);
      const withoutSlash = config.trailingSlash === false && url.pathname.length > 1 && url.pathname.endsWith('/');
      if (redirect || withoutSlash) {
        res.writeHead(redirect?.permanent === false ? 307 : 308, {Location: (redirect?.destination || url.pathname.slice(0, -1)) + url.search});
        return res.end();
      }
      if (url.pathname.startsWith('/api/consulting/')) {
        const {default: consulting} = await import('../api/consulting.js');
        return await consulting(req, res);
      }
      if (url.pathname === '/api/intake') {
        const {default: intake} = await import('../api/intake.js');
        return await intake(req, res);
      }
      // Redirects apply to incoming URLs, not internal rewrite destinations.
      const rewrite = (config.rewrites || []).find(rule => routeMatches(rule.source, url.pathname));
      const file = url.pathname === '/' ? 'index.html' : (rewrite?.destination || url.pathname).slice(1);
      const target = path.resolve(directory, file);
      if (!target.startsWith(`${path.resolve(directory)}/`)) {
        res.statusCode = 403;
        return res.end();
      }
      const body = await readFile(target);
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
}
