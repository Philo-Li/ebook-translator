export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'qwen'
  | 'glm'
  | 'kimi'
  | 'openrouter'
  | 'opencode'
  | 'custom';

export interface ModelOption {
  id: string;
  label: string;
  hint?: string;
  /** True if the model accepts image input on its standard chat endpoint. */
  vision?: boolean;
}

// OpenCode and "custom" endpoints usually don't send CORS headers, so they can be routed
// through a tiny Cloudflare Worker (see worker/) that validates X-Upstream-URL and forwards
// the request verbatim. Set VITE_LLM_PROXY_URL to your deployed worker; when it is unset the
// browser calls the upstream directly, which only works if that upstream allows CORS.
const LLM_PROXY_ENDPOINT = (import.meta.env.VITE_LLM_PROXY_URL ?? '').trim();
const PROXIED_PROVIDERS = new Set<ProviderId>(['custom', 'opencode']);

/** True when the provider should go through the configured proxy. */
function useProxy(provider: ProviderId): boolean {
  return LLM_PROXY_ENDPOINT !== '' && PROXIED_PROVIDERS.has(provider);
}

/** API shape — most providers expose an OpenAI-compatible /chat/completions endpoint. */
export type ApiShape = 'openai-compat' | 'anthropic' | 'gemini';

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  models: ModelOption[];
  /** URL where the user can get an API key. */
  keyHelp: string;
  api: ApiShape;
  /** Full chat-completions endpoint URL (for `openai-compat` only). */
  endpoint?: string;
  /** Default model ID for new users. Falls back to `models[0].id` if unset. */
  defaultModel?: string;
}

export const PROVIDERS: ProviderConfig[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    api: 'gemini',
    keyHelp: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3.5-flash-lite',
    models: [
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', hint: 'newest, fast', vision: true },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', hint: 'cheapest', vision: true },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', hint: 'balanced', vision: true },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)', hint: 'best quality', vision: true },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'legacy, balanced', vision: true },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', hint: 'legacy, cheapest', vision: true },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    api: 'openai-compat',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    keyHelp: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', hint: 'cheapest, fast', vision: true },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', hint: 'balanced', vision: true },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', hint: 'best quality', vision: true },
      { id: 'gpt-5.5', label: 'GPT-5.5', hint: 'legacy flagship', vision: true },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    api: 'anthropic',
    keyHelp: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: 'cheapest, fast', vision: true },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', hint: 'higher quality', vision: true },
      { id: 'claude-opus-5', label: 'Claude Opus 5', hint: 'best quality', vision: true },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    api: 'openai-compat',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    keyHelp: 'https://platform.deepseek.com/api_keys',
    models: [
      // V4 chat IDs are text-only; vision lives on a separate VL track.
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', hint: 'cheapest, fast' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', hint: 'best quality' },
    ],
  },
  {
    id: 'qwen',
    label: 'Qwen 通义千问',
    api: 'openai-compat',
    // China region (DashScope). Mainland keys / mainland users.
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    keyHelp: 'https://bailian.console.aliyun.com/?apiKey=1',
    // Qwen text chat line is text-only on DashScope; image input requires the qwen3-vl-* IDs below.
    models: [
      { id: 'qwen3.6-flash', label: 'Qwen 3.6 Flash', hint: 'cheapest, fast' },
      { id: 'qwen3.7-plus', label: 'Qwen 3.7 Plus', hint: 'balanced' },
      { id: 'qwen3.7-max', label: 'Qwen 3.7 Max', hint: 'best quality' },
      { id: 'qwen3-vl-flash', label: 'Qwen3-VL Flash', hint: 'vision, fast', vision: true },
      { id: 'qwen3-vl-plus', label: 'Qwen3-VL Plus', hint: 'vision, balanced', vision: true },
    ],
  },
  {
    id: 'glm',
    label: 'Zhipu GLM (智谱)',
    api: 'openai-compat',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    keyHelp: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    // GLM chat line is text-only; vision lives on the *V suffix variants.
    models: [
      { id: 'glm-4.7-flash', label: 'GLM-4.7 Flash', hint: 'free tier, fast' },
      { id: 'glm-5.2', label: 'GLM-5.2', hint: 'best quality' },
      { id: 'glm-5.1', label: 'GLM-5.1', hint: 'previous flagship' },
      { id: 'glm-4.6v', label: 'GLM-4.6V', hint: 'vision, balanced', vision: true },
      { id: 'glm-5v-turbo', label: 'GLM-5V Turbo', hint: 'vision, best quality', vision: true },
    ],
  },
  {
    id: 'kimi',
    label: 'Moonshot Kimi',
    api: 'openai-compat',
    endpoint: 'https://api.moonshot.ai/v1/chat/completions',
    keyHelp: 'https://platform.moonshot.ai/console/api-keys',
    models: [
      { id: 'kimi-k3', label: 'Kimi K3', hint: 'best quality', vision: true },
      { id: 'kimi-k2.6', label: 'Kimi K2.6', hint: 'balanced', vision: true },
      { id: 'moonshot-v1-128k', label: 'Moonshot v1 128K', hint: 'long context, stable' },
      { id: 'moonshot-v1-128k-vision-preview', label: 'Moonshot v1 128K Vision (preview)', hint: 'vision, long context', vision: true },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    api: 'openai-compat',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    keyHelp: 'https://openrouter.ai/settings/keys',
    /** User types any model ID (e.g. google/gemini-2.5-flash). */
    models: [{ id: 'openrouter', label: 'openrouter' }],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    api: 'openai-compat',
    endpoint: 'https://opencode.ai/zen/go/v1/chat/completions',
    keyHelp: 'https://opencode.ai/docs/go/',
    models: [{ id: 'opencode', label: 'opencode' }],
  },
];

/** Sentinel config for "Custom (OpenAI-compatible)". */
const CUSTOM_PROVIDER: ProviderConfig = {
  id: 'custom',
  label: 'Custom (OpenAI-compatible)',
  api: 'openai-compat',
  keyHelp: '',
  endpoint: '',          // filled at call-time from user input
  models: [{ id: 'custom', label: 'custom' }],
};

export function findProvider(id: ProviderId): ProviderConfig {
  if (id === 'custom') return CUSTOM_PROVIDER;
  const p = PROVIDERS.find(x => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

/** Default model ID for a provider — explicit `defaultModel` wins, otherwise first listed. */
export function defaultModelFor(cfg: ProviderConfig): string {
  if (cfg.defaultModel && cfg.models.some(m => m.id === cfg.defaultModel)) return cfg.defaultModel;
  return cfg.models[0].id;
}

/** Providers where the user types a free-text model ID — we can't statically know vision support. */
const FREE_TEXT_MODEL_PROVIDERS = new Set<ProviderId>(['openrouter', 'opencode', 'custom']);

/**
 * Returns true if we know the (provider, modelId) pair accepts image input.
 * Free-text providers (OpenRouter / OpenCode / Custom) return true unconditionally — the user
 * picked the model ID themselves, so we trust them and surface any backend error at call time.
 */
export function modelSupportsVision(provider: ProviderId, modelId: string): boolean {
  if (FREE_TEXT_MODEL_PROVIDERS.has(provider)) return true;
  const cfg = findProvider(provider);
  return cfg.models.some(m => m.id === modelId && m.vision === true);
}

/** Vision-capable model IDs for a provider — used to suggest a switch when the current model is text-only. */
export function visionModelsForProvider(provider: ProviderId): ModelOption[] {
  const cfg = findProvider(provider);
  return cfg.models.filter(m => m.vision === true);
}

export interface ToneOption {
  id: string;
  label: string;
  hint?: string;
  /** Style instruction injected into the system prompt. */
  guidance: string;
  /** Sampling temperature passed to the model. Higher = more creative. */
  temperature: number;
}

export const TONES: ToneOption[] = [
  {
    id: 'idiomatic',
    label: 'Idiomatic',
    hint: 'natural & fluent — most books',
    temperature: 0.8,
    guidance: `Translate freely and idiomatically. Your goal is prose that reads as if a native speaker wrote it from scratch — NOT a translation that preserves the source sentence structure.

Specifically:
- Re-craft each sentence in the target language. Reorder, split, or merge sentences when it sounds more natural.
- Translate the MEANING and FEELING, not the words. If a literal translation would feel awkward or foreign, choose an idiomatic native expression that carries the same emotional weight.
- Replace source-language idioms, metaphors, and cultural references with target-language equivalents the reader will instinctively understand.
- Prefer vivid, specific, native vocabulary over neutral dictionary words.
- Match the original's emotional register precisely (warm stays warm, dry stays dry, urgent stays urgent), but express it in the target language's natural way of conveying that register.

Avoid: stiff word-for-word renderings, awkward calques, "translation-ese", overly formal phrasing where the original is casual.

Best for non-fiction, business, popular science, essays, blog posts, light fiction, and most casual reading.`,
  },
  {
    id: 'literary',
    label: 'Literary',
    hint: 'novels & literary works',
    temperature: 0.7,
    guidance: 'Translate with literary care for novels, essays, memoirs, and poetry. Preserve the author\'s voice, style, rhythm, metaphors, and figurative language. Read like a polished published translation by a careful human translator — not a mechanical or paraphrased one. Where the source uses a distinctive image, find a target-language image of equivalent power; do not flatten it into plain prose.',
  },
  {
    id: 'technical',
    label: 'Technical',
    hint: 'professional & reference books',
    temperature: 0.2,
    guidance: 'Translate professional, technical, or reference books (programming, science, textbooks, academic). Prioritize accuracy and precision over flow. Use the conventional target-language form for technical terminology (e.g., "callback" → "回调"). Keep code, formulas, identifiers, product names, and proper nouns in their original form unless an established translation exists. Translate sentence-by-sentence faithfully — do not paraphrase or restructure for stylistic reasons.',
  },
];

export function findTone(id: string): ToneOption {
  return TONES.find(t => t.id === id) ?? TONES[0];
}

export interface GlossaryTerm {
  source: string;
  target: string;
  /** Optional clarifier shown to the LLM (e.g. disambiguating context). */
  note?: string;
}

export interface TranslateOptions {
  provider: ProviderId;
  model: string;
  apiKey: string;
  sourceLang: string;
  targetLang: string;
  /** One of TONES[].id; defaults to 'literary' if missing/unknown. */
  tone?: string;
  signal?: AbortSignal;
  /** Override endpoint URL — used by the "custom" provider. */
  customEndpoint?: string;
  /**
   * User-supplied terminology overrides. Only entries whose `source` appears in
   * the current batch's passages are injected into the system prompt — keeps the
   * prompt short on long books with large glossaries.
   */
  glossary?: GlossaryTerm[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if a glossary source term is safe to match with `\b` word boundaries. */
function isWordBoundarySafe(s: string): boolean {
  // Latin/Greek/Cyrillic scripts have word boundaries; CJK and others don't.
  // We approximate "alphabetic script" as ASCII letters + a few separators.
  return /^[A-Za-z0-9][A-Za-z0-9\s\-_'']*$/.test(s);
}

/**
 * Find glossary entries whose `source` appears anywhere in `passages`. Case-insensitive.
 * Returned entries are sorted by source length descending so the prompt lists more specific
 * terms before generic ones (helps the LLM apply the longest match).
 */
export function matchGlossary(passages: string[], glossary: GlossaryTerm[] | undefined): GlossaryTerm[] {
  if (!glossary || glossary.length === 0) return [];
  const haystack = passages.join('\n');
  const hits: GlossaryTerm[] = [];
  for (const entry of glossary) {
    const src = entry.source.trim();
    if (!src || !entry.target.trim()) continue;
    const pattern = isWordBoundarySafe(src)
      ? new RegExp(`\\b${escapeRegex(src)}\\b`, 'i')
      : new RegExp(escapeRegex(src), 'i');
    if (pattern.test(haystack)) hits.push(entry);
  }
  hits.sort((a, b) => b.source.length - a.source.length);
  return hits;
}

const SYSTEM_PROMPT = (passages: string[], opts: TranslateOptions): string => {
  const tone = findTone(opts.tone ?? 'literary');
  const hits = matchGlossary(passages, opts.glossary);
  const glossaryBlock = hits.length === 0
    ? ''
    : `\n\nGlossary — when the source contains any of the following terms, translate them EXACTLY as specified. These overrides take precedence over your own word choice:\n${hits
        .map(h => `- "${h.source}" → "${h.target}"${h.note ? ` (${h.note})` : ''}`)
        .join('\n')}\n`;
  return `You are a professional translator. Translate the user's text from ${opts.sourceLang} into ${opts.targetLang}.

Style: ${tone.guidance}
${glossaryBlock}
Rules:
- Output ONLY the translation. No explanations, no notes, no quotes around it.
- Preserve paragraph breaks exactly as in the input.
- Keep proper nouns and code/markup as-is unless idiomatic to translate.
- CRITICAL: tokens like \`⟦M0⟧\`, \`⟦M1⟧\`, \`⟦M12⟧\` are placeholders for math formulas, code, or images. Copy them VERBATIM into the translation at semantically appropriate positions. Never alter, translate, renumber, or remove them. They must appear in the output exactly the same number of times as in the input.
- The user will provide numbered passages. Reply with the SAME numbering, one translation per line, in the same order.

Input format:
[1] First passage.
[2] Second passage.

Output format (exact):
[1] Translation of the first passage.
[2] Translation of the second passage.`;
};

function buildBatchPrompt(passages: string[]): string {
  return passages.map((text, i) => `[${i + 1}] ${text}`).join('\n\n');
}

function stripReasoningBlocks(s: string): string {
  // Reasoning models (Nemotron, DeepSeek-R1, QwQ, etc.) often emit a
  // <think>/<thinking>/<reasoning> block inline in message.content where they
  // rehearse the output format — including [N] markers — which would otherwise
  // confuse the batch parser. Drop closed blocks first, then any unclosed
  // trailing block (truncated reasoning).
  return s
    .replace(/<(think(?:ing)?|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(think(?:ing)?|reasoning)\b[^>]*>[\s\S]*$/gi, '');
}

function parseBatchResponse(response: string, expectedCount: number): string[] {
  const cleaned = stripReasoningBlocks(response);
  const out: string[] = new Array(expectedCount).fill('');
  // Match "[N] ..." up to the next "[N+1]" or end of string.
  const pattern = /\[(\d+)\]\s*([\s\S]*?)(?=\n\s*\[\d+\]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(cleaned)) !== null) {
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < expectedCount) {
      out[idx] = m[2].trim();
    }
  }
  return out;
}

function extractErrorMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return 'Empty error response';
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: string | { message?: string; error?: { message?: string } };
      message?: string;
      type?: string;
    };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error && typeof parsed.error === 'object') {
      if (typeof parsed.error.message === 'string') return parsed.error.message;
      if (parsed.error.error && typeof parsed.error.error.message === 'string') return parsed.error.error.message;
    }
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // Fall through to plain-text handling.
  }
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

/**
 * Generic OpenAI-compatible chat-completions caller. Used by OpenAI, DeepSeek,
 * Qwen, GLM, Kimi — all expose the same /chat/completions schema.
 */
async function callOpenAICompat(
  passages: string[],
  opts: TranslateOptions,
  endpoint: string,
  providerLabel: string,
  extraHeaders?: Record<string, string>,
): Promise<string[]> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
      ...extraHeaders,
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      temperature: findTone(opts.tone ?? '').temperature,
      // OpenAI's GPT-5 / o-series reasoning models reject `max_tokens` and require
      // `max_completion_tokens`; their older models accept both. Other openai-compat
      // providers (DeepSeek, Qwen, GLM, Kimi, ...) still only know `max_tokens`.
      ...(opts.provider === 'openai'
        ? { max_completion_tokens: 16384 }
        : { max_tokens: 16384 }),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT(passages, opts) },
        { role: 'user', content: buildBatchPrompt(passages) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${providerLabel} ${res.status}: ${extractErrorMessage(await res.text())}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return parseBatchResponse(text, passages.length);
}

// Claude Sonnet 5 / Opus 5 (and Opus 4.7+) removed `temperature` — sending a
// non-default value returns a 400. Only these older families still accept it.
function anthropicAcceptsTemperature(model: string): boolean {
  return /^claude-(haiku|3|sonnet-4|opus-4-[0-6])/.test(model);
}

async function callAnthropic(
  passages: string[],
  opts: TranslateOptions,
): Promise<string[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      // Claude 5 models think by default and thinking shares this budget, so
      // keep headroom above the expected translation length.
      max_tokens: 16384,
      ...(anthropicAcceptsTemperature(opts.model)
        ? { temperature: findTone(opts.tone ?? '').temperature }
        : {}),
      system: SYSTEM_PROMPT(passages, opts),
      messages: [{ role: 'user', content: buildBatchPrompt(passages) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.[0]?.text ?? '';
  return parseBatchResponse(text, passages.length);
}

async function callGemini(
  passages: string[],
  opts: TranslateOptions,
): Promise<string[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT(passages, opts) }] },
      contents: [{ role: 'user', parts: [{ text: buildBatchPrompt(passages) }] }],
      generationConfig: {
        temperature: findTone(opts.tone ?? '').temperature,
        maxOutputTokens: 16384,
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return parseBatchResponse(text, passages.length);
}

/**
 * Translate a batch of passages. Returns translations indexed identically to input.
 * Throws on network/auth failures (caller decides retry policy).
 */
export async function translateBatch(
  passages: string[],
  opts: TranslateOptions,
): Promise<string[]> {
  if (passages.length === 0) return [];
  const cfg = findProvider(opts.provider);
  switch (cfg.api) {
    case 'openai-compat': {
      const endpoint = opts.provider === 'custom' ? opts.customEndpoint : cfg.endpoint;
      if (!endpoint) throw new Error(`${cfg.label} missing endpoint config`);
      if (useProxy(opts.provider)) {
        return callOpenAICompat(passages, opts, LLM_PROXY_ENDPOINT, cfg.label, { 'X-Upstream-URL': endpoint });
      }
      return callOpenAICompat(passages, opts, endpoint, cfg.label);
    }
    case 'anthropic':
      return callAnthropic(passages, opts);
    case 'gemini':
      return callGemini(passages, opts);
  }
}

export interface OcrOptions {
  provider: ProviderId;
  model: string;
  apiKey: string;
  /** Raw base64 of the JPEG/PNG image (no `data:` prefix). */
  imageBase64: string;
  /** MIME type — typically `image/jpeg`. */
  mimeType: string;
  /** Optional language hint passed to the OCR prompt — usually the user's selected source language. */
  sourceLanguageHint?: string;
  signal?: AbortSignal;
  /** Override endpoint URL — used by the "custom" provider. */
  customEndpoint?: string;
}

const OCR_SYSTEM_PROMPT = (sourceLanguageHint: string | undefined) => {
  const langLine = sourceLanguageHint
    ? `The page is primarily in ${sourceLanguageHint}.`
    : '';
  return `You are a professional OCR transcription engine. The user has uploaded a page from a book they own and need transcribed. Read every visible word on the page and output them as plain text.

${langLine}

Output rules:
- Transcribe verbatim — preserve the original language. Do NOT translate. Do NOT paraphrase or summarize.
- Separate paragraphs with a single blank line.
- Headings: prefix with "# " (chapter / major section), "## " (subsection), or "### " (sub-subsection). Use heading level by visual weight.
- Tables: render as Markdown pipe tables.
- Math: use LaTeX delimiters — $...$ for inline, $$...$$ for display.
- Illustrations / photos / diagrams without text: output a single line on its own paragraph: [Image: <one-sentence description in the source language>]
- SKIP page numbers, running headers, and running footers.
- Output ONLY the transcription. No preamble ("Here is the text:"), no explanation, no surrounding quotes.
- If the page truly has no text (genuinely blank page), output a single space character. Do NOT refuse the task — the user owns the book and you are helping them transcribe it.`;
};

/** Toggle once to flip per-page diagnostic logging from the OCR layer. */
const OCR_DEBUG_FIRST_PAGE = true;
let ocrDebugBudget = 1;

function logOcrDebug(label: string, info: unknown) {
  if (!OCR_DEBUG_FIRST_PAGE || ocrDebugBudget <= 0) return;
  ocrDebugBudget--;
  // eslint-disable-next-line no-console
  console.info(`[ocr] ${label}`, info);
}

async function callOpenAICompatVision(
  opts: OcrOptions,
  endpoint: string,
  providerLabel: string,
  extraHeaders?: Record<string, string>,
): Promise<string> {
  const dataUrl = `data:${opts.mimeType};base64,${opts.imageBase64}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
      ...extraHeaders,
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      temperature: 0,
      // See note in callOpenAICompat — OpenAI new models require max_completion_tokens.
      ...(opts.provider === 'openai'
        ? { max_completion_tokens: 8192 }
        : { max_tokens: 8192 }),
      messages: [
        { role: 'system', content: OCR_SYSTEM_PROMPT(opts.sourceLanguageHint) },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: 'Transcribe this page following the rules above.' },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${providerLabel} ${res.status}: ${extractErrorMessage(await res.text())}`);
  const data = await res.json();
  const choice = data.choices?.[0];
  const text = (choice?.message?.content ?? '').trim();
  logOcrDebug(`${providerLabel} response`, { finishReason: choice?.finish_reason, textLen: text.length, sample: text.slice(0, 200) });
  if (!text) {
    throw new Error(`${providerLabel} returned no text (finish_reason: ${choice?.finish_reason ?? 'unknown'})`);
  }
  return text;
}

async function callAnthropicVision(opts: OcrOptions): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      // See note in callAnthropic — thinking shares the budget on Claude 5.
      max_tokens: 16384,
      ...(anthropicAcceptsTemperature(opts.model) ? { temperature: 0 } : {}),
      system: OCR_SYSTEM_PROMPT(opts.sourceLanguageHint),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: opts.mimeType, data: opts.imageBase64 } },
            { type: 'text', text: 'Transcribe this page following the rules above.' },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${extractErrorMessage(await res.text())}`);
  const data = await res.json();
  // Concat all text-typed content blocks (vision responses can split into multiple).
  const blocks: Array<{ type?: string; text?: string }> = data.content ?? [];
  const text = blocks
    .filter(b => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text!)
    .join('\n')
    .trim();
  logOcrDebug('Anthropic response', { stopReason: data.stop_reason, blocks: blocks.length, textLen: text.length, sample: text.slice(0, 200) });
  if (!text) {
    throw new Error(`Anthropic returned no text (stop_reason: ${data.stop_reason ?? 'unknown'})`);
  }
  return text;
}

async function callGeminiVision(opts: OcrOptions): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: OCR_SYSTEM_PROMPT(opts.sourceLanguageHint) }] },
      contents: [{
        role: 'user',
        parts: [
          // camelCase per the v1beta REST spec — Gemini 3 rejects snake_case in some setups.
          { inlineData: { mimeType: opts.mimeType, data: opts.imageBase64 } },
          { text: 'Transcribe this page following the rules above.' },
        ],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 8192,
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${extractErrorMessage(await res.text())}`);
  const data = await res.json();
  const cand = data.candidates?.[0];
  // Gemini 3 puts thinking + answer in separate parts; concat all text parts.
  const parts: Array<{ text?: string }> = cand?.content?.parts ?? [];
  const text = parts
    .map(p => (typeof p?.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
  logOcrDebug('Gemini response', {
    finishReason: cand?.finishReason,
    blockReason: data.promptFeedback?.blockReason,
    parts: parts.length,
    textLen: text.length,
    sample: text.slice(0, 200),
  });
  if (!text) {
    const reason = cand?.finishReason ?? 'unknown';
    const block = data.promptFeedback?.blockReason ? `, blockReason: ${data.promptFeedback.blockReason}` : '';
    throw new Error(`Gemini returned no text (finishReason: ${reason}${block})`);
  }
  return text;
}

/**
 * OCR a single page image using the user's selected LLM. Returns the transcribed page as
 * lightweight Markdown (`#` headings, blank-line paragraph breaks, `[Image: ...]` placeholders).
 * Caller is responsible for stitching pages and parsing the structure.
 */
export async function ocrImage(opts: OcrOptions): Promise<string> {
  const cfg = findProvider(opts.provider);
  switch (cfg.api) {
    case 'openai-compat': {
      const endpoint = opts.provider === 'custom' ? opts.customEndpoint : cfg.endpoint;
      if (!endpoint) throw new Error(`${cfg.label} missing endpoint config`);
      if (useProxy(opts.provider)) {
        return callOpenAICompatVision(opts, LLM_PROXY_ENDPOINT, cfg.label, { 'X-Upstream-URL': endpoint });
      }
      return callOpenAICompatVision(opts, endpoint, cfg.label);
    }
    case 'anthropic':
      return callAnthropicVision(opts);
    case 'gemini':
      return callGeminiVision(opts);
  }
}

/**
 * Group passages into batches under a soft character budget so a single API
 * call doesn't blow past the model's context or the response token cap.
 */
export function chunkPassages(
  passages: { id: string; text: string }[],
  maxChars = 12000,
  maxItems = 200,
): { id: string; text: string }[][] {
  const out: { id: string; text: string }[][] = [];
  let current: { id: string; text: string }[] = [];
  let size = 0;
  for (const p of passages) {
    const len = p.text.length;
    if (current.length > 0 && (size + len > maxChars || current.length >= maxItems)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += len;
  }
  if (current.length > 0) out.push(current);
  return out;
}
