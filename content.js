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
  const lang = settings.lang || 'ja';
  const th = settings.threshold ?? 0.5;
  const textEl = article.querySelector('[data-testid="tweetText"]');
  if (!textEl || article.querySelector('.jev-radar')) return;
  const row = document.createElement('div');
  row.className = 'jev-radar';
  const e = answers.engage;
  const level = e == null ? 'na' : e >= 0.7 ? 'hi' : e >= th ? 'mid' : 'lo';
  const main = document.createElement('span');
  main.className = 'jev-main jev-' + level;
  main.textContent = `${LABELS.engage[lang]} ${pct(e)}`;
  main.title = 'Jev: この投稿に絡む価値があるかの確率（校正済み）';
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
  textEl.insertAdjacentElement('afterend', row);
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
new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
scan();
