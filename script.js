/* ────────────────────────────────────────────────────────────────
   PaperDesk — script.js  (dashboard)
   Handles: theme, auth session, ticker, sparkline, watchlist,
   orders, order modal, live price simulation
────────────────────────────────────────────────────────────────── */

'use strict';

// Escapes user-controlled strings before inserting them into innerHTML
// (e.g. watchlist names, which the user can freely rename). Anything
// coming straight from our own DB (symbols/instrument names) is lower
// risk but still passed through this for defense in depth wherever
// it's cheap to do so.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

const API = ''; // Same origin

/* ── THEME ──────────────────────────────────────────────────────── */
const html        = document.documentElement;
const themeToggle = document.getElementById('themeToggle');
const savedTheme  = localStorage.getItem('pd_theme') || 'dark';
html.setAttribute('data-theme', savedTheme);

function toggleTheme() {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('pd_theme', next);
}
themeToggle.addEventListener('click', toggleTheme);
const mobileThemeToggle = document.getElementById('mobileThemeToggle');
mobileThemeToggle && mobileThemeToggle.addEventListener('click', toggleTheme);

/* ── AUTH SESSION ────────────────────────────────────────────────── */
const token   = sessionStorage.getItem('pd_token');
const userRaw = sessionStorage.getItem('pd_user');
const user    = userRaw ? JSON.parse(userRaw) : null;

const navLoginBtn     = document.getElementById('navLoginBtn');
const navUser         = document.getElementById('navUser');
const avatarInitial   = document.getElementById('avatarInitial');
const avatarBtn       = document.getElementById('avatarBtn');
const avatarDropdown  = document.getElementById('avatarDropdown');
const avatarDropdownName = document.getElementById('avatarDropdownName');
const navLogout       = document.getElementById('navLogout');
const welcomeBar      = document.getElementById('welcomeBar');
const welcomeName     = document.getElementById('welcomeName');
const mobileLoginLink = document.getElementById('mobileLoginLink');

function initials(fullName) {
  return fullName.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

// Renders the user's Google profile photo in the navbar avatar when one
// is available (i.e. they signed in with Google); otherwise leaves the
// existing initials circle exactly as it was.
function renderAvatar(u) {
  if (u.picture) {
    const img = document.createElement('img');
    img.src = u.picture;
    img.alt = u.name;
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
      // Photo failed to load (e.g. expired Google URL) — fall back
      // to initials instead of showing a broken image.
      avatarInitial.classList.remove('has-photo');
      avatarInitial.textContent = initials(u.name);
    };
    avatarInitial.textContent = '';
    avatarInitial.classList.add('has-photo');
    avatarInitial.appendChild(img);
  } else {
    avatarInitial.classList.remove('has-photo');
    avatarInitial.textContent = initials(u.name);
  }
}

if (token && user) {
  // Logged in state
  navLoginBtn.style.display  = 'none';
  navUser.style.display      = 'flex';
  renderAvatar(user);
  avatarDropdownName.textContent = user.name;
  welcomeBar.style.display   = 'flex';
  welcomeName.textContent    = user.name;
  const mobileProfileLink = document.getElementById('mobileProfileLink');
  mobileProfileLink && (mobileProfileLink.style.display = 'block');
  mobileLoginLink.textContent = 'Logout';
  mobileLoginLink.href        = '#';
  mobileLoginLink.addEventListener('click', e => { e.preventDefault(); logout(); });

  // Verify token is still valid in background
  verifyToken();
} else {
  // Logged out state — show login button, hide welcome bar
  navLoginBtn.style.display = '';
  navUser.style.display     = 'none';
  welcomeBar.style.display  = 'none';
}

avatarBtn && avatarBtn.addEventListener('click', e => {
  e.stopPropagation();
  const isOpen = avatarDropdown.classList.toggle('open');
  avatarBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
});
document.addEventListener('click', e => {
  if (avatarDropdown && !avatarDropdown.contains(e.target) && e.target !== avatarBtn) {
    avatarDropdown.classList.remove('open');
    avatarBtn && avatarBtn.setAttribute('aria-expanded', 'false');
  }
});

async function verifyToken() {
  try {
    const res = await fetch('api/me.php', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    // Only treat this as "actually logged out" for a genuine 401
    // (invalid/expired token). Any other failure (500, network
    // blip, DB cold start, etc.) should NOT kick the user back to
    // the login screen — just continue with the cached session.
    if (res.status === 401) logout();
  } catch {
    // Backend down — don't force logout, just continue with cached session
  }
}

function logout() {
  sessionStorage.removeItem('pd_token');
  sessionStorage.removeItem('pd_user');
  window.location.href = 'login.html';
}

navLogout && navLogout.addEventListener('click', logout);

/* ── HAMBURGER ───────────────────────────────────────────────────── */
const hamburger  = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');
hamburger.addEventListener('click', () => mobileMenu.classList.toggle('open'));

/* ── DATA ────────────────────────────────────────────────────────── */
// Small sample set used only for the logged-out "Sample Watchlist"
// fallback (see GUEST_LIST below) — not used anywhere else now that
// the ticker tape has been removed.
const GUEST_SAMPLE_SYMBOLS = [
  { sym: 'RELIANCE',   exch: 'NSE' },
  { sym: 'TCS',        exch: 'NSE' },
  { sym: 'HDFCBANK',   exch: 'NSE' },
  { sym: 'INFY',       exch: 'NSE' },
  { sym: 'SBIN',       exch: 'NSE' },
  { sym: 'BAJFINANCE', exch: 'NSE' },
  { sym: 'KOTAKBANK',  exch: 'NSE' },
  { sym: 'WIPRO',      exch: 'NSE' },
];

/* ── UTILS ───────────────────────────────────────────────────────── */
function fmt(n, dec = 2) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  }).format(n);
}

/* ── MULTIPLE WATCHLISTS (server-backed, max 6, renamable) ──────── */
const WL_MAX = 6;
let wlState = { lists: [], activeId: null };

// Logged-out fallback: a single read-only demo list so the page
// still shows something useful before signing in.
const GUEST_LIST = {
  id: 'guest', name: 'Sample Watchlist', readOnly: true,
  items: GUEST_SAMPLE_SYMBOLS.slice(0, 8).map(s => ({ symbol: s.sym, exch: s.exch })),
};

async function wlFetch(action, body) {
  const res = await fetch(`api/watchlists.php${action ? `?action=${action}` : ''}`, {
    method: action ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: action ? JSON.stringify(body || {}) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

async function loadWatchlists() {
  if (!token) {
    wlState = { lists: [GUEST_LIST], activeId: 'guest' };
    renderWlTabs();
    renderWatchlist();
    return;
  }
  try {
    const data = await wlFetch(null);
    wlState.lists    = data.watchlists;
    wlState.activeId = data.watchlists[0]?.id || null;
  } catch (err) {
    showToast(err.message);
    wlState = { lists: [GUEST_LIST], activeId: 'guest' };
  }
  renderWlTabs();
  renderWatchlist();
  refreshQuotes();
}

function activeList() {
  return wlState.lists.find(l => l.id === wlState.activeId) || wlState.lists[0];
}

function renderWlTabs() {
  const tabsEl = document.getElementById('wlTabs');
  if (!tabsEl) return;

  tabsEl.innerHTML = wlState.lists.map(list => `
    <div class="wl-tab ${list.id === wlState.activeId ? 'active' : ''}" data-id="${list.id}">
      <span class="wl-tab-name" data-id="${list.id}">${escapeHtml(list.name)}</span>
      ${!list.readOnly ? `<span class="wl-tab-edit" data-action="edit" data-id="${list.id}" title="Rename">✎</span>` : ''}
      ${!list.readOnly && wlState.lists.length > 1 ? `<span class="wl-tab-close" data-action="close" data-id="${list.id}" title="Delete">✕</span>` : ''}
    </div>
  `).join('') + (token ? `
    <button class="wl-tab-add" id="wlTabAdd" ${wlState.lists.length >= WL_MAX ? 'disabled' : ''}
      title="${wlState.lists.length >= WL_MAX ? `Max ${WL_MAX} watchlists` : 'New watchlist'}">+</button>
  ` : '');

  tabsEl.querySelectorAll('.wl-tab').forEach(tab => {
    tab.addEventListener('click', e => {
      if (e.target.dataset.action) return;
      wlState.activeId = tab.dataset.id;
      renderWlTabs();
      renderWatchlist();
      refreshQuotes();
    });
  });

  tabsEl.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const nameEl = tabsEl.querySelector(`.wl-tab-name[data-id="${btn.dataset.id}"]`);
      nameEl.contentEditable = 'true';
      nameEl.focus();
      document.execCommand('selectAll', false, null);

      const commit = async () => {
        nameEl.contentEditable = 'false';
        const list = wlState.lists.find(l => l.id === btn.dataset.id);
        const val  = nameEl.textContent.trim().slice(0, 40);
        if (!val || val === list.name) { nameEl.textContent = list.name; return; }
        try {
          await wlFetch('rename', { id: list.id, name: val });
          list.name = val;
        } catch (err) {
          showToast(err.message);
          nameEl.textContent = list.name;
        }
      };
      nameEl.addEventListener('blur', commit, { once: true });
      nameEl.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); }
        if (ev.key === 'Escape') { nameEl.textContent = wlState.lists.find(l => l.id === btn.dataset.id).name; nameEl.blur(); }
      });
    });
  });

  tabsEl.querySelectorAll('[data-action="close"]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (wlState.lists.length <= 1) return;
      if (!confirm('Delete this watchlist? This cannot be undone.')) return;
      try {
        await wlFetch('delete', { id: btn.dataset.id });
        wlState.lists = wlState.lists.filter(l => l.id !== btn.dataset.id);
        if (wlState.activeId === btn.dataset.id) wlState.activeId = wlState.lists[0].id;
        renderWlTabs();
        renderWatchlist();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  const addBtn = document.getElementById('wlTabAdd');
  if (addBtn) addBtn.addEventListener('click', async () => {
    if (wlState.lists.length >= WL_MAX) return;
    const name = `Watchlist ${wlState.lists.length + 1}`;
    try {
      const data = await wlFetch('create', { name });
      wlState.lists.push(data.watchlist);
      wlState.activeId = data.watchlist.id;
      renderWlTabs();
      renderWatchlist();
    } catch (err) {
      showToast(err.message);
    }
  });
}

/* ── ADD SYMBOL TO ACTIVE WATCHLIST (real search) ────────────────── */
const wlAddSymbolBtn  = document.getElementById('wlAddSymbolBtn');
const wlAddPopover     = document.getElementById('wlAddPopover');
const wlSearchInput    = document.getElementById('wlSearchInput');
const wlSearchResults  = document.getElementById('wlSearchResults');
const nameCache        = {}; // symbol -> company name, filled in as search results come back

if (wlAddSymbolBtn) {
  wlAddSymbolBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!token) {
      showToast('Please login to manage watchlists →');
      setTimeout(() => window.location.href = 'login.html', 1200);
      return;
    }
    const isOpen = wlAddPopover.classList.toggle('open');
    if (isOpen) { wlSearchInput.value = ''; wlSearchResults.innerHTML = ''; wlSearchInput.focus(); }
  });
}
document.addEventListener('click', e => {
  if (wlAddPopover && !wlAddPopover.contains(e.target) && e.target !== wlAddSymbolBtn) {
    wlAddPopover.classList.remove('open');
  }
});

let searchDebounce;
if (wlSearchInput) {
  wlSearchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = wlSearchInput.value.trim();
    if (q.length < 1) { wlSearchResults.innerHTML = ''; return; }
    wlSearchResults.innerHTML = `<div class="wl-search-loading">Searching…</div>`;
    searchDebounce = setTimeout(() => runSymbolSearch(q), 250);
  });
}

async function runSymbolSearch(q) {
  try {
    const res  = await fetch(`api/instruments-search.php?q=${encodeURIComponent(q)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed.');

    if (!data.instruments.length) {
      wlSearchResults.innerHTML = `<div class="wl-search-empty">No matching symbols found.</div>`;
      return;
    }

    wlSearchResults.innerHTML = data.instruments.map(inst => `
      <div class="wl-search-item" data-sym="${inst.symbol}" data-exch="${inst.exch}" data-name="${inst.name.replace(/"/g, '&quot;')}">
        <span class="wl-search-item-sym">${inst.symbol}</span>
        <span class="wl-search-item-name">${inst.name}</span>
        <span class="wl-search-item-exch">${inst.exch}</span>
      </div>
    `).join('');

    wlSearchResults.querySelectorAll('.wl-search-item').forEach(el => {
      el.addEventListener('click', () => addSymbolToActiveList(el.dataset.sym, el.dataset.exch, el.dataset.name));
    });
  } catch (err) {
    wlSearchResults.innerHTML = `<div class="wl-search-empty">${err.message}</div>`;
  }
}

async function addSymbolToActiveList(symbol, exch, name) {
  const list = activeList();
  if (list.items.some(i => i.symbol === symbol)) { showToast(`${symbol} is already in this list`); return; }
  try {
    await wlFetch('add_item', { id: list.id, symbol, exch });
    list.items.push({ symbol, exch });
    nameCache[symbol] = name;
    wlAddPopover.classList.remove('open');
    renderWatchlist();
    refreshQuotes();
  } catch (err) {
    showToast(err.message);
  }
}

/* ── SORT & FILTER (client-side, per session — not persisted) ────── */
let wlSortState = { filterExch: 'ALL', sortBy: null, dir: 'asc' };

const wlSortBtn     = document.getElementById('wlSortBtn');
const wlSortPopover = document.getElementById('wlSortPopover');

if (wlSortBtn) {
  wlSortBtn.addEventListener('click', e => {
    e.stopPropagation();
    wlSortPopover.classList.toggle('open');
  });
}
document.addEventListener('click', e => {
  if (wlSortPopover && !wlSortPopover.contains(e.target) && e.target !== wlSortBtn) {
    wlSortPopover.classList.remove('open');
  }
});

function refreshSortUI() {
  document.querySelectorAll('[data-filter-exch]').forEach(b => b.classList.toggle('active', b.dataset.filterExch === wlSortState.filterExch));
  document.querySelectorAll('[data-sort-by]').forEach(b => b.classList.toggle('active', b.dataset.sortBy === wlSortState.sortBy));
  document.querySelectorAll('[data-dir]').forEach(b => b.classList.toggle('active', b.dataset.dir === wlSortState.dir));
  const label = wlSortState.sortBy || wlSortState.filterExch !== 'ALL' ? '⇅ Sort •' : '⇅ Sort';
  wlSortBtn.textContent = label;
}

document.querySelectorAll('[data-filter-exch]').forEach(btn => {
  btn.addEventListener('click', () => {
    wlSortState.filterExch = btn.dataset.filterExch;
    refreshSortUI();
    renderWatchlist();
  });
});
document.querySelectorAll('[data-sort-by]').forEach(btn => {
  btn.addEventListener('click', () => {
    wlSortState.sortBy = wlSortState.sortBy === btn.dataset.sortBy ? null : btn.dataset.sortBy;
    refreshSortUI();
    renderWatchlist();
  });
});
document.querySelectorAll('[data-dir]').forEach(btn => {
  btn.addEventListener('click', () => {
    wlSortState.dir = btn.dataset.dir;
    refreshSortUI();
    renderWatchlist();
  });
});
document.getElementById('wlSortClear').addEventListener('click', () => {
  wlSortState = { filterExch: 'ALL', sortBy: null, dir: 'asc' };
  refreshSortUI();
  renderWatchlist();
});
refreshSortUI();

/**
 * Applies the current filter + sort to a list's items before display.
 * Sorting by % change or LTP reads from the live quoteCache, so it
 * naturally reflects whatever's currently on screen.
 */
function applySortFilter(items) {
  let out = wlSortState.filterExch === 'ALL' ? items.slice() : items.filter(i => i.exch === wlSortState.filterExch);

  if (wlSortState.sortBy) {
    const dirMul = wlSortState.dir === 'desc' ? -1 : 1;
    out.sort((a, b) => {
      let av, bv;
      if (wlSortState.sortBy === 'alpha') {
        av = a.symbol; bv = b.symbol;
        return av.localeCompare(bv) * dirMul;
      }
      if (wlSortState.sortBy === 'exch') {
        av = a.exch; bv = b.exch;
        return av.localeCompare(bv) * dirMul;
      }
      if (wlSortState.sortBy === 'ltp') {
        av = quoteCache[a.symbol]?.ltp ?? -Infinity;
        bv = quoteCache[b.symbol]?.ltp ?? -Infinity;
        return (av - bv) * dirMul;
      }
      if (wlSortState.sortBy === 'chg') {
        const aq = quoteCache[a.symbol], bq = quoteCache[b.symbol];
        av = aq && aq.close ? (aq.ltp - aq.close) / aq.close : -Infinity;
        bv = bq && bq.close ? (bq.ltp - bq.close) / bq.close : -Infinity;
        return (av - bv) * dirMul;
      }
      return 0;
    });
  }

  return out;
}

/* ── WATCHLIST TABLE (driven by live quoteCache) ─────────────────── */
const quoteCache = {}; // symbol -> { ltp, close }

function renderWatchlist() {
  const list = activeList();
  if (!list) return;

  const items = applySortFilter(list.items);

  if (!items.length) {
    document.getElementById('watchlistBody').innerHTML = `
      <tr><td colspan="4" class="wl-empty">${list.items.length ? 'No symbols match this filter.' : 'No symbols yet — click "+ Add" to add one.'}</td></tr>`;
    return;
  }

  document.getElementById('watchlistBody').innerHTML = items.map(item => {
    const q     = quoteCache[item.symbol];
    const ltp   = q ? q.ltp : null;
    const close = q ? q.close : null;
    const chg    = (ltp !== null && close) ? ltp - close : 0;
    const chgPct = close ? (chg / close) * 100 : 0;
    const pos    = chg >= 0;
    return `
      <tr>
        <td>
          <span class="cell-sym">${escapeHtml(item.symbol)}</span>
          <span class="cell-exch">${escapeHtml(item.exch)}</span>
        </td>
        <td class="align-right cell-price">${ltp !== null ? fmt(ltp) : '<span class="skeleton skeleton-text"></span>'}</td>
        <td class="align-right cell-chg ${ltp === null ? '' : (pos ? 'positive' : 'negative')}">
          ${ltp === null ? '<span class="skeleton skeleton-text"></span>' : `${pos ? '▲' : '▼'} ${fmt(Math.abs(chgPct))}%`}
        </td>
        <td class="align-right">
          <button class="btn-chart"
            data-sym="${escapeHtml(item.symbol)}" data-exch="${escapeHtml(item.exch)}" data-name="${escapeHtml(nameCache[item.symbol] || item.symbol)}">Chart</button>
          <button class="btn-alert"
            data-sym="${item.symbol}" data-exch="${item.exch}" data-ltp="${ltp || 0}" title="Set a price alert">🔔</button>
          <button class="btn-trade"
            data-sym="${item.symbol}" data-exch="${item.exch}" data-name="${nameCache[item.symbol] || item.symbol}" data-ltp="${ltp || 0}">Trade</button>
          ${!list.readOnly ? `<button class="wl-remove-btn" data-sym="${item.symbol}" title="Remove from this watchlist">✕</button>` : ''}
        </td>
      </tr>`;
  }).join('');

  document.querySelectorAll('.btn-chart').forEach(btn => {
    btn.addEventListener('click', () => {
      openChartModal(btn.dataset.sym, btn.dataset.exch, btn.dataset.name);
    });
  });

  document.querySelectorAll('.btn-alert').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!token) {
        showToast('Please login to set alerts →');
        setTimeout(() => window.location.href = 'login.html', 1200);
        return;
      }
      openAlertModal(btn.dataset.sym, btn.dataset.exch, parseFloat(btn.dataset.ltp));
    });
  });

  document.querySelectorAll('.btn-trade').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!token) {
        showToast('Please login to place trades →');
        setTimeout(() => window.location.href = 'login.html', 1200);
        return;
      }
      if (!parseFloat(btn.dataset.ltp)) { showToast('Price still loading, try again in a moment'); return; }
      openModal(btn.dataset.sym, btn.dataset.exch, btn.dataset.name, parseFloat(btn.dataset.ltp));
    });
  });

  document.querySelectorAll('.wl-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const list = activeList();
      try {
        await wlFetch('remove_item', { id: list.id, symbol: btn.dataset.sym });
        list.items = list.items.filter(i => i.symbol !== btn.dataset.sym);
        renderWatchlist();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  // Mobile: whole row is tappable, opens an action sheet instead of
  // showing 3 separate buttons (which caused horizontal scroll).
  if (window.innerWidth <= 700) {
    document.querySelectorAll('#watchlistBody tr').forEach(row => {
      const tradeBtn = row.querySelector('.btn-trade');
      if (!tradeBtn) return; // header/empty rows
      row.addEventListener('click', e => {
        if (e.target.closest('button')) return; // let real buttons (if any) behave normally
        openActionSheet(tradeBtn.dataset.sym, tradeBtn.dataset.exch, tradeBtn.dataset.name, parseFloat(tradeBtn.dataset.ltp) || 0);
      });
    });
  }
}

/* ── MOBILE ACTION SHEET ──────────────────────────────────────────── */
const actionSheetBackdrop = document.getElementById('actionSheetBackdrop');
let sheetSym = '', sheetExch = 'NSE', sheetName = '', sheetLtp = 0;

function openActionSheet(sym, exch, name, ltp) {
  sheetSym = sym; sheetExch = exch; sheetName = name; sheetLtp = ltp;
  document.getElementById('actionSheetSymbol').textContent = sym;
  document.getElementById('actionSheetLtp').textContent = ltp ? '₹' + fmt(ltp) : 'Price loading…';
  actionSheetBackdrop.classList.add('open');
}
function closeActionSheet() {
  actionSheetBackdrop.classList.remove('open');
}
actionSheetBackdrop.addEventListener('click', e => { if (e.target === actionSheetBackdrop) closeActionSheet(); });

/**
 * Swipe-down-to-dismiss for the mobile action sheet — drag down past
 * a threshold to close, otherwise it snaps back. Same behavior as
 * the Portfolio page's holding detail sheet.
 */
(function enableSwipeToDismiss(sheetEl, onClose) {
  if (!sheetEl) return;
  let startY = 0, currentY = 0, dragging = false;

  sheetEl.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    dragging = true;
    sheetEl.style.transition = 'none';
  }, { passive: true });

  sheetEl.addEventListener('touchmove', e => {
    if (!dragging) return;
    currentY = e.touches[0].clientY - startY;
    if (currentY > 0) sheetEl.style.transform = `translateY(${currentY}px)`;
  }, { passive: true });

  sheetEl.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    sheetEl.style.transition = '';
    if (currentY > 100) onClose();
    sheetEl.style.transform = '';
    currentY = 0;
  });
})(document.querySelector('#actionSheetBackdrop .action-sheet'), closeActionSheet);

document.getElementById('sheetChartBtn').addEventListener('click', () => {
  closeActionSheet();
  openChartModal(sheetSym, sheetExch, sheetName);
});
document.getElementById('sheetAlertBtn').addEventListener('click', () => {
  closeActionSheet();
  if (!token) { showToast('Please login to set alerts →'); setTimeout(() => window.location.href = 'login.html', 1200); return; }
  openAlertModal(sheetSym, sheetExch, sheetLtp);
});
document.getElementById('sheetTradeBtn').addEventListener('click', () => {
  closeActionSheet();
  if (!token) { showToast('Please login to place trades →'); setTimeout(() => window.location.href = 'login.html', 1200); return; }
  if (!sheetLtp) { showToast('Price still loading, try again in a moment'); return; }
  openModal(sheetSym, sheetExch, sheetName, sheetLtp);
});

/* ── ALERT MODAL (price alert -> Telegram) ───────────────────────── */
const alertBackdrop      = document.getElementById('alertBackdrop');
const alertUnlinkedView  = document.getElementById('alertUnlinkedView');
const alertLinkedView    = document.getElementById('alertLinkedView');
const alertLinkBtn       = document.getElementById('alertLinkBtn');
const alertLinkStatus    = document.getElementById('alertLinkStatus');
const alertDirAbove      = document.getElementById('alertDirAbove');
const alertDirBelow      = document.getElementById('alertDirBelow');
const alertTriggerInput  = document.getElementById('alertTriggerInput');
const alertError         = document.getElementById('alertError');
const alertSubmitBtn     = document.getElementById('alertSubmitBtn');
const alertExistingList  = document.getElementById('alertExistingList');

let alertSym = '', alertExch = 'NSE', alertLtp = 0, alertDirection = 'ABOVE';
let telegramLinked = false;

async function openAlertModal(sym, exch, ltp) {
  alertSym = sym; alertExch = exch || 'NSE'; alertLtp = ltp; alertDirection = 'ABOVE';
  document.getElementById('alertModalSymbol').textContent = sym;
  document.getElementById('alertModalExch').textContent   = alertExch;
  document.getElementById('alertModalLtp').textContent    = '₹' + fmt(ltp);
  alertTriggerInput.value = ltp ? ltp.toFixed(2) : '';
  alertError.textContent = '';
  alertDirAbove.classList.add('active'); alertDirBelow.classList.remove('active');

  alertBackdrop.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Check link status fresh every time — user might have linked
  // Telegram in another tab since the last time this modal was open.
  try {
    const res  = await fetch('api/telegram-link.php', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    telegramLinked = !!data.linked;
  } catch {
    telegramLinked = false;
  }

  alertUnlinkedView.style.display = telegramLinked ? 'none' : 'block';
  alertLinkedView.style.display   = telegramLinked ? 'block' : 'none';
  if (telegramLinked) loadExistingAlerts();
}

function closeAlertModal() {
  alertBackdrop.classList.remove('open');
  document.body.style.overflow = '';
}
document.getElementById('alertModalClose').addEventListener('click', closeAlertModal);
alertBackdrop.addEventListener('click', e => { if (e.target === alertBackdrop) closeAlertModal(); });

alertDirAbove.addEventListener('click', () => {
  alertDirection = 'ABOVE';
  alertDirAbove.classList.add('active'); alertDirBelow.classList.remove('active');
});
alertDirBelow.addEventListener('click', () => {
  alertDirection = 'BELOW';
  alertDirBelow.classList.add('active'); alertDirAbove.classList.remove('active');
});

alertLinkBtn.addEventListener('click', async () => {
  alertLinkBtn.disabled = true;
  alertLinkStatus.style.display = 'block';
  alertLinkStatus.textContent = 'Generating link…';
  try {
    const res  = await fetch('api/telegram-link.php?action=generate_link', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not generate link.');

    window.open(data.deepLink, '_blank');
    alertLinkStatus.textContent = 'Opened Telegram — tap "Start" there, then come back and reopen this alert box.';
  } catch (err) {
    alertLinkStatus.textContent = err.message;
  } finally {
    alertLinkBtn.disabled = false;
  }
});

async function loadExistingAlerts() {
  try {
    const res  = await fetch('api/alerts.php', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const relevant = (data.alerts || []).filter(a => a.symbol === alertSym && a.exch === alertExch && a.status === 'ACTIVE');
    if (!relevant.length) { alertExistingList.innerHTML = ''; return; }

    alertExistingList.innerHTML = '<p class="field-label" style="margin-bottom:6px;">Active alerts on this symbol</p>' +
      relevant.map(a => `
        <div class="alert-existing-item">
          <span>${a.direction === 'ABOVE' ? '▲ Above' : '▼ Below'} ₹${fmt(a.trigger_price)}</span>
          <button class="cancel-alert-btn" data-id="${a.id}" title="Cancel">✕</button>
        </div>
      `).join('');

    alertExistingList.querySelectorAll('.cancel-alert-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await fetch('api/alerts.php?action=delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ id: btn.dataset.id }),
          });
          loadExistingAlerts();
        } catch (err) {
          showToast('Could not cancel alert.');
        }
      });
    });
  } catch {
    alertExistingList.innerHTML = '';
  }
}

alertSubmitBtn.addEventListener('click', async () => {
  const price = parseFloat(alertTriggerInput.value);
  if (!price || price <= 0) { alertError.textContent = 'Enter a valid trigger price.'; return; }

  alertSubmitBtn.disabled = true;
  alertError.textContent = '';
  try {
    const res  = await fetch('api/alerts.php?action=create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ symbol: alertSym, exch: alertExch, direction: alertDirection, trigger_price: price }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create alert.');

    showToast(`🔔 Alert set: ${alertSym} ${alertDirection === 'ABOVE' ? 'above' : 'below'} ₹${fmt(price)}`);
    closeAlertModal();
  } catch (err) {
    alertError.textContent = err.message;
  } finally {
    alertSubmitBtn.disabled = false;
  }
});

loadWatchlists();
refreshBalance();
refreshHoldings();

/* ── ORDER MODAL (market orders only) ────────────────────────────── */
const backdrop        = document.getElementById('modalBackdrop');
const sideBuy          = document.getElementById('sideBuy');
const sideSell         = document.getElementById('sideSell');
const placeBtn         = document.getElementById('placeBtn');
const qtyInput         = document.getElementById('qty');
const orderEst         = document.getElementById('orderEst');
const cashAvailableEl  = document.getElementById('cashAvailable');
const heldQtyDisplay   = document.getElementById('heldQtyDisplay');

let currentSide = 'BUY', currentLtp = 0, currentSym = '', currentExch = 'NSE';
let currentOrderType = 'MARKET';
let cashBalance = null;
let holdingsCache = {}; // "SYMBOL:EXCH" -> { qty, avg_price }

const orderTypeNote     = document.getElementById('orderTypeNote');
const priceFieldsRow    = document.getElementById('priceFieldsRow');
const limitPriceField   = document.getElementById('limitPriceField');
const triggerPriceField = document.getElementById('triggerPriceField');   // null on watchlist page (Market/Limit only)
const limitPriceInput   = document.getElementById('limitPriceInput');
const triggerPriceInput = document.getElementById('triggerPriceInput');  // null on watchlist page (Market/Limit only)

const ORDER_TYPE_NOTES = {
  MARKET: 'Market order — executes instantly at the current live price.',
  LIMIT:  'Limit order — fills automatically once the price reaches your limit, even if the app is closed.',
  'SL-M': 'Stop-loss (market) — becomes a market order the instant price crosses your trigger.',
  'SL-L': 'Stop-loss (limit) — once price crosses your trigger, it becomes a limit order at your limit price.',
};

function updateOrderType(type) {
  currentOrderType = type;
  document.querySelectorAll('.ot-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  orderTypeNote.textContent = ORDER_TYPE_NOTES[type];

  const needsLimit   = type === 'LIMIT' || type === 'SL-L';
  const needsTrigger = type === 'SL-M'  || type === 'SL-L';
  priceFieldsRow.style.display    = (needsLimit || needsTrigger) ? 'grid' : 'none';
  limitPriceField.style.display   = needsLimit   ? 'flex' : 'none';
  if (triggerPriceField) triggerPriceField.style.display = needsTrigger ? 'flex' : 'none';

  // Pre-fill with current LTP as a sensible starting point
  if (needsLimit && !limitPriceInput.value)                          limitPriceInput.value   = currentLtp.toFixed(2);
  if (needsTrigger && triggerPriceInput && !triggerPriceInput.value) triggerPriceInput.value = currentLtp.toFixed(2);

  updatePlaceBtnLabel();
}

document.querySelectorAll('.ot-btn').forEach(btn => {
  btn.addEventListener('click', () => updateOrderType(btn.dataset.type));
});

async function refreshBalance() {
  if (!token) return;
  try {
    const res  = await fetch('api/me.php', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load balance.');
    cashBalance = parseFloat(data.user.balance);
    const el = document.getElementById('welcomeBalance');
    if (el) el.textContent = '₹' + fmt(cashBalance);
    if (cashAvailableEl) cashAvailableEl.textContent = '₹' + fmt(cashBalance);
  } catch (err) {
    console.warn('refreshBalance failed:', err.message);
  }
}

async function refreshHoldings() {
  if (!token) return;
  try {
    const res  = await fetch('api/holdings.php', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load holdings.');
    holdingsCache = {};
    data.holdings.forEach(h => { holdingsCache[`${h.symbol}:${h.exch}`] = h; });
  } catch (err) {
    console.warn('refreshHoldings failed:', err.message);
  }
}

function openModal(sym, exch, name, ltp) {
  currentSym = sym; currentExch = exch || 'NSE'; currentLtp = ltp; currentSide = 'BUY';
  document.getElementById('modalSymbol').textContent = sym;
  document.getElementById('modalName').textContent   = `${name} · ${currentExch}`;
  document.getElementById('modalLtp').textContent    = '₹' + fmt(ltp);
  qtyInput.value = '1';
  limitPriceInput.value = ''; if (triggerPriceInput) triggerPriceInput.value = '';
  updateOrderType('MARKET');
  updateSide('BUY'); updateEst(); updateHeldQtyDisplay();
  refreshBalance();
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
}

document.getElementById('modalClose').addEventListener('click', closeModal);
backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ── CHART MODAL (Lightweight Charts + Volume + RSI + live ticks + trendline) ── */
const chartBackdrop  = document.getElementById('chartBackdrop');
const chartTradeBtn  = document.getElementById('chartTradeBtn');
let chartSym = '', chartExch = 'NSE', chartName = '', chartLtp = 0;
let chartInstance = null, candleSeries = null, volumeSeries = null;
let rsiChartInstance = null, rsiSeries = null;
let currentTf = '1d';
let lastCandles = []; // kept in memory so live ticks can update the last bar + recompute RSI
let syncingTimeScale = false; // guards against the two charts' sync listeners feeding back into each other
let volumeAutoscaleCap = null; // computed per dataset in renderChartData(), read by volumeSeries's autoscaleInfoProvider

function ensureChartInstance() {
  if (chartInstance) return;
  const dark = html.getAttribute('data-theme') === 'dark';

  const container = document.getElementById('tvChartContainer');
  chartInstance = LightweightCharts.createChart(container, {
    layout: {
      background: { color: 'transparent' },
      textColor: dark ? '#c9ced6' : '#333',
    },
    grid: {
      vertLines: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
      horzLines: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
    },
    timeScale: { timeVisible: true, secondsVisible: false },
    autoSize: true,
  });

  // Price candles occupy the top ~75%; volume the bottom ~20% —
  // RSI no longer lives in this canvas at all, see rsiChartInstance
  // below, so the price pane gets to use most of the height now.
  candleSeries = chartInstance.addCandlestickSeries({
    upColor: '#00C896', downColor: '#FF4D6A',
    borderVisible: false,
    wickUpColor: '#00C896', wickDownColor: '#FF4D6A',
    priceScaleId: 'right',
  });
  chartInstance.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.22 } });

  volumeSeries = chartInstance.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    color: dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)',
    // Without this, the volume pane always autoscales to fit the
    // single tallest bar in view — one outlier spike day makes every
    // ordinary day render as a flat sliver, which looks like "the
    // volume chart won't scale" even though the pane's own height is
    // fine. volumeAutoscaleCap (recomputed per dataset below) clips
    // the top of the scale at a sane value instead, so typical bars
    // stay visible and only genuine spikes get capped off.
    autoscaleInfoProvider: () => volumeAutoscaleCap
      ? { priceRange: { minValue: 0, maxValue: volumeAutoscaleCap } }
      : null,
  });
  chartInstance.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, borderVisible: false });

  // ── RSI gets its own genuinely separate chart/canvas, not an
  // overlay squeezed into the price chart. The two are kept in sync
  // by mirroring each other's visible time range whenever one
  // scrolls/zooms — syncingTimeScale guards against the mirroring
  // itself re-triggering a loop.
  const rsiContainer = document.getElementById('tvRsiContainer');
  rsiChartInstance = LightweightCharts.createChart(rsiContainer, {
    layout: {
      background: { color: 'transparent' },
      textColor: dark ? '#c9ced6' : '#333',
    },
    grid: {
      vertLines: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
      horzLines: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
    },
    timeScale: { timeVisible: true, secondsVisible: false },
    rightPriceScale: { scaleMargins: { top: 0.15, bottom: 0.15 } },
    autoSize: true,
  });
  rsiSeries = rsiChartInstance.addLineSeries({
    color: '#a374ff', lineWidth: 2,
    priceScaleId: 'right',
    priceLineVisible: false, lastValueVisible: false,
    autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
  });
  // 30/70 reference lines make the RSI pane readable at a glance.
  const overboughtLine = rsiChartInstance.addLineSeries({
    color: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)', lineWidth: 1,
    priceScaleId: 'right', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
  });
  const oversoldLine = rsiChartInstance.addLineSeries({
    color: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)', lineWidth: 1,
    priceScaleId: 'right', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
  });
  rsiChartInstance._overboughtLine = overboughtLine;
  rsiChartInstance._oversoldLine   = oversoldLine;

  chartInstance.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (syncingTimeScale || !range) return;
    syncingTimeScale = true;
    rsiChartInstance.timeScale().setVisibleLogicalRange(range);
    syncingTimeScale = false;
  });
  rsiChartInstance.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (syncingTimeScale || !range) return;
    syncingTimeScale = true;
    chartInstance.timeScale().setVisibleLogicalRange(range);
    syncingTimeScale = false;
  });
}

/**
 * Standard RSI(14) — Wilder's smoothing. Returns [{time, value}] for
 * every candle, null for the first `period` bars where it can't be
 * computed yet (Lightweight Charts skips nulls gracefully).
 */
function computeRSI(candles, period = 14) {
  const out = [];
  let avgGain = 0, avgLoss = 0;

  for (let i = 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (i <= period) {
      avgGain += gain; avgLoss += loss;
      if (i === period) {
        avgGain /= period; avgLoss /= period;
        out.push({ time: candles[i].time, value: rsiFromAvg(avgGain, avgLoss) });
      }
      continue;
    }

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push({ time: candles[i].time, value: rsiFromAvg(avgGain, avgLoss) });
  }
  return out;
}
function rsiFromAvg(avgGain, avgLoss) {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function renderChartData(candles) {
  lastCandles = candles;
  candleSeries.setData(candles);

  // Cap the volume scale at ~1.5x the 90th-percentile bar instead of
  // the true max, so one outlier spike doesn't flatten every normal
  // day's bar into an invisible sliver. Spikes still render — they
  // just clip at the top of the pane instead of stretching it.
  const volumes = candles.map(c => c.volume || 0).filter(v => v > 0).sort((a, b) => a - b);
  if (volumes.length >= 5) {
    const p90 = volumes[Math.floor(volumes.length * 0.9)];
    volumeAutoscaleCap = Math.max(p90 * 1.5, volumes[volumes.length - 1] * 0.15);
  } else {
    volumeAutoscaleCap = null; // too little data to bother — fall back to normal autoscale
  }

  volumeSeries.setData(candles.map(c => ({
    time: c.time, value: c.volume || 0,
    color: c.close >= c.open ? 'rgba(0,200,150,0.5)' : 'rgba(255,77,106,0.5)',
  })));

  const rsiPoints = computeRSI(candles);
  rsiSeries.setData(rsiPoints);
  if (rsiPoints.length) {
    const span = [rsiPoints[0].time, rsiPoints[rsiPoints.length - 1].time];
    rsiChartInstance._overboughtLine.setData(span.map(time => ({ time, value: 70 })));
    rsiChartInstance._oversoldLine.setData(span.map(time => ({ time, value: 30 })));
  }

  chartInstance.timeScale().fitContent();
  rsiChartInstance.timeScale().fitContent();
}

let candleRequestInFlight = false;

async function loadCandles(sym, exch, tf) {
  if (candleRequestInFlight) return;
  candleRequestInFlight = true;
  ensureChartInstance();
  try {
    const res  = await fetch(`api/candles.php?symbol=${encodeURIComponent(sym)}&exch=${encodeURIComponent(exch)}&interval=${tf}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load chart data.');
    renderChartData(data.candles || []);
  } catch (err) {
    showToast(err.message);
  } finally {
    candleRequestInFlight = false;
  }
}

/**
 * Called from the same live-quote poll that updates the watchlist —
 * updates just the LAST candle's close/high/low with the fresh tick
 * (doesn't create new bars; that only happens on the next full
 * candles.php reload). Also recomputes RSI so it stays in sync.
 * This is what makes the chart feel "live" between full reloads.
 */
function updateChartLiveTick(sym, exch, ltp) {
  if (!chartBackdrop.classList.contains('open')) return;
  if (sym !== chartSym || exch !== chartExch) return;
  if (!lastCandles.length || !candleSeries) return;

  const last = lastCandles[lastCandles.length - 1];
  const updated = {
    ...last,
    close: ltp,
    high: Math.max(last.high, ltp),
    low: Math.min(last.low, ltp),
  };
  lastCandles[lastCandles.length - 1] = updated;

  candleSeries.update(updated);
  const rsiPoints = computeRSI(lastCandles);
  if (rsiPoints.length) rsiSeries.update(rsiPoints[rsiPoints.length - 1]);
}

function openChartModal(sym, exch, name) {
  if (!sym) {
    showToast('Could not open chart — missing symbol.');
    return;
  }
  chartSym = sym; chartExch = exch || 'NSE'; chartName = name || sym;
  document.getElementById('chartModalSymbol').textContent = sym;
  document.getElementById('chartModalName').textContent   = `${chartName} · ${chartExch}`;
  currentTf = '1d';
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', b.dataset.tf === currentTf));

  // The modal (and #tvChartContainer/#tvRsiContainer inside it) must
  // actually be visible in layout BEFORE the charts are created —
  // Lightweight Charts measures the container's size at creation
  // time, and a display:none container measures as 0×0, which is
  // what made the chart render squished/broken until an unrelated
  // resize fixed it.
  chartBackdrop.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Let the browser actually paint the now-visible modal (one frame)
  // before we measure/create the charts against it.
  requestAnimationFrame(() => {
    loadCandles(sym, chartExch, currentTf);
    // Belt-and-braces: force a resize against the now-correct
    // container dimensions in case the very first measurement still
    // raced the modal's open transition on a slower device.
    if (chartInstance) {
      const container = document.getElementById('tvChartContainer');
      chartInstance.resize(container.clientWidth, container.clientHeight);
    }
    if (rsiChartInstance) {
      const rsiContainer = document.getElementById('tvRsiContainer');
      rsiChartInstance.resize(rsiContainer.clientWidth, rsiContainer.clientHeight);
    }
  });
}

document.querySelectorAll('.tf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentTf = btn.dataset.tf;
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', b === btn));
    loadCandles(chartSym, chartExch, currentTf);
  });
});

function closeChartModal() {
  chartBackdrop.classList.remove('open');
  document.body.style.overflow = '';
}

document.getElementById('chartModalClose').addEventListener('click', closeChartModal);
chartBackdrop.addEventListener('click', e => { if (e.target === chartBackdrop) closeChartModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeChartModal(); });

// autoSize:true handles most resizes internally, but browser zoom
// changes don't always fire a clean ResizeObserver callback across
// all browsers — force a resync so the chart never gets stuck
// mis-sized after a zoom change while the modal is open.
window.addEventListener('resize', () => {
  if (!chartInstance || !chartBackdrop.classList.contains('open')) return;
  const container = document.getElementById('tvChartContainer');
  chartInstance.resize(container.clientWidth, container.clientHeight);
  if (rsiChartInstance) {
    const rsiContainer = document.getElementById('tvRsiContainer');
    rsiChartInstance.resize(rsiContainer.clientWidth, rsiContainer.clientHeight);
  }
});

// "Trade" button inside the chart modal — jumps straight into the
// order modal for whatever symbol is currently charted, using the
// live LTP already cached from the watchlist poll.
chartTradeBtn.addEventListener('click', () => {
  if (!token) {
    showToast('Please login to place trades →');
    setTimeout(() => window.location.href = 'login.html', 1200);
    return;
  }
  const q = quoteCache[chartSym];
  const ltp = q ? q.ltp : 0;
  if (!ltp) { showToast('Price still loading, try again in a moment'); return; }
  closeChartModal();
  openModal(chartSym, chartExch, chartName, ltp);
});

function updateHeldQtyDisplay() {
  const h = holdingsCache[`${currentSym}:${currentExch}`];
  heldQtyDisplay.value = h ? `${h.qty} shares` : '0 shares';
}

function updateSide(side) {
  currentSide = side;
  sideBuy.classList.toggle('active', side === 'BUY');
  sideSell.classList.toggle('active', side === 'SELL');
  updatePlaceBtnLabel();
  updateHeldQtyDisplay();
}

function updatePlaceBtnLabel() {
  const prefix = currentOrderType === 'MARKET' ? '' : `${currentOrderType} `;
  placeBtn.textContent = `${prefix}${currentSide} ${currentSym}`;
  placeBtn.className   = `btn-place ${currentSide === 'BUY' ? 'buy' : 'sell'}`;
}

sideBuy.addEventListener('click',  () => updateSide('BUY'));
sideSell.addEventListener('click', () => updateSide('SELL'));

function updateEst() {
  const qty = parseInt(qtyInput.value) || 1;
  orderEst.textContent = '₹' + fmt(qty * currentLtp);
}
qtyInput.addEventListener('input', updateEst);

placeBtn.addEventListener('click', async () => {
  const qty = parseInt(qtyInput.value) || 0;
  if (qty < 1) { showToast('Enter a valid quantity'); return; }

  const payload = { symbol: currentSym, exch: currentExch, side: currentSide, qty, order_type: currentOrderType };

  if (currentOrderType === 'LIMIT' || currentOrderType === 'SL-L') {
    const lp = parseFloat(limitPriceInput.value);
    if (!lp || lp <= 0) { showToast('Enter a valid limit price'); return; }
    payload.limit_price = lp;
  }
  if (currentOrderType === 'SL-M' || currentOrderType === 'SL-L') {
    const tp = parseFloat(triggerPriceInput.value);
    if (!tp || tp <= 0) { showToast('Enter a valid trigger price'); return; }
    payload.trigger_price = tp;
  }

  placeBtn.disabled = true;
  const originalText = placeBtn.textContent;
  placeBtn.textContent = 'Placing…';

  try {
    const res  = await fetch('api/trade.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Trade failed.');

    closeModal();

    if (data.status === 'PENDING') {
      showToast(`📋 ${data.message}`);
    } else {
      cashBalance = parseFloat(data.newBalance);
      const balEl = document.getElementById('welcomeBalance');
      if (balEl) balEl.textContent = '₹' + fmt(cashBalance);
      showToast(`✓ ${data.side} ${qty} ${currentSym} @ ₹${fmt(data.price)} — Executed`);
      refreshHoldings();
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    placeBtn.disabled = false;
    placeBtn.textContent = originalText;
  }
});

/* ── REAL INDICES + MARKET STATUS (Angel One) ────────────────────── */
const IDX_ELEMENT_MAP = {
  'NIFTY 50':   'idx-nifty',
  'BANK NIFTY': 'idx-banknifty',
  'SENSEX':     'idx-sensex',
};

function setMarketStatusUI(isOpen) {
  const statusEl  = document.getElementById('marketStatus');
  const inlineEl  = document.getElementById('marketStatusInline');
  const label     = isOpen ? 'Market Open' : 'Market Closed';

  if (statusEl) {
    statusEl.innerHTML = `<span class="status-dot ${isOpen ? '' : 'closed'}"></span>${label}`;
  }
  if (inlineEl) {
    inlineEl.textContent = label;
    inlineEl.className   = `market-status-inline ${isOpen ? 'positive' : 'negative'}`;
  }
}

async function refreshIndices() {
  try {
    const res  = await fetch('api/indices.php');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch indices.');

    setMarketStatusUI(!!data.marketOpen);

    data.indices.forEach(idx => {
      const elId = IDX_ELEMENT_MAP[idx.name];
      const el   = elId && document.getElementById(elId);
      if (!el) return;
      const chg    = idx.value - idx.close;
      const chgPct = idx.close ? (chg / idx.close) * 100 : 0;
      const pos    = chg >= 0;
      el.querySelector('.idx-val').textContent = fmt(idx.value);
      const chgEl = el.querySelector('.idx-chg');
      chgEl.textContent = `${pos ? '+' : '−'}${fmt(Math.abs(chg))} (${pos ? '+' : '−'}${fmt(Math.abs(chgPct))}%)`;
      chgEl.className   = `idx-chg ${pos ? 'positive' : 'negative'}`;
    });
  } catch (err) {
    console.warn('refreshIndices failed:', err.message);
  }
}

refreshIndices();
setInterval(refreshIndices, 10000);

/* ── REAL LIVE PRICES FOR THE WATCHLIST (Angel One) ──────────────── */
async function refreshQuotes() {
  const list = activeList();
  if (!list || !list.items.length) return;

  // Logged-in users hit the authenticated per-user endpoint; guests
  // viewing the read-only sample list hit the public one instead
  // (same underlying data, just no login required for public stocks).
  const endpoint = token ? 'api/quotes.php' : 'api/public-quotes.php';
  const headers  = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res  = await fetch(endpoint, {
      method:  'POST',
      headers,
      body: JSON.stringify({ symbols: list.items.map(i => ({ symbol: i.symbol, exch: i.exch })) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch quotes.');

    data.quotes.forEach(q => { quoteCache[q.symbol] = q; });
    renderWatchlist();
    updateOpenModalsLivePrice();
  } catch (err) {
    // Stay quiet on transient failures (e.g. rate limits) — don't spam toasts every poll
    console.warn('refreshQuotes failed:', err.message);
  }
}

// Real market data doesn't need sub-second refresh — poll every 8s
// to stay well within Angel One's rate limits.
setInterval(refreshQuotes, 8000);

/**
 * Keeps the Trade and Alert modals' displayed LTP live while they're
 * open, instead of freezing at whatever price they were opened with.
 * Deliberately does NOT touch anything the user has typed (qty,
 * limit/trigger price inputs) — only the read-only "current price"
 * display and the internal currentLtp/alertLtp values used for
 * estimated-value math.
 */
function updateOpenModalsLivePrice() {
  if (backdrop.classList.contains('open') && currentSym) {
    const q = quoteCache[currentSym];
    if (q && q.ltp) {
      currentLtp = q.ltp;
      document.getElementById('modalLtp').textContent = '₹' + fmt(currentLtp);
      updateEst(); // keeps "Estimated value" in sync with the live price too
    }
  }

  if (alertBackdrop.classList.contains('open') && alertSym) {
    const q = quoteCache[alertSym];
    if (q && q.ltp) {
      alertLtp = q.ltp;
      document.getElementById('alertModalLtp').textContent = '₹' + fmt(alertLtp);
    }
  }

  if (chartBackdrop.classList.contains('open') && chartSym) {
    const q = quoteCache[chartSym];
    if (q && q.ltp) updateChartLiveTick(chartSym, chartExch, q.ltp);
  }
}

/* ── TOAST ───────────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}
