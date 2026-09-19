const TAG_ORDER = ['buzz', 'flame', 'ignored', 'misread', 'repost', 'bookmark', 'ai_smell'];
const GOAL_ORDER = ['none', 'grow', 'learn', 'thrill', 'custom'];
const DEFAULTS = { apiKey: '', enabled: true, lang: '', threshold: 0.5, maxPerMinute: 120, tags: ['buzz', 'misread', 'repost', 'bookmark', 'ai_smell'], goalPreset: 'none', goalCustom: '' };
const $ = id => document.getElementById(id);
let lang = JEV_I18N.detect();
for (const [k, v] of Object.entries(JEV_I18N.langs)) $('lang').add(new Option(v, k));
for (const g of GOAL_ORDER) { const l = document.createElement('label'); l.innerHTML = `<input type="radio" name="goal" value="${g}"> <span></span>`; $('goals').appendChild(l); }
for (const t of TAG_ORDER) { const l = document.createElement('label'); l.innerHTML = `<input type="checkbox" data-tag="${t}"> <span></span>`; $('tags').appendChild(l); }
function applyLang() {
  document.documentElement.lang = lang; document.title = JEV_I18N.t('optTitle', lang);
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = JEV_I18N.t(el.dataset.i18n, lang);
  for (const l of $('goals').querySelectorAll('label')) l.querySelector('span').textContent = JEV_I18N.goal[l.querySelector('input').value][lang];
  for (const l of $('tags').querySelectorAll('label')) l.querySelector('span').textContent = JEV_I18N.tag[l.querySelector('input').dataset.tag][lang];
  $('goalCustom').placeholder = JEV_I18N.t('goalPh', lang);
}
const goalPreset = () => document.querySelector('input[name="goal"]:checked')?.value || 'none';
$('goals').addEventListener('change', () => { $('goalCustom').style.display = goalPreset() === 'custom' ? 'block' : 'none'; });
$('lang').onchange = () => { lang = $('lang').value; applyLang(); };
const selectedTags = () => [...document.querySelectorAll('#tags input')].filter(i => i.checked).map(i => i.dataset.tag);
chrome.storage.sync.get(DEFAULTS, s => {
  lang = s.lang || lang; $('lang').value = lang; applyLang();
  $('apiKey').value = s.apiKey; $('threshold').value = s.threshold; $('maxPerMinute').value = s.maxPerMinute; $('enabled').checked = s.enabled;
  for (const i of document.querySelectorAll('#tags input')) i.checked = s.tags.includes(i.dataset.tag);
  const gr = document.querySelector(`input[name="goal"][value="${s.goalPreset}"]`); if (gr) gr.checked = true;
  $('goalCustom').value = s.goalCustom || ''; $('goalCustom').style.display = s.goalPreset === 'custom' ? 'block' : 'none';
});
$('save').onclick = () => chrome.storage.sync.set({ apiKey: $('apiKey').value.trim(), lang, threshold: +$('threshold').value, maxPerMinute: +$('maxPerMinute').value, enabled: $('enabled').checked, tags: selectedTags(), goalPreset: goalPreset(), goalCustom: $('goalCustom').value.trim() }, () => { $('msg').textContent = JEV_I18N.t('saved', lang); setTimeout(() => $('msg').textContent = '', 1500); });
$('clear').onclick = async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter(k => k.startsWith('r:'))); $('msg').textContent = JEV_I18N.t('cleared', lang); };
