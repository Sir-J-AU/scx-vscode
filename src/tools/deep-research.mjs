// Kritical.NodeJS.SCXCodeAgent — deep_research tool.
//
// Orchestrates: web_search -> top N results -> web_fetch each -> SimHash-dedup
// the captured pages -> summarise via autoContinue on SCX (default MiniMax-M2.7).
// Emits per-URL captures to documentation/ai/<date>/web-captures.jsonl (brief
// §Ingest hooks). Uses global fetch; no runtime dependency.
//
// Author: Joshua Finley — Kritical Pty Ltd — (c) 2026

import { webSearch } from './web-search.mjs';
import { webFetch } from './web-fetch.mjs';
import { autoContinue } from '../auto-continue.mjs';
import { simHash64, hammingDistance, emitIngestEvent } from '../hr27.mjs';

/**
 * @returns {Promise<{ok:boolean, status?:number, question:string, sources?:Array, summary?:string, message?:string}>}
 */
export async function deepResearch({
  question,
  maxResults = 5,
  model = 'minimax-m2.7',
  summarise = true,
  fetchImpl = globalThis.fetch,
  autoContinueImpl = autoContinue,
} = {}) {
  if (!question) return { ok: false, status: 400, question: '', message: 'deep_research: "question" is required.' };

  const search = await webSearch({ query: question, count: maxResults, fetchImpl });
  if (!search.ok) return { ok: false, status: search.status || 502, question, message: `deep_research: search failed — ${search.message}` };
  if (!search.results?.length) return { ok: true, question, sources: [], summary: '', message: 'No results.' };

  const captures = [];
  const hashes = [];
  for (const res of search.results) {
    const page = await webFetch({ url: res.url, fetchImpl });
    if (!page.ok || !page.text) continue;
    const h = simHash64(page.text.slice(0, 4000));
    if (hashes.some((prev) => hammingDistance(prev, h) <= 3)) continue; // near-dupe page, skip
    hashes.push(h);
    const capture = { title: page.title || res.title, url: res.url, chars: page.chars, excerpt: page.text.slice(0, 1500) };
    captures.push(capture);
    emitIngestEvent('web-captures', { question, url: res.url, chars: page.chars, engine: page.engine });
  }

  if (!captures.length) return { ok: true, question, sources: [], summary: '', message: 'Search returned results but none were fetchable.' };

  let summary = '';
  if (summarise) {
    const sourceBlock = captures.map((c, i) => `## Source ${i + 1}: ${c.title}\n<${c.url}>\n${c.excerpt}`).join('\n\n');
    const prompt =
      `Synthesise a cited answer to the question below using only the sources. ` +
      `Cite sources as [1], [2]... matching their order. Be concise and factual.\n\n` +
      `QUESTION: ${question}\n\nSOURCES:\n${sourceBlock}`;
    try {
      const r = await autoContinueImpl({ prompt, model, maxContinues: 3, wave: '.5184', fetchImpl });
      summary = r.mergedResponse;
    } catch (e) {
      summary = `(summarisation unavailable: ${e.message})`;
    }
  }

  return {
    ok: true,
    question,
    sources: captures.map(({ title, url, chars }) => ({ title, url, chars })),
    summary,
  };
}
