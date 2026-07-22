// Kritical SCXCode — chat-history compaction.
// Apache 2.0 (c) Kritical Pty Ltd 2026.
//
// Extracted verbatim from extension.ts (JS/TS modularization program, task #13,
// 2026-07-22/23) — the local, pre-send chat-history compaction logic behind the
// `kritical.scxcode.autocompact` setting (off / auto / aggressive). This is pure
// logic: given a message history + a token budget + the autocompact mode, decide
// whether to compact, and if so, fold the older turns into one summary turn.
//
// Deliberately narrow interface: the ORIGINAL compactMessagesForSend() read
// live VS Code config (getConfig()) and looked up the live model context window
// (modelContextTokens()) itself. Both of those are moved to the CALLER
// (extension.ts) so this module has zero dependency on the `vscode` module or
// the filesystem — contextTokens and the two config knobs are passed in. Every
// other line — thresholds, reserve/budget math, keep-count, summary text,
// variable names — is unchanged from the pre-extraction source.

/** Minimal chat-message shape — structurally identical to extension.ts's ScxMessage. */
export interface CompactableMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** The two `getConfig()` knobs the original function read; passed explicitly now. */
export interface CompactionConfig {
  autocompact: 'off' | 'auto' | 'aggressive';
  maxTokens: number;
}

export interface CompactionResult<T extends CompactableMessage> {
  messages: T[];
  compactedTurns: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(String(text || '').length / 4);
}

export function summarizeForCompaction<T extends CompactableMessage>(messages: T[]): string {
  return messages.map((m, i) => {
    const compact = m.content.replace(/\s+/g, ' ').trim().slice(0, 700);
    return `${i + 1}. ${m.role}: ${compact}${m.content.length > 700 ? ' ...' : ''}`;
  }).join('\n');
}

/**
 * Decide whether to compact `history` before sending, and if so, fold the older
 * turns into a single summary user/assistant pair ahead of the most recent turns.
 *
 * @param history       full local chat history (unchanged from caller's array).
 * @param contextTokens the live model's context window (caller resolves this via
 *                      its own modelContextTokens(model) — not this module's concern).
 * @param cfg           { autocompact, maxTokens } — the two getConfig() knobs the
 *                      original function read directly; caller passes them in.
 * @param extraChars    extra characters about to be prepended to the last message
 *                      (auto-context / attachments) — counted toward the estimate.
 */
export function compactMessagesForSend<T extends CompactableMessage>(
  history: T[],
  contextTokens: number,
  cfg: CompactionConfig,
  extraChars = 0,
): CompactionResult<T> {
  if (cfg.autocompact === 'off' || history.length < 9) {
    return { messages: [...history], compactedTurns: 0 };
  }
  const threshold = cfg.autocompact === 'aggressive' ? 0.50 : 0.72;
  const reserve = Math.max(cfg.maxTokens + 1500, 3500);
  const budget = Math.max(4000, Math.floor(contextTokens * threshold) - reserve);
  const estimated = history.reduce((sum, m) => sum + estimateTokens(m.content), 0) + estimateTokens('x'.repeat(extraChars));
  if (estimated <= budget) {
    return { messages: [...history], compactedTurns: 0 };
  }

  const keep = cfg.autocompact === 'aggressive' ? 5 : 7; // odd count keeps user/assistant alternation after summary pair
  const recent = history.slice(-keep);
  const old = history.slice(0, Math.max(0, history.length - keep));
  if (!old.length) {
    return { messages: [...history], compactedTurns: 0 };
  }
  const summary = [
    '## Kritical SCXCode Auto-Context Flush',
    `Compacted ${old.length} earlier turns locally before sending to avoid resending stale full history.`,
    'Preserve decisions, constraints, file names, commands, errors, and current objective from this summary:',
    summarizeForCompaction(old),
  ].join('\n');
  return {
    messages: [
      { role: 'user', content: summary } as T,
      { role: 'assistant', content: 'Acknowledged. I will treat the compacted prior-context summary as the earlier conversation state.' } as T,
      ...recent,
    ],
    compactedTurns: old.length,
  };
}
