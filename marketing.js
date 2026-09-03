/* ────────────────────────────────────────────────────────────────
   PaperDesk — marketing.js
   Shared behavior for public pages: landing, product, pricing, features.
────────────────────────────────────────────────────────────────── */

'use strict';

/* ── THEME ──────────────────────────────────────────────────────── */
const html        = document.documentElement;
const themeToggle  = document.getElementById('themeToggle');
const savedTheme   = localStorage.getItem('pd_theme') || 'dark';
html.setAttribute('data-theme', savedTheme);
themeToggle?.addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('pd_theme', next);
});

const mobileThemeToggle = document.getElementById('mobileThemeToggle');
mobileThemeToggle?.addEventListener('click', () => themeToggle?.click());

/* ── MOBILE NAV ─────────────────────────────────────────────────── */
const hamburger  = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');
hamburger?.addEventListener('click', () => mobileMenu?.classList.toggle('open'));

/* ── LOGGED-IN STATE ───────────────────────────────────────────────
   If the visitor already has an active session, swap the Login/Sign
   Up buttons for a single "Go to Dashboard" link instead of asking
   them to authenticate again. */
if (sessionStorage.getItem('pd_token')) {
  document.querySelectorAll('.js-auth-swap').forEach(el => {
    el.textContent = 'Go to Dashboard';
    el.setAttribute('href', 'index.html');
  });
  document.querySelectorAll('.js-auth-hide').forEach(el => el.remove());
}

/* ── SCROLL REVEAL ──────────────────────────────────────────────── */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.mkt-reveal').forEach(el => revealObserver.observe(el));
