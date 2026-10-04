// Guide pages: highlight the current section in the table of contents
(() => {
  'use strict';

  const sections = [...document.querySelectorAll('.guide-section')];
  const links = [...document.querySelectorAll('[data-toc]')];
  if (!sections.length || !links.length) return;

  const OFFSET = 120;   // a little below the sticky header

  function update() {
    let current = sections[0].id;
    sections.forEach(s => { if (s.getBoundingClientRect().top <= OFFSET) current = s.id; });
    links.forEach(a => {
      const on = a.dataset.toc === current;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  }, { passive: true });
  window.addEventListener('resize', update);
  update();

  // Close the mobile "On this page" list after choosing a section
  document.querySelectorAll('.toc-mobile a').forEach(a =>
    a.addEventListener('click', () => a.closest('details').removeAttribute('open')));
})();
