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
      if (err) { console.error('[JevRadar] background error:', err.message); return cb(undefined); }
      if (res?.error) console.warn('[JevRadar]', res.error);
      cb(res);
    });
  } catch (e) {
    console.error('[JevRadar] extension context lost, refresh the page:', e.message);
    cb({ error: JEV_I18N.t('reload', uiLang) });
  }
}

function pct(v) { return v == null ? '–' : Math.round(v * 100) + '%'; }

function render(article, answers, settings, filtered) {
  const textEl = article.querySelector('[data-testid="tweetText"]');
  if (!textEl || article.querySelector('.jev-radar')) return;
  const row = buildRow(answers, settings);
  textEl.insertAdjacentElement('afterend', row);
  decorateAvatar(article, answers, settings);
  if (filtered?.length) applyFilter(article, answers, settings, filtered);
}

// ---- Avatar column: two tiny bars (buzz / engage), a rarity background, and a long press ("triple" = bookmark + repost + like, or block on junk). ----
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
  bars.className = 'jev-bars';
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
  wireLongPress(article, col, junk.length ? () => block(article) : () => triple(article, col));
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
  let timer = null, fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; col.classList.remove('jev-hold'); };
  col.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    fired = false;
    col.classList.add('jev-hold');
    timer = setTimeout(() => { timer = null; fired = true; col.classList.remove('jev-hold'); col.classList.remove('jev-boom'); void col.offsetWidth; col.classList.add('jev-boom'); action(); }, HOLD_MS);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) col.addEventListener(ev, cancel);
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

// Only turns things on: an already-liked / reposted / bookmarked post is left as is.
async function triple(article, col) {
  const q = sel => article.querySelector(sel);
  q('[data-testid="bookmark"]')?.click();
  await sleep(150);
  q('[data-testid="like"]')?.click();
  await sleep(150);
  const rt = q('[data-testid="retweet"]');
  if (rt) { rt.click(); (await waitFor('[data-testid="retweetConfirm"]'))?.click(); }
}

// ---- Timeline filter: a matched post is faded to 50% and comes back on hover. ----
function applyFilter(article, answers, settings, reasons) {
  const lang = settings.lang || uiLang;
  const reason = reasons.map(k => `${LABELS[k][lang]} ${pct(answers[k])}`).join(' · ');
  article.classList.add('jev-dim');
  article.title = JEV_I18N.t('filtered', lang, { r: reason });
  // Show why, in the badge row, so a rule on a hidden tag (e.g. "ignored") is not a mystery.
  const why = document.createElement('span');
  why.className = 'jev-why';
  why.textContent = JEV_I18N.t('filtered', lang, { r: reason });
  article.querySelector('.jev-radar')?.insertBefore(why, article.querySelector('.jev-foot'));
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

const panels = new WeakMap();
function draftPanel(box) {
  let panel = panels.get(box);
  if (panel && panel.isConnected) return panel;
  panel = document.createElement('div');
  panel.className = 'jev-draft';
  // Walk up until an ancestor that also contains the composer toolbar, then insert the panel right above that toolbar.
  let node = box, toolbar = null;
  while (node && node !== document.body) { toolbar = node.querySelector?.('[data-testid="toolBar"]'); if (toolbar) break; node = node.parentElement; }
  if (toolbar) toolbar.insertAdjacentElement('beforebegin', panel); else box.parentElement.appendChild(panel);
  panels.set(box, panel);
  return panel;
}

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
  for (const box of document.querySelectorAll('[data-testid^="tweetTextarea_"][contenteditable="true"]')) wireComposer(box);
}

function renderNote(article, text) {
  const textEl = article.querySelector('[data-testid="tweetText"]');
  if (!textEl || article.querySelector('.jev-radar')) return;
  const row = document.createElement('div');
  row.className = 'jev-radar jev-note';
  row.textContent = text;
  textEl.insertAdjacentElement('afterend', row);
}

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
}, { threshold: 0.4 });

function scan() {
  for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
    if (seen.has(a)) continue;
    seen.add(a);
    io.observe(a);
  }
}
new MutationObserver(() => { scan(); scanComposers(); }).observe(document.body, { childList: true, subtree: true });
scan(); scanComposers();
