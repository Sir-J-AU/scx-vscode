// Kritical.NodeJS.SCXCodeAgent — web_fetch tool.
//
// Fetches a URL and extracts readable text as markdown-ish plaintext. Uses
// global fetch + a lightweight readability heuristic (strip script/style/nav,
// unwrap tags, collapse whitespace) so it carries NO runtime dependency.
//
// Playwright headless chromium (brief §7) is an OPTIONAL upgrade for
// JS-rendered pages: if @playwright/test is installed AND
// $env:KRIT_AGENT_USE_PLAYWRIGHT=1, we defer to it; otherwise the static fetch
// path is used. Keeping it optional means the daemon installs with zero heavy
// browser downloads by default (HR14-friendly).
//
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026

const UA = 'KriticalSCXCodeAgent/0.1 (+https://kritical.net)';
const MAX_BYTES = 2_000_000;

/** Strip HTML to readable text. Intentionally simple — no dependency. */
export function htmlToText(html) {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n- ');
  s = s.replace(/<h([1-6])[^>]*>/gi, (_, n) => '\n' + '#'.repeat(Number(n)) + ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  // decode the few entities that matter for readability
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/gm, '');
  return s.trim();
}

async function fetchViaPlaywright(url) {
  const { chromium } = await import('@playwright/test'); // only resolved when opted in
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: UA });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

/** @returns {Promise<{ok:boolean, status?:number, url:string, title?:string, text?:string, chars?:number, engine?:string, message?:string}>} */
export async function webFetch({ url, timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, status: 400, url: url || '', message: 'web_fetch: an http(s) "url" is required.' };
  }

  const usePlaywright = process.env.KRIT_AGENT_USE_PLAYWRIGHT === '1';
  try {
    let html;
    if (usePlaywright) {
      html = await fetchViaPlaywright(url);
    } else {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: ctrl.signal });
        if (!r.ok) return { ok: false, status: r.status, url, message: `web_fetch error ${r.status}` };
        const buf = Buffer.from(await r.arrayBuffer()).subarray(0, MAX_BYTES);
        html = buf.toString('utf8');
      } finally {
        clearTimeout(timer);
      }
    }
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? htmlToText(titleMatch[1]).slice(0, 200) : undefined;
    const text = htmlToText(html);
    return { ok: true, url, title, text, chars: text.length, engine: usePlaywright ? 'playwright' : 'static' };
  } catch (e) {
    return { ok: false, status: 502, url, message: `web_fetch failure: ${e.message}` };
  }
}
