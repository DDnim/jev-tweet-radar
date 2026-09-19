const DEFAULTS = { apiKey: '', enabled: true, lang: 'ja', threshold: 0.5, maxPerMinute: 120 };
const $ = id => document.getElementById(id);
chrome.storage.sync.get(DEFAULTS, s => { $('apiKey').value = s.apiKey; $('lang').value = s.lang; $('threshold').value = s.threshold; $('maxPerMinute').value = s.maxPerMinute; $('enabled').checked = s.enabled; });
$('save').onclick = () => chrome.storage.sync.set({ apiKey: $('apiKey').value.trim(), lang: $('lang').value, threshold: +$('threshold').value, maxPerMinute: +$('maxPerMinute').value, enabled: $('enabled').checked }, () => { $('msg').textContent = '保存しました'; setTimeout(() => $('msg').textContent = '', 1500); });
$('clear').onclick = async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter(k => k.startsWith('r:'))); $('msg').textContent = 'キャッシュを消去しました'; };
