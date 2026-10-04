(() => {
  'use strict';

  const API_BASE = (window.QW_CONFIG && window.QW_CONFIG.API_BASE) || 'http://localhost:3000';
  const REFRESH_MS = 60 * 1000;   // matches the server's 1-minute cache
  const SPEED_PX_PER_SEC = 55;    // scroll speed

  const section = document.getElementById('stockTicker');
  const track = document.getElementById('tickerTrack');
  const pauseBtn = document.getElementById('tickerPause');
  if (!section || !track) return;

  const priceFmt = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2
  });

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  // Direction is shown with an arrow as well as colour, so it works for colour-blind visitors
  function direction(pct) {
    if (pct > 0) return { cls: 'up', arrow: '▲', sign: '+' };
    if (pct < 0) return { cls: 'down', arrow: '▼', sign: '−' };
    return { cls: 'flat', arrow: '■', sign: '' };
  }

  function changeHtml(q) {
    const d = direction(q.changePercent);
    const pct = Math.abs(q.changePercent).toFixed(2);
    return `<span class="t-arrow" aria-hidden="true">${d.arrow}</span>${d.sign}${pct}%`;
  }

  function itemHtml(q, hidden) {
    const d = direction(q.changePercent);
    return `
      <div class="ticker-item" data-symbol="${esc(q.symbol)}"${hidden ? ' aria-hidden="true"' : ''}>
        <span class="t-symbol">${esc(q.symbol)}</span>
        <span class="t-name">${esc(q.name)}</span>
        <span class="t-price">${priceFmt.format(q.price)}</span>
        <span class="t-change ${d.cls}">${changeHtml(q)}</span>
      </div>`;
  }

  function skeletonHtml() {
    const item = `<div class="ticker-item is-loading"><span class="sk"></span><span class="sk"></span></div>`;
    return item.repeat(8);
  }

  async function fetchQuotes() {
    const res = await fetch(`${API_BASE}/api/quotes`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { quotes } = await res.json();
    if (!Array.isArray(quotes) || !quotes.length) throw new Error('No quotes');
    return quotes;
  }

  // First render: two identical copies make the loop seamless (animation moves -50%)
  function render(quotes) {
    const set = quotes.map(q => itemHtml(q, false)).join('');
    const copy = quotes.map(q => itemHtml(q, true)).join('');
    track.innerHTML = set + copy;

    // Duration depends on content width, so speed feels the same on every screen
    requestAnimationFrame(() => {
      const half = track.scrollWidth / 2;
      track.style.setProperty('--ticker-duration', `${Math.max(20, half / SPEED_PX_PER_SEC)}s`);
    });
  }

  // Later refreshes: update numbers in place so the scroll never jumps back to the start
  function update(quotes) {
    quotes.forEach(q => {
      const d = direction(q.changePercent);
      document.querySelectorAll(`#tickerTrack .ticker-item[data-symbol="${CSS.escape(q.symbol)}"]`).forEach(item => {
        item.querySelector('.t-price').textContent = priceFmt.format(q.price);
        const change = item.querySelector('.t-change');
        change.className = `t-change ${d.cls}`;
        change.innerHTML = changeHtml(q);
      });
    });
  }

  async function init() {
    track.innerHTML = skeletonHtml();
    try {
      render(await fetchQuotes());
    } catch (err) {
      console.error('Ticker unavailable:', err);
      section.hidden = true;           // never show an error bar to visitors
      return;
    }

    setInterval(async () => {
      if (document.hidden) return;     // don't spend API calls on background tabs
      try { update(await fetchQuotes()); } catch (err) { console.warn('Ticker refresh failed:', err); }
    }, REFRESH_MS);
  }

  // Pause / play control (WCAG: moving content must be pausable)
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      const paused = section.classList.toggle('is-paused');
      pauseBtn.textContent = paused ? '▶' : '❚❚';
      pauseBtn.setAttribute('aria-label', paused ? 'Resume ticker' : 'Pause ticker');
    });
  }

  init();
})();
