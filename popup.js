const day = new Date().toISOString().slice(0, 10);
chrome.storage.sync.get({ enabled: true, lang: '' }, s => {
  const lang = s.lang || JEV_I18N.detect();
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = JEV_I18N.t(el.dataset.i18n, lang);
  document.getElementById('enabled').checked = s.enabled;
  chrome.storage.local.get('stats', ({ stats = {} }) => {
    const d = stats[day] || { calls: 0, input_tokens: 0, output_tokens: 0 };
    document.getElementById('calls').textContent = d.calls;
    document.getElementById('tok').textContent = d.input_tokens;
    document.getElementById('cost').textContent = (d.input_tokens * 0.042 / 1e6).toFixed(5);
    const all = Object.values(stats).reduce((a, x) => a + x.calls, 0);
    document.getElementById('total').textContent = JEV_I18N.t('total', lang, { n: all });
  });
});
document.getElementById('enabled').onchange = e => chrome.storage.sync.set({ enabled: e.target.checked });
document.getElementById('opt').onclick = e => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
