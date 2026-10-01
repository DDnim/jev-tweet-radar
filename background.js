// QUESTIONS, TAG_ORDER, DEFAULT_TAGS, GOALS, engageFor, DEFAULT_FILTER, filterReasons. Chrome runs this as a service worker
// and imports them; Safari (iOS) runs `background.scripts`, where questions.js is already loaded before this file.
if (typeof QUESTIONS === 'undefined') importScripts('questions.js');

const API = 'https://api.typesafe.ai/v1/systemone';
const DEFAULTS = { apiKey: '', enabled: true, lang: '', threshold: 0.5, maxPerMinute: 120, model: 'jev-latest', tags: DEFAULT_TAGS, goalPreset: 'none', goalCustom: '', filter: DEFAULT_FILTER };
const ALWAYS = ['buzz', 'spam', 'ai_smell', 'repost'];
const MEM_CACHE = new Map(); // tweetId → answers (per service-worker lifetime; persistent cache lives in chrome.storage.local)
const inflight = new Map();
let windowStart = Date.now(), windowCount = 0;

async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  const merged = { ...DEFAULTS, ...s };
  merged.tags = TAG_ORDER.filter(t => merged.tags.includes(t));
  merged.filter = { ...DEFAULT_FILTER, ...(merged.filter || {}), rules: { ...DEFAULT_FILTER.rules, ...(merged.filter?.rules || {}) } };
  // Tags a live filter rule needs are asked too, even when hidden from the badge row.
  const ruleTags = !merged.filter.on ? [] : Object.entries(merged.filter.rules).filter(([, r]) => r.on).map(([t]) => t);
  // Always asked: `buzz` for the bars under the avatar and the rarity colour, `spam` / `ai_smell` for folding, `repost` for the long press.
  merged.keys = ['engage', ...TAG_ORDER.filter(t => ALWAYS.includes(t) || merged.tags.includes(t) || ruleTags.includes(t))];
  merged.goalText = merged.goalPreset === 'custom' ? (merged.goalCustom || '').trim() : (GOALS[merged.goalPreset]?.text || '');
  return merged;
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const cacheKey = (id, settings) => 'r:' + id + ':' + settings.keys.join(',') + (settings.goalText ? ':g' + hash(settings.goalText) : '');

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
  if (post.replyingTo) {
    state.replying_to = { author: post.replyingTo.author, text: post.replyingTo.text };
    state.note = 'text は replying_to の投稿への返信の下書き。各質問は返信先との関係（噛み合っているか、文脈が通じるか、相手や周囲がどう受け取るか）を含めて判断する。';
  }
  if (settings.goalText) state.viewer_goal = settings.goalText;
  const questions = Object.fromEntries(settings.keys.map(k => [k, k === 'engage' ? engageFor(settings.goalText) : QUESTIONS[k]]));
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

// Last failure, shown in the popup so a phone (no console) can tell why nothing appears.
function noteError(e) { chrome.storage.local.set({ lastError: { at: Date.now(), msg: String(e?.message || e).slice(0, 200) } }); }

// ---- My own posts and replies, collected from the pages I browse (content.js sends them), the source for reply suggestions. ----
// Stored as one map id → post in chrome.storage.local `mine`; writes are chained so two tabs cannot clobber each other.
let mineCache = null, mineWrite = Promise.resolve();
async function loadMine() {
  if (!mineCache) mineCache = (await chrome.storage.local.get('mine')).mine || {};
  return mineCache;
}
function saveMine(posts) {
  mineWrite = mineWrite.then(async () => {
    const mine = await loadMine();
    let added = 0;
    for (const p of posts) {
      const old = mine[p.id];
      if (!old) added += 1;
      // A later sighting refreshes counts and text, but never loses the parent post an earlier sighting knew.
      mine[p.id] = { ...old, ...p, replyTo: p.replyTo || old?.replyTo || null };
    }
    await chrome.storage.local.set({ mine });
    return { added, total: Object.keys(mine).length };
  }).catch(e => { noteError(e); return { added: 0, total: Object.keys(mineCache || {}).length }; });
  return mineWrite;
}
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.mine && !c.mine.newValue) mineCache = null; });

// Search terms: latin words and CJK character bigrams, URLs dropped.
function terms(s) {
  const t = (s || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ');
  const out = t.match(/[a-z0-9_]{2,}/g) || [];
  for (const run of t.match(/[぀-ヿ㐀-鿿가-힯]+/g) || []) {
    if (run.length === 1) out.push(run);
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

// BM25 over my posts against the post being replied to (+ my draft). Past replies to the same author get a bonus.
function rank(posts, query, targetAuthor) {
  const docs = posts.map(p => terms(`${p.text} ${(p.links || []).join(' ')} ${p.card || ''}`));
  const df = new Map();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) || 0) + 1);
  const avg = docs.reduce((a, d) => a + d.length, 0) / (docs.length || 1) || 1;
  const q = [...new Set(terms(query))];
  return posts.map((p, i) => {
    const tf = new Map();
    for (const w of docs[i]) tf.set(w, (tf.get(w) || 0) + 1);
    let s = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - df.get(w) + 0.5) / (df.get(w) + 0.5));
      s += idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * docs[i].length / avg));
    }
    if (targetAuthor && p.replyTo?.author?.toLowerCase() === targetAuthor.toLowerCase()) s += 2;
    return { p, s };
  }).sort((a, b) => b.s - a.s);
}

const isWork = (p, works) => works.some(w => `${p.text} ${(p.links || []).join(' ')} ${p.card || ''}`.toLowerCase().includes(w));

// What the model sees of my history: the posts closest to the topic, my works, and my latest replies/posts for the voice.
function pickPosts(mine, target, draft, works) {
  const all = Object.values(mine).filter(p => p.id !== target.id);
  const byTime = (a, b) => (b.time || '').localeCompare(a.time || '');
  const picked = new Map();
  const add = (list, n) => { for (const p of list) { if (n <= 0) break; if (!picked.has(p.id)) { picked.set(p.id, p); n -= 1; } } };
  add(rank(all, `${target.text} ${draft || ''}`, target.author).filter(r => r.s > 0).map(r => r.p), 25);
  const workPosts = works.length ? all.filter(p => isWork(p, works)) : all.filter(p => p.hasVideo || p.card || p.links?.length);
  add(workPosts.sort((a, b) => (b.likes || 0) - (a.likes || 0)), 12);
  add(all.filter(p => p.replyTo || p.isReply).sort(byTime), 12);
  add(all.filter(p => !p.replyTo && !p.isReply).sort(byTime), 6);
  return [...picked.values()];
}

const SUGGEST_SYSTEM = `You draft replies on X (Twitter) for the account owner. You get the post they are replying to, maybe their unfinished draft, and a selection of their own past posts and replies, each with an id.

Return 2 or 3 suggestions, best first:
- kind "reply": a reply they could send as is. Write it the way this person writes: copy their language choice, length, tone, punctuation, emoji and hashtag habits from the past posts, above all from their past replies. Say something specific to the post: add information, an experience, a question or a clear opinion. No generic praise, no restating the post, no bullet lists, no assistant-style phrasing. If there is a draft, build on what the draft is trying to say.
- kind "link": when one of their past posts genuinely answers, extends or illustrates what the post is about, suggest replying with that post. "text" is a short lead-in in their voice, one sentence without any URL (the link is appended automatically); "post_id" is that past post's id, copied exactly. Prefer past posts that show their own original work (work: true, or matching their list of works), since getting those seen is a goal, but only when it fits the conversation. Never push a link onto a post it does not relate to; if nothing fits, give no link suggestion. At most two link suggestions.
- Never state facts about them (experience, works, numbers) that are not in the past posts.
- Write in the language of the post being replied to, unless their past replies show they answer such posts in another language.
- Keep each text within one X post: under 280 characters of latin text, under 140 CJK characters.
- "why": one short line in the requested UI language telling them what the suggestion draws on.
- "post_id" is "" for kind "reply".`;

const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['reply', 'link'] }, text: { type: 'string' }, post_id: { type: 'string' }, why: { type: 'string' } },
        required: ['kind', 'text', 'post_id', 'why'],
        additionalProperties: false
      }
    }
  },
  required: ['suggestions'],
  additionalProperties: false
};

const SUGGEST_DEFAULTS = { groqKey: '', groqModel: 'openai/gpt-oss-120b', works: '', myHandle: '', lang: '' };
const LANG_NAME = { ja: 'Japanese', zh: 'Chinese', en: 'English' };
const cut = (s, n) => (s || '').length > n ? s.slice(0, n) + '…' : (s || '');

async function suggest({ target, draft, lang }) {
  const s = await chrome.storage.sync.get(SUGGEST_DEFAULTS);
  const { detectedHandle } = await chrome.storage.local.get('detectedHandle');
  const handle = (s.myHandle || detectedHandle || '').replace(/^@/, '');
  if (!s.groqKey) return { error: 'no_groq_key' };
  if (!handle) return { error: 'no_handle' };
  const mine = await loadMine();
  if (!Object.keys(mine).length) return { error: 'no_posts' };
  const works = s.works.split('\n').map(w => w.trim().toLowerCase()).filter(Boolean);
  const posts = pickPosts(mine, target, draft, works);
  const input = {
    me: '@' + handle,
    my_works: works,
    ui_language: LANG_NAME[s.lang || lang] || 'English',
    replying_to: { author: '@' + target.author, text: target.text },
    draft: draft || '',
    my_past_posts: posts.map(p => ({
      id: p.id, date: (p.time || '').slice(0, 10), kind: p.replyTo || p.isReply ? 'reply' : 'post',
      ...(p.replyTo ? { to: `@${p.replyTo.author}: ${cut(p.replyTo.text, 160)}` } : {}),
      text: cut(p.text, 500),
      ...(p.links?.length ? { links: p.links } : {}), ...(p.card ? { card: cut(p.card, 120) } : {}), ...(p.hasVideo ? { video: true } : {}),
      ...(p.likes ? { likes: p.likes } : {}), ...(works.length && isWork(p, works) ? { work: true } : {})
    }))
  };
  const body = {
    model: s.groqModel,
    messages: [{ role: 'system', content: SUGGEST_SYSTEM }, { role: 'user', content: JSON.stringify(input) }],
    response_format: { type: 'json_schema', json_schema: { name: 'suggestions', strict: true, schema: SUGGEST_SCHEMA } },
    ...(s.groqModel.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {})
  };
  // A service worker is stopped when a fetch takes over 30 s to answer; an extension API call every 20 s keeps it up.
  const keep = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + s.groqKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60_000)
    });
    if (!r.ok) throw new Error(`Groq HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const text = (await r.json()).choices?.[0]?.message?.content;
    if (!text) throw new Error('Groq returned no text');
    const ids = new Set(posts.map(p => p.id));
    // A link must point at a post that really is in my history; anything else is dropped.
    const out = JSON.parse(text).suggestions
      .filter(x => x.text && (x.kind === 'reply' || ids.has(x.post_id)))
      .map(x => x.kind === 'link' ? { ...x, url: `https://x.com/${handle}/status/${x.post_id}`, old: cut(mine[x.post_id].text, 140) } : x);
    return { suggestions: out, used: posts.length, total: Object.keys(mine).length };
  } finally { clearInterval(keep); }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ping') { getSettings().then(s => sendResponse({ ok: true, hasKey: !!s.apiKey, enabled: s.enabled }), e => sendResponse({ ok: false, error: String(e.message || e) })); return true; }
  if (msg.type === 'mine') { saveMine(msg.posts).then(sendResponse); return true; }
  if (msg.type === 'suggest') { suggest(msg).then(sendResponse, e => { noteError(e); sendResponse({ error: String(e.message || e) }); }); return true; }
  if (msg.type !== 'judge') return;
  (async () => {
   try {
    const settings = await getSettings();
    if (!settings.enabled) return { skipped: 'disabled' };
    if (!settings.apiKey) return { error: 'no_key' };
    const k = cacheKey(msg.post.id, settings);
    const hit = await cached(k);
    const reply = a => ({ answers: a, settings, filtered: msg.post.replyingTo || String(msg.post.id).startsWith('draft:') ? [] : filterReasons(a, settings.filter) });
    if (hit) return reply(hit);
    if (inflight.has(k)) return reply(await inflight.get(k));
    if (!rateOk(settings.maxPerMinute)) return { skipped: 'rate' };
    const p = judge(msg.post, settings).then(async a => { await remember(k, a); return a; }).finally(() => inflight.delete(k));
    inflight.set(k, p);
    try { return reply(await p); } catch (e) { noteError(e); return { error: String(e.message || e) }; }
   } catch (e) { console.error('[JevRadar]', e); noteError(e); return { error: String(e.message || e) }; }
  })().then(sendResponse);
  return true;
});
