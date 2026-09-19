// Scans the X timeline, asks the background worker to judge each post once it is visible, and renders a badge row.
const LABELS = {
  engage: { ja: '絡む価値', zh: '值得互动', en: 'Engage' },
  buzz: { ja: 'バズる', zh: '会火', en: 'Buzz' },
  flame: { ja: '炎上', zh: '炎上', en: 'Flame' },
  ignored: { ja: 'スルー', zh: '无人理', en: 'Ignored' },
  misread: { ja: '誤解', zh: '被误读', en: 'Misread' },
  repost: { ja: 'リポスト価値', zh: '值得转发', en: 'Repost-worthy' },
  bookmark: { ja: '保存価値', zh: '值得收藏', en: 'Bookmark-worthy' },
  ai_smell: { ja: 'AI臭', zh: 'AI 味', en: 'AI-ish' }
};
const seen = new WeakSet();

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

function pct(v) { return v == null ? '–' : Math.round(v * 100) + '%'; }

function render(article, answers, settings) {
  const textEl = article.querySelector('[data-testid="tweetText"]');
  if (!textEl || article.querySelector('.jev-radar')) return;
  const row = buildRow(answers, settings);
  textEl.insertAdjacentElement('afterend', row);
}

function buildRow(answers, settings) {
  const lang = settings.lang || 'ja';
  const th = settings.threshold ?? 0.5;
  const row = document.createElement('div');
  row.className = 'jev-radar';
  const e = answers.engage;
  const level = e == null ? 'na' : e >= 0.7 ? 'hi' : e >= th ? 'mid' : 'lo';
  const main = document.createElement('span');
  main.className = 'jev-main jev-' + level;
  main.textContent = `${LABELS.engage[lang]} ${pct(e)}`;
  main.title = settings.goalText ? 'Jev: 私の目的「' + settings.goalText.slice(0, 40) + '…」に照らした絡む価値' : 'Jev: この投稿に絡む価値があるかの確率（校正済み）';
  row.appendChild(main);
  for (const k of (settings.tags || ['buzz', 'flame', 'ignored', 'misread', 'ai_smell'])) {
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
  head.textContent = settings.lang === 'zh' ? (isReply ? '回复判定（结合原帖）· Jev' : '发帖前判定 · Jev') : settings.lang === 'en' ? (isReply ? 'Reply check (with parent) · Jev' : 'Pre-post check · Jev') : (isReply ? '返信判定（返信先を含めて）· Jev' : '投稿前判定 · Jev');
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
    renderDraftNote(box, '判定中…');
    const parent = replyTarget(box);
    const post = { id: 'draft:' + hash((parent ? parent.id + '|' : '') + text), author: 'me (draft)', text, time: new Date().toISOString(), hasMedia: false, hasLink: /https?:\/\//.test(text), isReply: !!parent, replyingTo: parent };
    chrome.runtime.sendMessage({ type: 'judge', post }, res => {
      if (chrome.runtime.lastError || !res) return;
      if (box.innerText.replace(/\u200b/g, '').trim() !== text) return; // stale
      if (res.answers) { draftPanel(box).dataset.reply = parent ? '1' : '0'; renderDraft(box, res.answers, res.settings || {}, text); }
      else if (res.error === 'no_key') renderDraftNote(box, 'Jev Tweet Radar: API キー未設定');
      else if (res.error) renderDraftNote(box, 'Jev: ' + res.error);
      else if (res.skipped === 'rate') renderDraftNote(box, 'Jev: 判定上限、少し待ってください');
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
    chrome.runtime.sendMessage({ type: 'judge', post }, res => {
      if (chrome.runtime.lastError || !res) return;
      if (res.answers) render(article, res.answers, res.settings || {});
      else if (res.error === 'no_key') renderNote(article, 'Jev Tweet Radar: API キー未設定（拡張機能のオプションで設定）');
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
