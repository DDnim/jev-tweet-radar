import { QUESTIONS, TAG_ORDER, DEFAULT_TAGS } from './questions.js';

const API = 'https://api.typesafe.ai/v1/systemone';
const DEFAULTS = { apiKey: '', enabled: true, lang: 'ja', threshold: 0.5, maxPerMinute: 120, model: 'jev-latest', tags: DEFAULT_TAGS };
const MEM_CACHE = new Map(); // tweetId → answers (per service-worker lifetime; persistent cache lives in chrome.storage.local)
const inflight = new Map();
let windowStart = Date.now(), windowCount = 0;

async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  const merged = { ...DEFAULTS, ...s };
  merged.tags = TAG_ORDER.filter(t => merged.tags.includes(t));
  merged.keys = ['engage', ...merged.tags];
  return merged;
}
const cacheKey = (id, settings) => 'r:' + id + ':' + settings.keys.join(',');

async function cached(k) {
  if (MEM_CACHE.has(k)) return MEM_CACHE.get(k);
  const v = (await chrome.storage.local.get(k))[k];
  if (v) MEM_CACHE.set(k, v);
  return v;
}

async function remember(k, answers) {
  MEM_CACHE.set(k, answers);
  await chrome.storage.local.set({ [k]: answers });
}

async function bumpStats(usage) {
  const day = new Date().toISOString().slice(0, 10);
  const { stats = {} } = await chrome.storage.local.get('stats');
  const d = stats[day] || { calls: 0, input_tokens: 0, output_tokens: 0 };
  d.calls += 1; d.input_tokens += usage?.input_tokens || 0; d.output_tokens += usage?.output_tokens || 0;
  stats[day] = d;
  await chrome.storage.local.set({ stats });
}

function rateOk(max) {
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; windowCount = 0; }
  if (windowCount >= max) return false;
  windowCount += 1; return true;
}

async function judge(post, settings) {
  const state = {
    platform: 'X (Twitter)',
    author: post.author,
    posted_at: post.time,
    has_media: post.hasMedia,
    has_link: post.hasLink,
    is_reply: post.isReply,
    text: post.text
  };
  const questions = Object.fromEntries(settings.keys.map(k => [k, QUESTIONS[k]]));
  const body = { state, model: settings.model, questions };
  let delay = 800;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(API, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + settings.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (r.status === 429 || r.status === 529) { await new Promise(res => setTimeout(res, delay)); delay *= 2; continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const out = {};
    for (const k of settings.keys) out[k] = j.answers?.[k]?.noul ?? null;
    out.ts = Date.now();
    await bumpStats(j.usage);
    return out;
  }
  throw new Error('rate limited');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'judge') return;
  (async () => {
    const settings = await getSettings();
    if (!settings.enabled) return { skipped: 'disabled' };
    if (!settings.apiKey) return { error: 'no_key' };
    const k = cacheKey(msg.post.id, settings);
    const hit = await cached(k);
    if (hit) return { answers: hit, settings };
    if (inflight.has(k)) return { answers: await inflight.get(k), settings };
    if (!rateOk(settings.maxPerMinute)) return { skipped: 'rate' };
    const p = judge(msg.post, settings).then(async a => { await remember(k, a); return a; }).finally(() => inflight.delete(k));
    inflight.set(k, p);
    try { return { answers: await p, settings }; } catch (e) { return { error: String(e.message || e) }; }
  })().then(sendResponse);
  return true;
});
