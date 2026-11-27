import {afterAll, beforeAll, describe, expect, it} from 'vitest';
// @ts-expect-error The local preview is plain JavaScript.
import {createPreviewServer} from '../scripts/preview-server.mjs';
let server: any, base: string;
beforeAll(async () => {
  server = await createPreviewServer({directory: '.'});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(resolve)));
const canonical = (html: string) => html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
const robots = (html: string) => html.match(/<meta name="robots" content="([^"]+)"/)?.[1] || '';
const get = (path: string) => fetch(base + path);

describe('public crawl and contact contract over HTTP', () => {
  it.each(['/', '/consulting', '/privacy.html', '/home-automation-troubleshooting-charlotte', '/consulting/av-proposal-review'])('%s is indexable and self canonical', async path => {
    const response = await get(path), html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag') || '').not.toMatch(/noindex/i);
    expect(robots(html)).not.toMatch(/noindex/i);
    expect(canonical(html)).toBe(`https://genxav.com${path}`);
  });
  it.each(['/consulting/terms', '/consulting/refunds'])('%s is excluded with its own canonical', async path => {
    const response = await get(path), html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toMatch(/noindex/i);
    expect(robots(html)).toMatch(/noindex/i);
    expect(canonical(html)).toBe(`https://genxav.com${path}`);
  });
  it.each(['/consulting/admin', '/consulting/invitation/test', '/consulting/ticket/test', '/consulting/complete', '/consulting-shell.html'])('%s stays excluded', async path => {
    const response = await get(path), html = await response.text();
    expect(response.status).toBe(200);
    expect(robots(html)).toMatch(/noindex/i);
    expect(canonical(html)).toBeUndefined();
    if (path.startsWith('/consulting/')) expect(response.headers.get('x-robots-tag')).toMatch(/noindex/i);
  });
  it.each([['/index.html', '/'], ['/consulting.html', '/consulting'], ['/consulting-terms.html', '/consulting/terms'], ['/consulting-refunds.html', '/consulting/refunds'], ['/home-automation-troubleshooting-charlotte.html', '/home-automation-troubleshooting-charlotte'], ['/consulting-av-proposal-review.html', '/consulting/av-proposal-review']])('%s permanently redirects without a loop', async (from, to) => {
    const first = await fetch(base + from + '?source=check', {redirect:'manual'});
    expect(first.status).toBe(308);
    expect(first.headers.get('location')).toBe(to + '?source=check');
    const final = await get(from);
    expect(final.status).toBe(200);
    expect(new URL(final.url).pathname).toBe(to);
  });
  it('robots points to a sitemap containing only canonical indexable pages', async () => {
    const response = await get('/robots.txt');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Sitemap: https://genxav.com/sitemap.xml');
    const sitemap = await get('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    const urls = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    expect(urls).toEqual(['https://genxav.com/', 'https://genxav.com/consulting', 'https://genxav.com/privacy.html', 'https://genxav.com/home-automation-troubleshooting-charlotte', 'https://genxav.com/consulting/av-proposal-review']);
    for (const url of urls) {
      const page = await get(new URL(url).pathname), html = await page.text();
      expect(page.status).toBe(200);
      expect(canonical(html)).toBe(url);
      expect(robots(html) + (page.headers.get('x-robots-tag') || '')).not.toMatch(/noindex/i);
    }
  });
  it('keeps consulting phones consistent in landing, legal and private headers/footers', async () => {
    for (const path of ['/consulting', '/consulting/terms', '/consulting/refunds', '/consulting/admin']) {
      const html = await (await get(path)).text();
      expect(html).not.toContain('+17042477074');
      expect(html).not.toContain('(704) 247-7074');
      expect(html).toContain('Nationwide consulting');
      const calls = [...html.matchAll(/<a\b([^>]*href="tel:([^\"]+)"[^>]*)>([\s\S]*?)<\/a>/g)];
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(call[2]).toBe('+17143126729');
        expect(call[1]).toMatch(/nationwide consulting/i);
        expect(call[1] + call[3]).toContain('(714) 312-6729');
      }
    }
  });
  it.each([
    ['/home-automation-troubleshooting-charlotte', '/', '+17042477074'],
    ['/consulting/av-proposal-review', '/consulting', '+17143126729'],
  ])('%s is a real service page with contextual links and matching schema', async (path, parent, phone) => {
    const html = await (await get(path)).text();
    expect(html).toContain('<h1');
    expect(html).not.toContain('consulting-app.js');
    expect(html).not.toContain('<form');
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(schema['@type']).toBe('Service');
    expect(schema.url).toBe('https://genxav.com' + path);
    expect(schema.provider.telephone).toBe(phone);
    expect(schema.offers).toBeUndefined(); // No flat $99 offer for a custom-quoted detailed review.
    const phones = [...html.matchAll(/href="tel:([^"]+)"/g)].map(m => m[1]);
    expect(phones.length).toBeGreaterThan(1);
    expect(phones.every(p => p === phone)).toBe(true);
    const landing = await (await get(parent)).text();
    const serviceSection = landing.match(/<section[^>]*id="services"[\s\S]*?<\/section>/)![0];
    expect(serviceSection).toContain(`href="${path}"`);
    const menus = landing.match(/<header[\s\S]*?<\/header>/)![0];
    expect(menus).not.toContain(`href="${path}"`);
  });
  it('matches homepage structured phone contacts to visible service labels', async () => {
    const html = await (await get('/')).text();
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(schema.telephone).toBe('+17042477074');
    for (const [label, phone] of [['Charlotte-area system support', '+17042477074'], ['Nationwide consulting', '+17143126729']]) {
      expect(html).toContain(label);
      expect(html).toContain(`href="tel:${phone}"`);
      expect(schema.contactPoint).toContainEqual(expect.objectContaining({contactType:label, telephone:phone}));
    }
  });
});
