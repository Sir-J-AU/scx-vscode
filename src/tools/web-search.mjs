// Kritical.NodeJS.SCXCodeAgent — web_search tool.
//
// Reads BRAVE_API_KEY | TAVILY_API_KEY | DUCKDUCKGO_API_KEY from the user
// environment (HKCU vars surface as process.env on Windows). If none is present
// it returns a 501-shaped result with a clear operator instruction — it does
// NOT silently fail (brief §7). Uses global fetch (Node >= 20).
//
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026

const UA = 'KriticalSCXCodeAgent/0.1 (+https://kritical.net)';

/** @returns {Promise<{ok:boolean, status?:number, provider?:string, query:string, results?:Array, message?:string}>} */
export async function webSearch({ query, count = 5, fetchImpl = globalThis.fetch } = {}) {
  if (!query) return { ok: false, status: 400, query: '', message: 'web_search: "query" is required.' };

  const brave = process.env.BRAVE_API_KEY;
  const tavily = process.env.TAVILY_API_KEY;
  const ddg = process.env.DUCKDUCKGO_API_KEY;

  try {
    if (brave) {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
      const r = await fetchImpl(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': brave, 'User-Agent': UA } });
      if (!r.ok) return { ok: false, status: r.status, provider: 'brave', query, message: `Brave error ${r.status}` };
      const j = await r.json();
      const results = (j.web?.results || []).slice(0, count).map((x) => ({ title: x.title, url: x.url, snippet: x.description }));
      return { ok: true, provider: 'brave', query, results };
    }
    if (tavily) {
      const r = await fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ api_key: tavily, query, max_results: count }),
      });
      if (!r.ok) return { ok: false, status: r.status, provider: 'tavily', query, message: `Tavily error ${r.status}` };
      const j = await r.json();
      const results = (j.results || []).slice(0, count).map((x) => ({ title: x.title, url: x.url, snippet: x.content }));
      return { ok: true, provider: 'tavily', query, results };
    }
    if (ddg) {
      // DuckDuckGo Instant Answer API (key optional; honoured if operator set one)
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&t=kritical`;
      const r = await fetchImpl(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) return { ok: false, status: r.status, provider: 'duckduckgo', query, message: `DuckDuckGo error ${r.status}` };
      const j = await r.json();
      const results = (j.RelatedTopics || [])
        .filter((x) => x.FirstURL)
        .slice(0, count)
        .map((x) => ({ title: (x.Text || '').slice(0, 80), url: x.FirstURL, snippet: x.Text }));
      return { ok: true, provider: 'duckduckgo', query, results };
    }
  } catch (e) {
    return { ok: false, status: 502, query, message: `web_search upstream failure: ${e.message}` };
  }

  return {
    ok: false,
    status: 501,
    query,
    message:
      'web_search has no provider key. Operator: set one of BRAVE_API_KEY / TAVILY_API_KEY / DUCKDUCKGO_API_KEY ' +
      "in HKCU (e.g. [Environment]::SetEnvironmentVariable('BRAVE_API_KEY','<key>','User')) then restart the daemon.",
  };
}
