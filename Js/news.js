(() => {
  'use strict';

  /* ---------------- Configuration ---------------- */
  const CONFIG = {
    // Change to your deployed server URL when you go live, e.g. 'https://api.yoursite.com'
    API_BASE: 'http://localhost:3000',
    CATEGORY: 'general',          // general | forex | crypto | merger
    ADS_EVERY: 2,                 // insert an ad after every N articles
    ADSENSE: {
      client: '',                 // e.g. 'ca-pub-1234567890123456'  (ads stay off while this is empty)
      slot: '',                   // your in-feed ad slot ID
      layoutKey: '-fb+5w+4e-db+86'
    }
  };

  const CATEGORY_LABELS = {
    general: 'Markets',
    forex: 'Forex',
    crypto: 'Crypto',
    merger: 'M&A'
  };

  /* ---------------- Helpers ---------------- */
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  // Only allow http(s) links; optionally upgrade http images to https (avoids mixed-content blocking)
  function safeUrl(url, { upgrade = false } = {}) {
    if (!url || !/^https?:\/\//i.test(url)) return '';
    return upgrade ? url.replace(/^http:\/\//i, 'https://') : url;
  }

  function formatTime(iso) {
    const date = new Date(iso);
    if (isNaN(date)) return 'Recent';

    const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
    if (diffSec >= -60) return 'Just now';          // also covers small clock differences

    const abs = Math.abs(diffSec);
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
    if (abs < 7 * 86400) return rtf.format(Math.round(diffSec / 86400), 'day');

    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /* ---------------- Markup builders ---------------- */
  function skeletonHtml(count = 4) {
    const card = `
      <article class="news-item skeleton" aria-hidden="true">
        <div class="news-media"></div>
        <div class="news-body">
          <span class="sk-line sk-short"></span>
          <span class="sk-line"></span>
          <span class="sk-line"></span>
          <span class="sk-line sk-mid"></span>
        </div>
      </article>`;
    return card.repeat(count);
  }

  function cardHtml(article) {
    const url = escapeHtml(safeUrl(article.url));
    const imageUrl = safeUrl(article.bannerImage, { upgrade: true });
    const source = article.source || 'News';
    const initial = escapeHtml(source.trim().charAt(0).toUpperCase() || 'N');
    const label = CATEGORY_LABELS[article.category] || 'Markets';

    const imageTag = imageUrl
      ? `<img class="news-thumb" src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : '';

    const summary = article.summary
      ? `<p>${escapeHtml(article.summary)}</p>`
      : '';

    return `
      <article class="news-item">
        <a class="news-media${imageUrl ? '' : ' no-image'}" href="${url}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">
          ${imageTag}
          <span class="news-placeholder">${initial}</span>
        </a>
        <div class="news-body">
          <div class="news-source">${escapeHtml(source)}</div>
          <h4><a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)} ↗</a></h4>
          ${summary}
          <div class="news-meta">${escapeHtml(formatTime(article.timePublished))} · ${escapeHtml(label)}</div>
        </div>
      </article>`;
  }

  function adHtml() {
    const { client, slot, layoutKey } = CONFIG.ADSENSE;
    return `
      <div class="ad-slot-wrapper">
        <ins class="adsbygoogle"
             style="display:block"
             data-ad-format="fluid"
             data-ad-layout-key="${escapeHtml(layoutKey)}"
             data-ad-client="${escapeHtml(client)}"
             data-ad-slot="${escapeHtml(slot)}"></ins>
      </div>`;
  }

  const adsEnabled = () => Boolean(CONFIG.ADSENSE.client && CONFIG.ADSENSE.slot);

  // Loads the AdSense library once (skipped if you already added it to <head>)
  function ensureAdSenseScript() {
    if (document.querySelector('script[src*="adsbygoogle.js"]')) return;
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CONFIG.ADSENSE.client)}`;
    document.head.appendChild(s);
  }

  /* ---------------- Main ---------------- */
  async function loadMarketNews() {
    const feed = document.getElementById('newsFeed');
    if (!feed) return;

    feed.setAttribute('aria-busy', 'true');
    feed.innerHTML = skeletonHtml();

    try {
      const response = await fetch(
        `${CONFIG.API_BASE}/api/financial-news?category=${encodeURIComponent(CONFIG.CATEGORY)}`
      );
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

      const payload = await response.json();
      const articles = (payload.articles || []).filter(a => a && a.title && safeUrl(a.url));
      if (!articles.length) throw new Error('No articles returned');

      let html = '';
      articles.forEach((article, index) => {
        html += cardHtml(article);
        if (adsEnabled() && (index + 1) % CONFIG.ADS_EVERY === 0) html += adHtml();
      });

      feed.innerHTML = html;

      // If an image fails to load, swap to the placeholder instead of showing a broken icon
      feed.querySelectorAll('.news-thumb').forEach(img => {
        const markBroken = () => img.closest('.news-media')?.classList.add('no-image');
        img.addEventListener('error', markBroken, { once: true });
        if (img.complete && img.naturalWidth === 0) markBroken();
      });

      // <script> tags inside innerHTML never run, so activate ad slots from here
      if (adsEnabled()) {
        ensureAdSenseScript();
        feed.querySelectorAll('ins.adsbygoogle').forEach(() => {
          try { (window.adsbygoogle = window.adsbygoogle || []).push({}); }
          catch (err) { console.warn('AdSense slot failed to initialise:', err); }
        });
      }
    } catch (error) {
      console.error('Error loading market news:', error);
      feed.innerHTML = `
        <div class="news-error">
          <p>We couldn’t load the latest headlines right now.</p>
          <button type="button" data-news-retry>Try again</button>
        </div>`;
    } finally {
      feed.removeAttribute('aria-busy');
    }
  }

  function init() {
    const feed = document.getElementById('newsFeed');
    if (!feed) return;
    feed.addEventListener('click', event => {
      if (event.target.closest('[data-news-retry]')) loadMarketNews();
    });
    loadMarketNews();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
