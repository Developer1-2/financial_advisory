// Quiet Wealthx — Main JavaScript (shared by every page)
// Page-specific code lives in its own file: news.js, ticker.js, glossary.js

document.addEventListener('DOMContentLoaded', function () {
  // Mobile menu toggle
  const menuToggle = document.getElementById('menuToggle');
  const mainNav = document.getElementById('mainNav');

  if (menuToggle && mainNav) {
    menuToggle.addEventListener('click', function () {
      mainNav.classList.toggle('open');
      menuToggle.textContent = mainNav.classList.contains('open') ? '✕' : '☰';
    });

    // Close menu when a link is clicked (mobile)
    mainNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mainNav.classList.remove('open');
        menuToggle.textContent = '☰';
      });
    });
  }
});
