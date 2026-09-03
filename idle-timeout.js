/* ────────────────────────────────────────────────────────────────
   PaperDesk — idle-timeout.js
   Shared by every logged-in page (index, portfolio, orders, profile).
   Auto-logs the user out after a period of no mouse/keyboard/touch
   activity. Session storage (see the pd_token/pd_user switch in each
   page's own script) already handles "log out on browser close" —
   this handles "log out on idle" on top of that.
────────────────────────────────────────────────────────────────── */
'use strict';

(function () {
  const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes — adjust as needed
  let idleTimer;

  function idleLogout() {
    sessionStorage.removeItem('pd_token');
    sessionStorage.removeItem('pd_user');
    window.location.href = 'login.html?reason=idle';
  }

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(idleLogout, IDLE_TIMEOUT_MS);
  }

  // Only run the watchdog when actually logged in.
  if (sessionStorage.getItem('pd_token')) {
    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
      .forEach(evt => document.addEventListener(evt, resetIdleTimer, { passive: true }));
    resetIdleTimer();
  }
})();
