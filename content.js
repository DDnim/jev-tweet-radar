// Scans the X timeline, asks the background worker to judge each post once it is visible, and renders a badge row.
const LABELS = JEV_I18N.tag;
const seen = new WeakSet();
// UI language for messages shown before a judgment result (which carries settings.lang) arrives.
let uiLang = JEV_I18N.detect();
chrome.storage.sync.get({ lang: '' }, s => { if (s.lang) uiLang = s.lang; });
chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync' && c.lang?.newValue) uiLang = c.lang.newValue; });

function extract(article) {
  const link = [...article.querySelectorAll('a[href*="/status/"]')].map(a => a.getAttribute('href')).find(h => /\/status\/\d+$/.test(h));
  if (!link) return null;
  const id = link.split('/status/')[1];
  const author = link.split('/status/')[0].replace(/^\//, '');
  const textEl = article.querySelector('[data-testid="tweetText"]');
  const text = textEl ? textEl.innerText.trim() : '';
  if (!text) return null;
  const time = article.querySelector('time')?.getAttribute('datetime') || null;
  return {
    id, author, text, time,
    hasMedia: !!article.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]'),
    hasLink: !!article.querySelector('[data-testid="card.wrapper"]') || /https?:\/\//.test(text),
    isReply: /^Replying to|^返信先/.test(article.innerText)
  };
}

// sendMessage that never fails silently: logs to the page console, and after an extension reload
// (context invalidated) tells the user to refresh the page instead of doing nothing.
function send(msg, cb) {
  try {
    chrome.runtime.sendMessage(msg, res => {
      const err = chrome.runtime.lastError;
      if (err) { console.error('[JevRadar] background error:', err.message); return cb({ error: 'background: ' + err.message }); }
      if (res?.error) console.warn('[JevRadar]', res.error);
      cb(res);
    });
  } catch (e) {
    console.error('[JevRadar] extension context lost, refresh the page:', e.message);
    cb({ error: JEV_I18N.t('reload', uiLang) });
  }
}

function pct(v) { return v == null ? '–' : Math.round(v * 100) + '%'; }

// Timeline posts show the result only in the avatar column (no badge row under the text); drafts still get the row.
function render(article, answers, settings, filtered) {
  if (article.querySelector('.jev-col')) return;
  decorateAvatar(article, answers, settings);
  if (filtered?.length) applyFilter(article, answers, settings, filtered);
}

// ---- Avatar column: two tiny bars (buzz / engage), a rarity background, and a long press ("triple" = bookmark + like + repost / reply or quote window by score, or block on junk). ----
function rarityOf(answers) {
  const v = Math.max(answers.buzz ?? 0, answers.engage ?? 0);
  return v > 0.75 ? 'gold' : v > 0.6 ? 'purple' : v > 0.45 ? 'green' : 'white';
}

// The left column holding the avatar: the highest ancestor of the avatar that is still narrow (X gives it a fixed ~40px width).
function avatarColumn(article) {
  const avatar = article.querySelector('[data-testid="Tweet-User-Avatar"]');
  if (!avatar) return null;
  let col = avatar;
  while (col.parentElement && col.parentElement !== article && col.parentElement.getBoundingClientRect().width < 80) col = col.parentElement;
  return { avatar, col };
}

function decorateAvatar(article, answers, settings) {
  const found = avatarColumn(article);
  if (!found || found.col.classList.contains('jev-col')) return;
  const { avatar, col } = found;
  const lang = settings.lang || uiLang;
  const rarity = rarityOf(answers);
  const bars = document.createElement('div');
  // The open post on a detail page has its avatar in the header row, so its bars lie flat instead of standing up.
  const focal = (location.pathname.match(/\/status\/(\d+)/) || [])[1];
  bars.className = 'jev-bars' + (focal && extract(article)?.id === focal ? ' jev-bars-flat' : '');
  for (const k of ['buzz', 'engage']) {
    const bar = document.createElement('div');
    bar.className = 'jev-bar jev-bar-' + k;
    bar.style.setProperty('--v', Math.round((answers[k] ?? 0) * 100) + '%');
    bars.appendChild(bar);
  }
  avatar.insertAdjacentElement('afterend', bars);
  col.classList.add('jev-col', 'jev-r-' + rarity);
  const author = extract(article)?.author || '';
  const junk = junkReasons(answers);
  const tip = JEV_I18N.t('rarity', lang, { r: JEV_I18N.ui.rarityName[lang]?.[rarity] || rarity, b: pct(answers.buzz), e: pct(answers.engage) });
  col.title = junk.length ? JEV_I18N.t('rarityBlock', lang, { r: tip.split('\n')[0], u: author }) : tip;
  if (junk.length) fold(article, col, junk.map(k => `${LABELS[k][lang]} ${pct(answers[k])}`).join(' · '), lang, author);
  if (!junk.length) markTargets(article, answers);
  wireLongPress(article, col, junk.length ? () => block(article) : () => triple(article, answers));
}

// ---- Junk (spam / AI-ish over 85%): fold the post down to its header line; long-press on the avatar blocks the author. ----
const JUNK_AT = 0.85;
function junkReasons(answers) { return ['spam', 'ai_smell'].filter(k => answers[k] != null && answers[k] > JUNK_AT); }

// Hides every child of the content column except the one holding the name/handle line, and puts a one-line note there instead.
function fold(article, col, reason, lang, author) {
  const body = col.nextElementSibling;
  const head = body && [...body.children].find(c => c.querySelector('[data-testid="User-Name"]'));
  if (!head) return;
  const hidden = [...body.children].filter(c => c !== head);
  hidden.forEach(c => c.classList.add('jev-fold-hide'));
  article.classList.add('jev-folded');
  const note = document.createElement('div');
  note.className = 'jev-fold-note';
  note.textContent = JEV_I18N.t('folded', lang, { r: reason, u: author });
  note.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    hidden.forEach(c => c.classList.remove('jev-fold-hide'));
    article.classList.remove('jev-folded');
    note.remove();
  });
  head.insertAdjacentElement('afterend', note);
}

// X's own flow: "…" menu → Block → confirm.
async function block(article) {
  article.querySelector('[data-testid="caret"]')?.click();
  const item = await waitFor('[data-testid="block"]') ||
    [...document.querySelectorAll('[role="menuitem"]')].find(m => /Block|ブロック|屏蔽|封锁|封鎖/.test(m.textContent) && !/Unblock|解除|取消/.test(m.textContent));
  if (!item) { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return; }
  item.click();
  (await waitFor('[data-testid="confirmationSheetConfirm"]'))?.click();
}

const HOLD_MS = 600;
function wireLongPress(article, col, action) {
  let timer = null, fired = false, x0 = 0, y0 = 0;
  const cancel = () => { clearTimeout(timer); timer = null; col.classList.remove('jev-hold'); };
  col.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    fired = false; x0 = e.clientX; y0 = e.clientY;
    col.classList.add('jev-hold');
    timer = setTimeout(() => { timer = null; fired = true; col.classList.remove('jev-hold'); col.classList.remove('jev-boom'); void col.offsetWidth; col.classList.add('jev-boom'); action(); }, HOLD_MS);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) col.addEventListener(ev, cancel);
  // On a touch screen a finger that starts to scroll is not a long press.
  col.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); });
  // A completed long press must not also open the author's profile.
  col.addEventListener('click', e => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
  col.addEventListener('contextmenu', e => { if (timer || fired) e.preventDefault(); });
  col.addEventListener('dragstart', e => { if (timer) e.preventDefault(); });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(sel, ms = 1500) {
  for (let t = 0; t < ms; t += 50) { const el = document.querySelector(sel); if (el) return el; await sleep(50); }
  return null;
}

// Which windows the long press opens, from the Jev scores (all thresholds strictly "greater than"):
// engage > 70% → reply window; repost > 50% → repost, > 70% → quote window instead of the plain repost.
// Only one window can open; the higher score wins, a tie goes to the reply (the repost then still happens as a plain one,
// so nothing is lost). A missing repost score keeps the old behaviour: plain repost. An already reposted post gets no
// quote window (its repost side is done), so the reply window may open instead.
const REPLY_AT = 0.7, REPOST_AT = 0.5, QUOTE_AT = 0.7;
function triplePlan(answers, reposted) {
  const reply = answers?.engage, rt = answers?.repost;
  const wantReply = reply != null && reply > REPLY_AT, wantQuote = !reposted && rt != null && rt > QUOTE_AT;
  const open = wantReply && (!wantQuote || reply >= rt) ? 'reply' : wantQuote ? 'quote' : null;
  const repost = open !== 'quote' && (rt == null || rt > REPOST_AT);
  return { repost, open };
}

// Marks on the action bar what a long press will do: ✎ on the button whose window opens, a dot on repost when it reposts directly.
function markTargets(article, answers) {
  for (const b of article.querySelectorAll('[data-jev-will]')) b.removeAttribute('data-jev-will');
  const rt = article.querySelector('[data-testid="retweet"]');
  const { repost, open } = triplePlan(answers, !rt);
  if (open === 'reply') article.querySelector('[data-testid="reply"]')?.setAttribute('data-jev-will', 'window');
  if (rt && (open === 'quote' || repost)) rt.setAttribute('data-jev-will', open === 'quote' ? 'window' : 'repost');
}

// Only turns things on: an already-liked / reposted / bookmarked post is left as is. Windows open last and are never submitted.
const busy = new WeakSet();
async function triple(article, answers) {
  if (busy.has(article)) return;
  busy.add(article);
  try {
    const q = sel => article.querySelector(sel);
    const { repost, open } = triplePlan(answers, !q('[data-testid="retweet"]'));
    q('[data-testid="bookmark"]')?.click();
    await sleep(150);
    q('[data-testid="like"]')?.click();
    await sleep(150);
    const rt = q('[data-testid="retweet"]');
    if (rt && repost) { rt.click(); (await waitFor('[data-testid="retweetConfirm"]'))?.click(); await sleep(150); }
    // Never stack a second composer on one that is already open.
    if (!open || document.querySelector('[role="dialog"] [data-testid^="tweetTextarea_"]')) return;
    if (open === 'reply') { q('[data-testid="reply"]')?.click(); return; }
    rt.click();
    const menu = await waitFor('[data-testid="retweetConfirm"]');
    const quote = [...document.querySelectorAll('[role="menuitem"]')].find(m => /\/compose\/(post|tweet)/.test(m.getAttribute('href') || '') || /Quote|引用/.test(m.textContent));
    if (quote) quote.click();
    else if (menu) menu.click(); // no Quote item found: fall back to the plain repost the score already earned
  } finally { busy.delete(article); setTimeout(() => markTargets(article, answers), 1000); }
}

// ---- Timeline filter: a matched post is faded to 50% and comes back on hover. ----
function applyFilter(article, answers, settings, reasons) {
  const lang = settings.lang || uiLang;
  const reason = reasons.map(k => `${LABELS[k][lang]} ${pct(answers[k])}`).join(' · ');
  article.classList.add('jev-dim');
  article.title = JEV_I18N.t('filtered', lang, { r: reason });
}

function buildRow(answers, settings) {
  const lang = settings.lang || uiLang;
  const th = settings.threshold ?? 0.5;
  const row = document.createElement('div');
  row.className = 'jev-radar';
  const e = answers.engage;
  const level = e == null ? 'na' : e >= 0.7 ? 'hi' : e >= th ? 'mid' : 'lo';
  const main = document.createElement('span');
  main.className = 'jev-main jev-' + level;
  main.textContent = `${LABELS.engage[lang]} ${pct(e)}`;
  main.title = settings.goalText ? JEV_I18N.t('tipGoal', lang, { g: settings.goalText.slice(0, 40) }) : JEV_I18N.t('tipGeneric', lang);
  row.appendChild(main);
  for (const k of (settings.tags || ['spam', 'buzz', 'misread', 'ai_smell'])) {
    const v = answers[k];
    const chip = document.createElement('span');
    chip.className = 'jev-chip jev-' + k + (v != null && v >= th ? ' jev-on' : '');
    chip.textContent = `${LABELS[k][lang]} ${pct(v)}`;
    row.appendChild(chip);
  }
  const foot = document.createElement('span');
  foot.className = 'jev-foot';
  foot.textContent = 'Jev';
  row.appendChild(foot);
  return row;
}

// ---- Composer (your own draft): judge after typing pauses, show the same badge row under the textbox. ----
const DRAFT_MIN = 8, DRAFT_DEBOUNCE = 1200;
const wiredBoxes = new WeakSet();

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

// Walk up until an ancestor that also contains the composer toolbar.
function toolbarOf(box) {
  for (let node = box; node && node !== document.body; node = node.parentElement) {
    const toolbar = node.querySelector?.('[data-testid="toolBar"]');
    if (toolbar) return toolbar;
  }
  return null;
}

// A panel of ours right above the composer toolbar (one per box and kind).
function panelAbove(box, map, className) {
  let panel = map.get(box);
  if (panel && panel.isConnected) return panel;
  panel = document.createElement('div');
  panel.className = className;
  const toolbar = toolbarOf(box);
  if (toolbar) toolbar.insertAdjacentElement('beforebegin', panel); else box.parentElement.appendChild(panel);
  map.set(box, panel);
  return panel;
}

const panels = new WeakMap();
const draftPanel = box => panelAbove(box, panels, 'jev-draft');

function renderDraft(box, answers, settings, text) {
  const panel = draftPanel(box);
  panel.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'jev-draft-head';
  const isReply = panel.dataset.reply === '1';
  head.textContent = JEV_I18N.t(isReply ? 'replyHead' : 'draftHead', settings.lang || uiLang);
  panel.appendChild(head);
  const row = buildRow(answers, settings);
  panel.appendChild(row);
}

function renderDraftNote(box, text) {
  const panel = draftPanel(box);
  panel.innerHTML = '';
  const d = document.createElement('div'); d.className = 'jev-draft-head'; d.textContent = text; panel.appendChild(d);
}

// The post a composer is replying to: the article inside the reply dialog, or the last article above an inline reply box.
function replyTarget(box) {
  const dialog = box.closest('[role="dialog"]');
  let article = dialog ? dialog.querySelector('article[data-testid="tweet"]') : null;
  if (!article && !dialog) {
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (a.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) article = a; else break;
    }
  }
  if (!article) return null;
  const p = extract(article);
  return p ? { id: p.id, author: p.author, text: p.text } : null;
}

function wireComposer(box) {
  if (wiredBoxes.has(box)) return;
  wiredBoxes.add(box);
  let timer = null, last = '';
  const run = () => {
    const text = box.innerText.replace(/\u200b/g, '').trim();
    if (text.length < DRAFT_MIN) { panels.get(box)?.remove(); last = ''; return; }
    if (text === last) return;
    last = text;
    renderDraftNote(box, JEV_I18N.t('judging', uiLang));
    const parent = replyTarget(box);
    const post = { id: 'draft:' + hash((parent ? parent.id + '|' : '') + text), author: 'me (draft)', text, time: new Date().toISOString(), hasMedia: false, hasLink: /https?:\/\//.test(text), isReply: !!parent, replyingTo: parent };
    send({ type: 'judge', post }, res => {
      if (!res) return;
      if (box.innerText.replace(/\u200b/g, '').trim() !== text) return; // stale
      if (res.answers) { draftPanel(box).dataset.reply = parent ? '1' : '0'; renderDraft(box, res.answers, res.settings || {}, text); }
      else if (res.error === 'no_key') renderDraftNote(box, JEV_I18N.t('noKeyShort', uiLang));
      else if (res.error) renderDraftNote(box, 'Jev: ' + res.error);
      else if (res.skipped === 'rate') renderDraftNote(box, JEV_I18N.t('rate', uiLang));
    });
  };
  box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, DRAFT_DEBOUNCE); });
}

function scanComposers() {
  for (const box of document.querySelectorAll('[data-testid^="tweetTextarea_"][contenteditable="true"]')) { wireComposer(box); addSuggestButton(box); }
}

// ---- Reply suggestions: a button in the reply composer's toolbar asks Groq or DeepSeek (background.js) for replies in my voice,
// written from my past posts, or for one of my old posts to link. A click on a suggestion fills the box; nothing is sent. ----
const sgChecked = new WeakMap();
function addSuggestButton(box) {
  const toolbar = toolbarOf(box);
  if (!toolbar || toolbar.querySelector('.jev-sg-btn')) return;
  // Only replies get the button; the check is repeated now and then because the post above an inline box may render later.
  if (Date.now() - (sgChecked.get(box) || 0) < 2000) return;
  sgChecked.set(box, Date.now());
  if (!replyTarget(box)) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'jev-sg-btn';
  btn.textContent = JEV_I18N.t('sgBtn', uiLang);
  btn.title = JEV_I18N.t('sgTip', uiLang);
  btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); runSuggest(box); });
  const icons = toolbar.querySelector('[data-testid="ScrollSnap-List"]');
  if (icons) icons.appendChild(btn); else toolbar.prepend(btn);
}

const sgPanels = new WeakMap();
function runSuggest(box) {
  const target = replyTarget(box);
  if (!target) return;
  const panel = panelAbove(box, sgPanels, 'jev-sg');
  panel.style.color = getComputedStyle(box).color;
  const draft = box.innerText.replace(/​/g, '').trim();
  panel.replaceChildren(sgHead(box, panel, JEV_I18N.t('sgLoading', uiLang)));
  send({ type: 'suggest', target, draft, lang: uiLang, others: otherReplies(target) }, res => {
    if (!panel.isConnected) return;
    if (!res?.suggestions) return panel.replaceChildren(sgHead(box, panel, sgError(res)));
    const head = sgHead(box, panel, JEV_I18N.t(res.suggestions.length ? 'sgHead' : 'sgNone', uiLang, { n: res.used, t: res.total }));
    panel.replaceChildren(head, ...res.suggestions.map(x => sgItem(box, head, x)));
  });
}

// Other people's replies to the post, as far as the page shows them: on the post's own page they sit below it.
function otherReplies(target) {
  const all = [...document.querySelectorAll('article[data-testid="tweet"]')];
  const i = all.findIndex(a => extract(a)?.id === target.id);
  if (i < 0 || (location.pathname.match(/\/status\/(\d+)/) || [])[1] !== target.id) return [];
  // The reply dialog shows a copy of the post; that copy is not a reply.
  return all.slice(i + 1).filter(a => !a.closest('[role="dialog"]')).map(extract)
    .filter(p => p && p.id !== target.id && p.author.toLowerCase() !== me()).map(p => ({ author: p.author, text: p.text }));
}

function sgError(res) {
  const key = { no_ai_key: 'sgNoKey', no_handle: 'sgNoHandle', no_posts: 'sgNoPosts' }[res?.error];
  return key ? JEV_I18N.t(key, uiLang, { p: res.provider || '' }) : (res?.error || 'no reply');
}

function sgHead(box, panel, text) {
  const head = document.createElement('div');
  head.className = 'jev-sg-head';
  const label = document.createElement('span');
  label.textContent = text;
  const again = document.createElement('button');
  again.type = 'button'; again.textContent = '↻'; again.title = JEV_I18N.t('sgRetry', uiLang);
  again.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); runSuggest(box); });
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = '×';
  close.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); panel.remove(); });
  head.append(label, again, close);
  return head;
}

function sgItem(box, head, x) {
  const item = document.createElement('div');
  item.className = 'jev-sg-item jev-sg-' + x.kind;
  const text = document.createElement('div');
  text.className = 'jev-sg-text';
  text.textContent = x.text;
  item.appendChild(text);
  if (x.kind === 'link') {
    const old = document.createElement('a');
    old.className = 'jev-sg-old'; old.href = x.url; old.target = '_blank'; old.rel = 'noopener';
    old.textContent = '↳ ' + x.old;
    old.addEventListener('click', e => e.stopPropagation());
    item.appendChild(old);
  }
  const meta = document.createElement('div');
  meta.className = 'jev-sg-meta';
  meta.textContent = JEV_I18N.t({ link: 'sgKindLink', echo: 'sgKindEcho' }[x.kind] || 'sgKindReply', uiLang) + ' · ' + x.why;
  item.appendChild(meta);
  item.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    fill(box, x.kind === 'link' ? `${x.text} ${x.url}` : x.text).then(ok => { if (!ok) head.firstChild.textContent = JEV_I18N.t('sgCopied', uiLang); });
  });
  return item;
}

// Replaces the composer's text. X's composer is Draft.js, which keeps its own copy of the text and the selection:
// typing commands (execCommand insertText) end up there twice, so the text goes in as a paste, which Draft.js handles
// once. Draft.js also resets the selection when the box gains focus and only reads a new one on a mouse/key event,
// hence focus → wait → select all → mouseup/keyup → paste. Other editors (paste not taken) get insertText;
// if nothing lands, the text goes to the clipboard.
async function fill(box, text) {
  const flat = s => s.replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
  const landed = async () => {
    for (let t = 0; t < 1000; t += 50) { if (flat(box.innerText).includes(flat(text).slice(0, 20))) return true; await sleep(50); }
    return false;
  };
  box.focus();
  await sleep(80);
  const range = document.createRange();
  range.selectNodeContents(box);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  box.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  box.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  document.dispatchEvent(new Event('selectionchange'));
  await sleep(120);
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  const taken = !box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  if (taken || document.execCommand('insertText', false, text)) { if (await landed()) return true; }
  try { await navigator.clipboard.writeText(text); } catch (_) {}
  return false;
}

// ---- My own posts and replies: every one of mine that shows up on a page is sent to background.js and kept there. ----
let manualHandle = '', detectedHandle = '';
const me = () => (manualHandle || detectedHandle).toLowerCase();
chrome.storage.sync.get({ myHandle: '' }, s => { manualHandle = s.myHandle.replace(/^@/, ''); });
chrome.storage.local.get('detectedHandle', l => { detectedHandle = detectedHandle || l.detectedHandle || ''; });
chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync' && c.myHandle) manualHandle = (c.myHandle.newValue || '').replace(/^@/, ''); });

// The logged-in account: the Profile link in the side bar, or the @handle on the account switcher.
function detectHandle() {
  const h = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.replace(/^\//, '') ||
    (document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')?.innerText.match(/@(\w{1,15})/) || [])[1];
  if (!h || h === detectedHandle) return;
  detectedHandle = h;
  try { chrome.storage.local.set({ detectedHandle: h }); } catch (_) {}
}

// "1,234" / "1.2K" / "3.4M" / "1.2万" → number.
function count(el) {
  const m = (el?.innerText || '').trim().replace(/,/g, '').match(/^([\d.]+)\s*([KkMm万萬])?/);
  return m ? Math.round(parseFloat(m[1]) * ({ k: 1e3, m: 1e6, 万: 1e4, 萬: 1e4 }[(m[2] || '').toLowerCase()] || 1)) : 0;
}

// The post a reply of mine answers, where the page makes it certain: on my Replies tab the parent sits right above my reply,
// and on a post page the open post's ancestors sit above it. A repost (social context line) above is not a parent.
function parentOf(article, post) {
  const focal = (location.pathname.match(/\/status\/(\d+)/) || [])[1];
  if (location.pathname.toLowerCase() !== `/${me()}/with_replies` && focal !== post.id) return null;
  const all = [...document.querySelectorAll('article[data-testid="tweet"]')];
  const prev = all[all.indexOf(article) - 1];
  if (!prev || prev.querySelector('[data-testid="socialContext"]')) return null;
  const p = extract(prev);
  return p && p.author.toLowerCase() !== me() ? { id: p.id, author: p.author, text: p.text } : null;
}

const REPLYING = /^(Replying to|返信先|回复|回覆)\s*[:：]?\s*\n?@\w/m;
function mineOf(article) {
  const post = extract(article);
  if (!post || post.author.toLowerCase() !== me()) return null;
  const textEl = article.querySelector('[data-testid="tweetText"]');
  const replyTo = parentOf(article, post);
  return {
    id: post.id, text: post.text, time: post.time,
    isReply: !!replyTo || REPLYING.test(article.innerText),
    replyTo,
    // t.co anchors show the real address as their text (cut with "…" when long).
    links: [...textEl.querySelectorAll('a[href^="https://t.co/"]')].map(a => a.innerText.replace(/…$/, '').trim()).filter(Boolean),
    card: article.querySelector('[data-testid="card.wrapper"]')?.innerText.replace(/\s+/g, ' ').trim() || '',
    hasVideo: !!article.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"]'),
    likes: count(article.querySelector('[data-testid="like"], [data-testid="unlike"]'))
  };
}

const mineSeen = new WeakSet(), mineQueue = new Map();
let mineTimer = null, mineTotal = 0, collector = null;
function keepMine(article) {
  if (mineSeen.has(article) || !me()) return;
  mineSeen.add(article);
  const p = mineOf(article);
  if (!p) return;
  mineQueue.set(p.id, p);
  if (!mineTimer) mineTimer = setTimeout(flushMine, 3000);
}
function flushMine() {
  clearTimeout(mineTimer);
  mineTimer = null;
  const posts = [...mineQueue.values()];
  mineQueue.clear();
  if (!posts.length) return Promise.resolve();
  return new Promise(done => send({ type: 'mine', posts }, res => { if (res?.total != null) { mineTotal = res.total; collector?.(res.added); } done(); }));
}

// ---- Collect: the popup opens /<me>/with_replies and leaves a request; this page then scrolls to the end on its own. ----
let lastPath = '';
async function maybeCollect() {
  if (location.pathname === lastPath || !me()) return;
  lastPath = location.pathname;
  if (lastPath.toLowerCase() !== `/${me()}/with_replies`) return;
  const { collectReq } = await chrome.storage.local.get('collectReq');
  if (!collectReq || Date.now() - collectReq > 120_000) return;
  chrome.storage.local.remove('collectReq');
  collect();
}

async function collect() {
  const bar = document.createElement('div');
  bar.className = 'jev-collect';
  let added = 0, stop = false;
  const show = done => { bar.textContent = JEV_I18N.t(done ? 'collectDone' : 'collecting', uiLang, { n: added, t: mineTotal }); };
  collector = n => { added += n; show(); };
  bar.onclick = () => { stop = true; };
  document.body.appendChild(bar);
  show();
  // X loads older posts as the page nears its end; stop after ~12 s without the page growing or anything new arriving.
  let idle = 0, lastH = 0, lastAdded = 0;
  while (!stop && idle < 8) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(1500);
    const h = document.documentElement.scrollHeight;
    idle = h === lastH && added === lastAdded ? idle + 1 : 0;
    lastH = h; lastAdded = added;
  }
  await flushMine();
  collector = null;
  show(true);
  bar.onclick = () => bar.remove();
  setTimeout(() => bar.remove(), 15000);
}

function renderNote(article, text) {
  const textEl = article.querySelector('[data-testid="tweetText"]');
  if (!textEl || article.querySelector('.jev-radar')) return;
  const row = document.createElement('div');
  row.className = 'jev-radar jev-note';
  row.textContent = text;
  textEl.insertAdjacentElement('afterend', row);
}

// Preload: judge posts once they are within this distance below/above the viewport, so the result is there
// by the time you scroll to them. X keeps only a few screens of posts in the DOM, so this stays cheap.
const PRELOAD_PX = 2000;
const io = new IntersectionObserver(entries => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const article = en.target;
    io.unobserve(article);
    const post = extract(article);
    if (!post) continue;
    send({ type: 'judge', post }, res => {
      if (!res) return;
      if (res.answers) render(article, res.answers, res.settings || {}, res.filtered);
      else if (res.error === 'no_key') renderNote(article, JEV_I18N.t('noKey', uiLang));
      else if (res.error) renderNote(article, 'Jev: ' + res.error);
      else if (res.skipped === 'rate') { seen.delete?.(article); setTimeout(() => io.observe(article), 15000); }
    });
  }
}, { rootMargin: `${PRELOAD_PX}px 0px`, threshold: 0 });

// Heartbeat for the popup: the page script is running here and sees this many posts.
let beatAt = 0;
function heartbeat(n) {
  if (Date.now() - beatAt < 5000) return;
  beatAt = Date.now();
  try { chrome.storage.local.set({ pageSeen: { at: beatAt, host: location.host, posts: n } }); } catch (_) {}
}

function scan() {
  heartbeat(document.querySelectorAll('article[data-testid="tweet"]').length);
  detectHandle();
  maybeCollect();
  for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
    keepMine(a);
    if (seen.has(a)) continue;
    seen.add(a);
    io.observe(a);
  }
}
new MutationObserver(() => { scan(); scanComposers(); }).observe(document.body, { childList: true, subtree: true });
scan(); scanComposers();
