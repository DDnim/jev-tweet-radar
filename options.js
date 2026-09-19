const TAG_ORDER = ['buzz', 'flame', 'ignored', 'misread', 'repost', 'bookmark', 'ai_smell'];
const TAG_LABEL = { buzz: 'バズる', flame: '炎上', ignored: 'スルー', misread: '誤解', repost: 'リポスト価値', bookmark: '保存価値', ai_smell: 'AI臭' };
const DEFAULTS = { apiKey: '', enabled: true, lang: 'ja', threshold: 0.5, maxPerMinute: 120, tags: ['buzz', 'misread', 'repost', 'bookmark', 'ai_smell'] };
for (const t of TAG_ORDER) { const l = document.createElement('label'); l.style.fontWeight = '400'; l.style.margin = '0'; l.innerHTML = `<input type="checkbox" data-tag="${t}"> ${TAG_LABEL[t]}`; document.getElementById('tags').appendChild(l); }
const selectedTags = () => [...document.querySelectorAll('#tags input')].filter(i => i.checked).map(i => i.dataset.tag);
const $ = id => document.getElementById(id);
chrome.storage.sync.get(DEFAULTS, s => { $('apiKey').value = s.apiKey; $('lang').value = s.lang; $('threshold').value = s.threshold; $('maxPerMinute').value = s.maxPerMinute; $('enabled').checked = s.enabled; for (const i of document.querySelectorAll('#tags input')) i.checked = s.tags.includes(i.dataset.tag); });
$('save').onclick = () => chrome.storage.sync.set({ apiKey: $('apiKey').value.trim(), lang: $('lang').value, threshold: +$('threshold').value, maxPerMinute: +$('maxPerMinute').value, enabled: $('enabled').checked, tags: selectedTags() }, () => { $('msg').textContent = '保存しました'; setTimeout(() => $('msg').textContent = '', 1500); });
$('clear').onclick = async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter(k => k.startsWith('r:'))); $('msg').textContent = 'キャッシュを消去しました'; };
