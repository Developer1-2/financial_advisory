(() => {
  'use strict';

  const DATA_URL = '../json/glossary.json';
  const FUZZY_MIN_LENGTH = 3;
  const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

  const $ = id => document.getElementById(id);
  const listEl = $('glossaryList');
  const searchEl = $('glossarySearch');
  const clearEl = $('glossaryClear');
  const filtersEl = $('glossaryFilters');
  const azEl = $('azBar');
  const countEl = $('glossaryCount');
  if (!listEl || !searchEl || !azEl) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = { terms: [], bySlug: new Map(), byName: new Map(), query: '', category: '' };
  let headerH = 0;
  let lastCurrent = null;

  /* ---------------- Text helpers ---------------- */
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const fold = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const compact = s => fold(s).replace(/[^a-z0-9]/g, '');
  const slugify = s => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const groupId = L => (L === '#' ? 'az-num' : `az-${L}`);

  function letterOf(term) {
    const c = fold(term).trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 3;       // clearly too different
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = row;
    }
    return prev[b.length];
  }

  function highlight(text, tokens) {
    const s = String(text ?? '');
    if (!tokens.length) return esc(s);
    const parts = [...tokens].filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!parts.length) return esc(s);
    const re = new RegExp(`(${parts.join('|')})`, 'gi');
    return s.split(re).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
  }

  /* ---------------- Data ---------------- */
  function prepare(raw) {
    const list = Array.isArray(raw) ? raw : raw && raw.terms;
    if (!Array.isArray(list)) throw new Error('glossary.json must be an array of terms (or {"terms": [...]})');

    const seen = new Set();
    const out = [];

    list.forEach((item, i) => {
      const term = String(item?.term ?? '').trim();
      const definition = String(item?.definition ?? '').trim();
      if (!term || !definition) {
        console.warn(`glossary.json: entry #${i + 1} skipped (it needs both "term" and "definition")`, item);
        return;
      }

      let slug = slugify(item.slug || term) || `term-${i + 1}`;
      if (seen.has(slug)) {
        console.warn(`glossary.json: duplicate term "${term}". Renaming its link.`);
        let n = 2;
        while (seen.has(`${slug}-${n}`)) n++;
        slug = `${slug}-${n}`;
      }
      seen.add(slug);

      const aliases = Array.isArray(item.aliases) ? item.aliases.map(String) : [];
      const t = {
        term,
        slug,
        fullName: String(item.fullName ?? '').trim(),
        definition,
        example: String(item.example ?? '').trim(),
        category: String(item.category ?? '').trim(),
        related: Array.isArray(item.related) ? item.related.map(String) : [],
        aliases,
        letter: letterOf(term)
      };

      t.hay = {
        name: fold(`${term} ${t.fullName}`),
        alias: fold(aliases.join(' ')),
        def: fold(`${definition} ${t.example}`)
      };
      t.compactAll = compact(`${term} ${t.fullName} ${aliases.join(' ')}`);
      t.fuzzyKeys = [term, t.fullName, ...aliases].filter(Boolean).map(compact);
      t.fuzzyWords = fold(`${term} ${t.fullName} ${aliases.join(' ')}`)
        .split(/[^a-z0-9]+/).filter(w => w.length >= 3);

      out.push(t);
    });

    out.sort((a, b) => a.term.localeCompare(b.term, 'en', {
      sensitivity: 'base', numeric: true, ignorePunctuation: true
    }));

    state.bySlug = new Map(out.map(t => [t.slug, t]));
    state.byName = new Map();
    out.forEach(t => {
      [t.term, t.fullName, ...t.aliases].filter(Boolean).forEach(n => {
        if (!state.byName.has(fold(n))) state.byName.set(fold(n), t);
      });
    });

    out.forEach(t => t.related.forEach(name => {
      if (!state.byName.has(fold(name))) console.warn(`glossary.json: "${t.term}" lists "${name}" as related, but no such term exists.`);
    }));

    return out;
  }

  /* ---------------- Search ---------------- */
  const tokensOf = q => fold(q).split(/\s+/).filter(Boolean);

  function matches(t, tokens) {
    return tokens.every(tok => {
      if (t.hay.name.includes(tok) || t.hay.alias.includes(tok) || t.hay.def.includes(tok)) return true;
      const c = compact(tok);
      return c.length > 1 && t.compactAll.includes(c);
    });
  }

  function fuzzyMatches(query, pool) {
    const q = compact(query);
    if (q.length < FUZZY_MIN_LENGTH) return [];
    const max = q.length <= 4 ? 1 : 2;
    return pool.filter(t =>
      t.fuzzyKeys.some(k => levenshtein(q, k) <= max) ||
      t.fuzzyWords.some(w => levenshtein(q, w) <= max)
    );
  }

  function compute() {
    const tokens = tokensOf(state.query);
    let list = state.terms.filter(t => !state.category || t.category === state.category);
    let fuzzy = false;

    if (tokens.length) {
      const exact = list.filter(t => matches(t, tokens));
      if (exact.length) {
        list = exact;
      } else {
        const close = fuzzyMatches(state.query, list);
        if (close.length) { list = close; fuzzy = true; } else { list = []; }
      }
    }
    return { list, tokens: fuzzy ? [] : tokens, fuzzy };
  }

  /* ---------------- Rendering ---------------- */
  function relatedHtml(t) {
    const seen = new Set();
    const links = t.related
      .map(name => state.byName.get(fold(name)))
      .filter(r => r && r !== t && !seen.has(r.slug) && seen.add(r.slug));
    if (!links.length) return '';
    return `<p class="entry-related"><span class="entry-related-label">See also:</span>${
      links.map(r => `<a href="#${esc(r.slug)}" data-goto="${esc(r.slug)}">${esc(r.term)}</a>`).join('')
    }</p>`;
  }

  function entryHtml(t, tokens) {
    const h = s => highlight(s, tokens);
    return `
      <div class="glossary-entry" id="${esc(t.slug)}">
        <dt class="entry-term">${h(t.term)}${t.fullName ? `<span class="entry-full">${h(t.fullName)}</span>` : ''}</dt>
        <dd class="entry-body">
          <p class="entry-def">${h(t.definition)}</p>
          ${t.example ? `<p class="entry-example"><strong>Example:</strong> ${h(t.example)}</p>` : ''}
          ${relatedHtml(t)}
          <div class="entry-foot">
            ${t.category ? `<span class="card-tag">${esc(t.category)}</span>` : ''}
            <button type="button" class="entry-copy" data-slug="${esc(t.slug)}">Copy link</button>
          </div>
        </dd>
      </div>`;
  }

  function groupHtml(letter, items, tokens) {
    const id = groupId(letter);
    return `
      <section class="glossary-group" id="${id}" data-letter="${letter}" aria-labelledby="${id}-h">
        <h2 class="glossary-letter" id="${id}-h">${letter}</h2>
        <dl class="glossary-entries">${items.map(t => entryHtml(t, tokens)).join('')}</dl>
      </section>`;
  }

  function emptyHtml() {
    const q = state.query.trim();
    return `
      <div class="glossary-empty">
        <p><strong>No terms found</strong>${q ? ` for “${esc(q)}”` : ''}.</p>
        <p>Try a shorter word, check the spelling, or browse by letter.</p>
        <button type="button" class="btn btn-primary" data-clear>Clear search</button>
      </div>`;
  }

  function skeletonHtml() {
    const row = `<div><span class="sk sk-title"></span><span class="sk"></span><span class="sk sk-mid"></span></div>`;
    return `<div class="glossary-skeleton" aria-hidden="true">${row.repeat(5)}</div>`;
  }

  function errorHtml() {
    const hint = location.protocol === 'file:'
      ? '<p>Tip: browsers block loading data files when a page is opened directly from disk. Open it through a local server instead.</p>'
      : '';
    return `
      <div class="glossary-error">
        <p>We couldn’t load the glossary right now.</p>
        ${hint}
        <button type="button" class="btn btn-primary" data-retry>Try again</button>
      </div>`;
  }

  function renderAz(present) {
    const hasNumbers = state.terms.some(t => t.letter === '#');
    azEl.innerHTML = `<div class="az-scroll">${
      LETTERS.filter(L => L !== '#' || hasNumbers).map(L => present.has(L)
        ? `<a class="az-letter" href="#${groupId(L)}" data-letter="${L}">${L}</a>`
        : `<span class="az-letter is-empty" aria-disabled="true">${L}</span>`).join('')
    }</div>`;
  }

  function renderCount(n, fuzzy) {
    const total = state.terms.length;
    const q = state.query.trim();
    let msg;
    if (!n) msg = 'No terms found';
    else if (fuzzy) msg = `No exact matches for “${q}”. Showing ${n} close ${n === 1 ? 'match' : 'matches'}.`;
    else if (q || state.category) msg = `Showing ${n} of ${total} terms`;
    else msg = `${total} terms, A to Z`;
    countEl.textContent = msg;
  }

  function render() {
    const { list, tokens, fuzzy } = compute();

    const groups = new Map();
    list.forEach(t => {
      if (!groups.has(t.letter)) groups.set(t.letter, []);
      groups.get(t.letter).push(t);
    });

    listEl.innerHTML = list.length
      ? [...groups].map(([L, items]) => groupHtml(L, items, tokens)).join('')
      : emptyHtml();
    listEl.removeAttribute('aria-busy');

    renderAz(new Set(groups.keys()));
    renderCount(list.length, fuzzy);
    measure();
    lastCurrent = null;
    updateCurrent();
  }

  function renderFilters() {
    const cats = [...new Set(state.terms.map(t => t.category).filter(Boolean))].sort();
    if (cats.length < 2) { filtersEl.hidden = true; return; }
    filtersEl.innerHTML = ['', ...cats].map(c =>
      `<button type="button" class="cat-pill" data-cat="${esc(c)}" aria-pressed="${state.category === c}">${c ? esc(c) : 'All'}</button>`
    ).join('');
    filtersEl.hidden = false;
  }

  function syncFilterUi() {
    filtersEl.querySelectorAll('[data-cat]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.cat === state.category)));
    clearEl.hidden = !searchEl.value;
  }

  /* ---------------- URL ---------------- */
  function queryString() {
    const p = new URLSearchParams();
    if (state.query.trim()) p.set('q', state.query.trim());
    if (state.category) p.set('topic', state.category);
    const s = p.toString();
    return s ? `?${s}` : '';
  }

  function syncUrl() {
    try { history.replaceState(null, '', location.pathname + queryString()); } catch (_) { /* ignore */ }
  }

  function setHash(id) {
    try { history.pushState(null, '', `${location.pathname}${queryString()}#${id}`); } catch (_) { /* ignore */ }
  }

  /* ---------------- Navigation ---------------- */
  let flashTimer = null;

  function goTo(id, { push = false } = {}) {
    let el = document.getElementById(id);

    // Target is hidden by the current search/topic: reset filters so it can be shown
    if (!el && state.bySlug.has(id)) {
      state.query = '';
      state.category = '';
      searchEl.value = '';
      syncFilterUi();
      render();
      el = document.getElementById(id);
    }
    if (!el) return;

    if (push) setHash(id);
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });

    if (el.classList.contains('glossary-entry')) {
      listEl.querySelectorAll('.is-target').forEach(n => n.classList.remove('is-target'));
      el.classList.add('is-target');
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => el.classList.remove('is-target'), 3000);
    }
  }

  async function copyLink(btn) {
    const url = `${location.href.split(/[?#]/)[0]}#${btn.dataset.slug}`;
    let label = 'Copied!';
    try {
      await navigator.clipboard.writeText(url);
    } catch (_) {
      location.hash = btn.dataset.slug;          // fallback: the link is now in the address bar
      label = 'Link in address bar';
    }
    btn.textContent = label;
    setTimeout(() => { btn.textContent = 'Copy link'; }, 1800);
  }

  /* ---------------- Sticky offsets + scroll-spy ---------------- */
  function measure() {
    const header = document.querySelector('.site-header');
    const root = document.documentElement;
    headerH = header ? header.offsetHeight : 0;
    root.style.setProperty('--header-h', `${headerH}px`);
    root.style.setProperty('--azbar-h', `${azEl.offsetHeight}px`);
  }

  function updateCurrent() {
    const offset = headerH + azEl.offsetHeight + 24;
    let current = null;
    listEl.querySelectorAll('.glossary-group').forEach(g => {
      if (g.getBoundingClientRect().top <= offset) current = g.dataset.letter;
    });

    azEl.querySelectorAll('a.az-letter').forEach(a => {
      const on = a.dataset.letter === current;
      a.classList.toggle('is-current', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });

    if (current !== lastCurrent) {
      lastCurrent = current;
      const scroller = azEl.querySelector('.az-scroll');
      const cur = azEl.querySelector('a.is-current');
      if (scroller && cur && scroller.scrollWidth > scroller.clientWidth) {
        scroller.scrollLeft = cur.offsetLeft - scroller.clientWidth / 2 + cur.offsetWidth / 2;
      }
    }
  }

  /* ---------------- SEO: structured data ---------------- */
  function addStructuredData() {
    const base = location.href.split(/[?#]/)[0];
    const data = {
      '@context': 'https://schema.org',
      '@type': 'DefinedTermSet',
      name: 'Financial Glossary',
      hasDefinedTerm: state.terms.map(t => ({
        '@type': 'DefinedTerm',
        name: t.term,
        description: t.definition,
        url: `${base}#${t.slug}`
      }))
    };
    let tag = document.getElementById('glossaryJsonLd');
    if (!tag) {
      tag = document.createElement('script');
      tag.type = 'application/ld+json';
      tag.id = 'glossaryJsonLd';
      document.head.appendChild(tag);
    }
    tag.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  }

  /* ---------------- Back to top ---------------- */
  const toTop = document.createElement('button');
  toTop.type = 'button';
  toTop.className = 'to-top';
  toTop.setAttribute('aria-label', 'Back to top');
  toTop.textContent = '↑';
  toTop.hidden = true;
  document.body.appendChild(toTop);
  toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

  /* ---------------- Loading ---------------- */
  async function load() {
    listEl.setAttribute('aria-busy', 'true');
    listEl.innerHTML = skeletonHtml();
    countEl.textContent = '';

    try {
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.terms = prepare(await res.json());
      if (!state.terms.length) throw new Error('The glossary file has no valid terms.');
    } catch (err) {
      console.error('Glossary failed to load:', err);
      listEl.innerHTML = errorHtml();
      listEl.removeAttribute('aria-busy');
      azEl.innerHTML = '';
      return;
    }

    const params = new URLSearchParams(location.search);
    const topic = params.get('topic') || '';
    state.category = state.terms.some(t => t.category === topic) ? topic : '';
    state.query = params.get('q') || '';
    searchEl.value = state.query;

    renderFilters();
    syncFilterUi();
    render();
    addStructuredData();

    if (location.hash.length > 1) goTo(decodeURIComponent(location.hash.slice(1)));
  }

  /* ---------------- Events ---------------- */
  let debounce = null;
  searchEl.addEventListener('input', () => {
    clearEl.hidden = !searchEl.value;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.query = searchEl.value;
      syncUrl();
      if (state.terms.length) render();
    }, 80);
  });

  searchEl.addEventListener('keydown', e => {
    if (e.key === 'Escape' && searchEl.value) { e.preventDefault(); clearSearch(); }
  });

  function clearSearch() {
    searchEl.value = '';
    state.query = '';
    syncFilterUi();
    syncUrl();
    if (state.terms.length) render();
    searchEl.focus();
  }

  clearEl.addEventListener('click', clearSearch);

  filtersEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    state.category = btn.dataset.cat;
    syncFilterUi();
    syncUrl();
    render();
  });

  listEl.addEventListener('click', e => {
    const jump = e.target.closest('[data-goto]');
    if (jump) { e.preventDefault(); goTo(jump.dataset.goto, { push: true }); return; }

    const copy = e.target.closest('.entry-copy');
    if (copy) { copyLink(copy); return; }

    if (e.target.closest('[data-clear]')) { clearSearch(); return; }
    if (e.target.closest('[data-retry]')) load();
  });

  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (state.bySlug.has(id)) goTo(id);
  });

  // "/" focuses the search box, like many docs sites
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t.matches && t.matches('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    searchEl.focus();
    searchEl.select();
  });

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        updateCurrent();
        toTop.hidden = window.scrollY < 700;
        ticking = false;
      });
    }
  }, { passive: true });

  window.addEventListener('resize', () => { measure(); updateCurrent(); });

  measure();
  load();
})();
