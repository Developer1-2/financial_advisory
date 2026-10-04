#!/usr/bin/env node
/* ==========================================================
   build-page.js: turns a content JSON file into a finished HTML page.

   Usage:   node build-page.js investing.json
   Output:  <slug>.html next to the JSON file (e.g. investing.html)

   Why a build step? The finished page contains all the text, headings and
   structured data in plain HTML, so Google and AI crawlers can read it without
   running JavaScript. Edit the JSON, run the command, upload the HTML.
   No packages needed, just Node.
   ========================================================== */

const fs = require('fs');
const path = require('path');

const input = process.argv[2];
if (!input) { console.error('Usage: node build-page.js <content.json>'); process.exit(1); }

const dir = path.dirname(path.resolve(input));
const page = JSON.parse(fs.readFileSync(input, 'utf8'));
const warnings = [];
const warn = m => warnings.push(m);

for (const key of ['slug', 'title', 'metaTitle', 'metaDescription', 'sections']) {
  if (!page[key]) { console.error(`Missing "${key}" in ${input}`); process.exit(1); }
}

/* ---------------- helpers ---------------- */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const slugify = s => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');   // same rule as glossary.js
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

/* ---------------- glossary lookup (for internal links) ---------------- */
const glossaryNames = new Map();
const glossaryPath = path.join(dir, 'glossary.json');
if (fs.existsSync(glossaryPath)) {
  const raw = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
  (Array.isArray(raw) ? raw : raw.terms).forEach(t => {
    const slug = slugify(t.slug || t.term);
    [t.term, t.fullName, ...(t.aliases || [])].filter(Boolean).forEach(n => {
      if (!glossaryNames.has(fold(n))) glossaryNames.set(fold(n), { slug, term: t.term });
    });
  });
} else {
  warn('glossary.json not found next to the content file, so glossary links are plain text.');
}
const glossaryHref = term => {
  const hit = glossaryNames.get(fold(term));
  if (!hit) { warn(`Glossary term not found: "${term}"`); return null; }
  return { href: `glossary.html#${hit.slug}`, term: hit.term };
};

/* ---------------- inline markup: **bold**, [text](url), {{glossary:Term|label}} ---------------- */
const TOKEN = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\{\{glossary:([^}|]+?)(?:\|([^}]+?))?\}\}/g;

function inline(text) {
  const re = new RegExp(TOKEN.source, 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out += `<strong>${inline(m[1])}</strong>`;
    } else if (m[2] !== undefined) {
      if (/^https?:\/\//i.test(m[3])) out += `<a href="${esc(m[3])}" target="_blank" rel="noopener">${esc(m[2])}</a>`;
      else if (/^[\w./#?=&-]+$/.test(m[3])) out += `<a href="${esc(m[3])}">${esc(m[2])}</a>`;
      else out += esc(m[2]);
    } else {
      const label = (m[5] || m[4]).trim();
      const g = glossaryHref(m[4].trim());
      out += g ? `<a class="term-link" href="${esc(g.href)}">${esc(label)}</a>` : esc(label);
    }
    last = re.lastIndex;
  }
  return out + esc(text.slice(last));
}

function plain(text) {
  return String(text).replace(new RegExp(TOKEN.source, 'g'), (_, bold, label, _url, term, alt) => bold ?? label ?? (alt || term)).trim();
}

/* ---------------- content blocks ---------------- */
const usedIds = new Set();
function uniqueId(base) {
  let id = base, n = 2;
  while (usedIds.has(id)) id = `${base}-${n++}`;
  usedIds.add(id);
  return id;
}

function blockHtml(b, sectionId) {
  switch (b.type) {
    case 'p':
      return `<p>${inline(b.text)}</p>`;
    case 'h3':
      return `<h3 id="${uniqueId(`${sectionId}-${slugify(plain(b.text))}`)}">${inline(b.text)}</h3>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag}>${b.items.map(i => `<li>${inline(i)}</li>`).join('')}</${tag}>`;
    }
    case 'table': {
      const head = b.headers.map(h => h
        ? `<th scope="col">${inline(h)}</th>`
        : '<th scope="col"><span class="sr-only">Item</span></th>').join('');
      const rows = b.rows.map(r =>
        `<tr><th scope="row">${inline(r[0])}</th>${r.slice(1).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      return `<div class="table-wrap" role="region" aria-label="${esc(plain(b.caption))}" tabindex="0">
        <table><caption>${inline(b.caption)}</caption><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    }
    case 'note':
      return `<aside class="guide-note is-${esc(b.variant || 'note')}">
        <p class="guide-note-title">${inline(b.title)}</p>
        <p>${inline(b.text)}</p>
      </aside>`;
    default:
      warn(`Unknown block type "${b.type}" in section ${sectionId}`);
      return '';
  }
}

function sectionHtml(s, i) {
  usedIds.add(s.id);
  const out = [];
  out.push(`<section class="guide-section" id="${esc(s.id)}" aria-labelledby="${esc(s.id)}-title">`);
  out.push(`<h2 id="${esc(s.id)}-title"><span class="guide-num" aria-hidden="true">${i + 1}</span>${esc(s.title)}</h2>`);
  out.push(`<p class="guide-answer">${inline(s.answer)}</p>`);
  (s.blocks || []).forEach(b => out.push(blockHtml(b, s.id)));

  if (s.inUganda) {
    out.push(`<aside class="guide-local" aria-label="${esc(s.inUganda.title)}">
      <p class="guide-local-title">${esc(s.inUganda.title)}</p>
      ${s.inUganda.blocks.map(b => blockHtml(b, s.id)).join('')}
    </aside>`);
  }

  if (s.takeaways?.length) {
    out.push(`<div class="guide-takeaways"><h3>Key takeaways</h3><ul>${s.takeaways.map(t => `<li>${inline(t)}</li>`).join('')}</ul></div>`);
  }

  if (s.faqs?.length) {
    out.push(`<div class="guide-faq"><h3>Common questions</h3>${
      s.faqs.map(f => `<details><summary>${inline(f.q)}</summary><p>${inline(f.a)}</p></details>`).join('')
    }</div>`);
  }

  if (s.terms?.length) {
    const links = s.terms.map(t => {
      const g = glossaryHref(t);
      return g ? `<a class="term-link" href="${esc(g.href)}">${esc(g.term)}</a>` : esc(t);
    });
    out.push(`<p class="guide-terms"><span>Terms in this section:</span> ${links.join(' · ')}</p>`);
  }
  out.push('</section>');
  return out.join('\n');
}

/* ---------------- page pieces ---------------- */
const NAV = [['index', 'Home'], ['investing', 'Investing'], ['personal-finance', 'Personal Finance'], ['markets', 'Markets'], ['guides', 'Guides'], ['glossary', 'Glossary']];
const navHtml = NAV.map(([k, label]) => `<a href="${k}.html"${k === page.nav ? ' class="active"' : ''}>${label}</a>`).join('\n        ');

const header = `
  <header class="site-header">
    <div class="container header-inner">
      <a href="index.html" class="logo">Quiet <span>Wealth</span></a>
      <button class="menu-toggle" aria-label="Toggle menu" id="menuToggle">☰</button>
      <nav class="main-nav" id="mainNav">
        ${navHtml}
      </nav>
    </div>
  </header>`;

const footer = `
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <div class="logo">Quiet <span>Wealth</span></div>
          <p>Clear financial education for people who want to understand money and build lasting wealth — without the noise.</p>
        </div>
        <div class="footer-col">
          <h5>Learn</h5>
          <ul>
            <li><a href="investing.html">Investing</a></li>
            <li><a href="personal-finance.html">Personal Finance</a></li>
            <li><a href="markets.html">Markets</a></li>
            <li><a href="guides.html">Guides</a></li>
            <li><a href="glossary.html">Glossary</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h5>Company</h5>
          <ul>
            <li><a href="about.html">About</a></li>
            <li><a href="contact.html">Contact</a></li>
            <li><a href="privacy.html">Privacy Policy</a></li>
            <li><a href="terms.html">Terms of Use</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h5>Resources</h5>
          <ul>
            <li><a href="#">Newsletter</a></li>
            <li><a href="#">Sitemap</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <div>© 2026 Quiet Wealth. All rights reserved.</div>
        <div>Educational content only. Not financial advice.</div>
      </div>
    </div>
  </footer>`;

const tocTitle = s => s.tocTitle || s.title;
const tocLinks = page.sections.map(s => `<li><a href="#${esc(s.id)}" data-toc="${esc(s.id)}">${esc(tocTitle(s))}</a></li>`).join('');

const glance = `
      <section class="guide-glance" aria-labelledby="glance-title">
        <h2 id="glance-title">The short version</h2>
        <ol>${page.sections.map(s =>
          `<li><a href="#${esc(s.id)}"><strong>${esc(tocTitle(s))}</strong><span>${inline(s.short || '')}</span></a></li>`).join('')}</ol>
      </section>`;

const relatedLine = page.related?.length ? `
      <p class="guide-related-line"><span>Keep exploring:</span> ${page.related.map(r => `<a href="${esc(r.url)}">${esc(r.title)}</a>`).join(' · ')}</p>` : '';

const authorName = page.author?.name?.trim();
const byline = authorName ? `By <strong>${esc(authorName)}</strong>` : 'By <strong>Quiet Wealth</strong>';

const sectionsHtml = page.sections.map((s, i) =>
  sectionHtml(s, i) + (i === 1 ? '\n<div class="ad-slot ad-in-content" aria-label="Advertisement">Advertisement</div>' : '')
).join('\n');

const sourcesHtml = page.sources?.length ? `
      <section class="guide-sources" id="sources" aria-labelledby="sources-title">
        <h2 class="guide-h2-plain" id="sources-title">Sources and further reading</h2>
        <p>For current rates, rules and licensed firms, go to the official sources below.</p>
        <ul>${page.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul>
      </section>` : '';

const nextHtml = page.next?.length ? `
      <section class="guide-next" aria-labelledby="next-title">
        <h2 class="guide-h2-plain" id="next-title">Keep learning</h2>
        <ul>${page.next.map(n => `<li><a href="${esc(n.url)}">${esc(n.title)}</a> <span>${esc(n.text)}</span></li>`).join('')}</ul>
      </section>` : '';

const authorHtml = authorName ? `
      <section class="guide-author" aria-label="About the author">
        <p><strong>About the author:</strong> ${esc(authorName)}${page.author.title ? `, ${esc(page.author.title)}` : ''}. ${esc(page.author.bio || '')}</p>
      </section>` : '';

/* reading time */
const allText = [page.lead, ...page.sections.flatMap(s => [
  s.answer, s.short,
  ...(s.blocks || []).flatMap(b => [b.text, b.title, ...(b.items || []), ...(b.rows || []).flat()]),
  ...(s.inUganda?.blocks || []).flatMap(b => [b.text, ...(b.items || [])]),
  ...(s.takeaways || []), ...(s.faqs || []).flatMap(f => [f.q, f.a])
])].filter(Boolean).map(plain).join(' ');
const words = (allText.match(/\S+/g) || []).length;
const minutes = Math.max(1, Math.round(words / 220));

/* structured data */
const base = page.siteUrl ? page.siteUrl.replace(/\/$/, '') : '';
const pageUrl = base ? `${base}/${page.slug}.html` : '';
const org = { '@type': 'Organization', name: 'Quiet Wealth', ...(base && { url: base }) };
const graph = [
  {
    '@type': 'Article',
    headline: page.title,
    description: page.metaDescription,
    author: authorName ? { '@type': 'Person', name: authorName } : org,
    publisher: org,
    datePublished: page.published,
    dateModified: page.updated || page.published,
    inLanguage: 'en',
    ...(pageUrl && { mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl } })
  },
  {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', ...(base && { item: `${base}/index.html` }) },
      { '@type': 'ListItem', position: 2, name: page.title.split(':')[0], ...(pageUrl && { item: pageUrl }) }
    ]
  }
];
const faqs = page.sections.flatMap(s => s.faqs || []);
if (faqs.length) {
  graph.push({
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: plain(f.q), acceptedAnswer: { '@type': 'Answer', text: plain(f.a) } }))
  });
}
const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2).replace(/</g, '\\u003c');

/* ---------------- assemble ---------------- */
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(page.metaTitle)}</title>
  <meta name="description" content="${esc(page.metaDescription)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  ${pageUrl ? `<link rel="canonical" href="${esc(pageUrl)}">` : '<!-- Add "siteUrl" to the JSON to output a canonical link -->'}
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Quiet Wealth">
  <meta property="og:title" content="${esc(page.metaTitle)}">
  <meta property="og:description" content="${esc(page.metaDescription)}">
  ${pageUrl ? `<meta property="og:url" content="${esc(pageUrl)}">` : ''}
  <meta name="twitter:card" content="summary">
  <link rel="stylesheet" href="styles.css">
  <link rel="stylesheet" href="guide.css">
  <script type="application/ld+json">
${jsonLd}
  </script>
</head>
<body>
${header}

  <main class="guide-page">
    <div class="container">
      <nav class="guide-crumbs" aria-label="Breadcrumb">
        <ol>
          <li><a href="index.html">Home</a></li>
          <li aria-current="page">${esc(page.title.split(':')[0])}</li>
        </ol>
      </nav>

      <header class="article-header guide-header">
        <span class="article-tag">${esc(page.tag || 'Guide')}</span>
        <h1>${esc(page.title)}</h1>
        <p class="guide-lead">${inline(page.lead || '')}</p>
        <div class="article-meta">
          <span>${byline}</span>
          <span>Updated <time datetime="${esc(page.updated || page.published)}">${longDate(page.updated || page.published)}</time></span>
          <span>${minutes} min read</span>
        </div>
      </header>

      <div class="article-layout">
        <article class="guide-body">
          <details class="toc toc-mobile">
            <summary>On this page</summary>
            <ol>${tocLinks}</ol>
          </details>
${glance}
${relatedLine}

${sectionsHtml}

${sourcesHtml}
${nextHtml}
${authorHtml}
          <p class="guide-disclaimer">${esc(page.disclaimer || '')}</p>
        </article>

        <aside class="sidebar" aria-label="Sidebar">
          <nav class="guide-toc" aria-label="On this page">
            <p class="guide-toc-title">On this page</p>
            <ol>${tocLinks}</ol>
          </nav>
          <div class="ad-slot sidebar" aria-label="Advertisement">Advertisement</div>
        </aside>
      </div>
    </div>
  </main>
${footer}

  <script src="main.js"></script>
  <script src="guide.js" defer></script>
</body>
</html>
`;

const outFile = path.join(dir, `${page.slug}.html`);
fs.writeFileSync(outFile, html, 'utf8');

console.log(`Built ${path.basename(outFile)}: ${page.sections.length} sections, ${faqs.length} FAQs, ~${words} words, ${minutes} min read`);
[...new Set(warnings)].forEach(w => console.warn('Warning:', w));
