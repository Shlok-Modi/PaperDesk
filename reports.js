'use strict';

/* ── THEME ──────────────────────────────────────────────────────── */
const html        = document.documentElement;
const themeToggle = document.getElementById('themeToggle');
html.setAttribute('data-theme', localStorage.getItem('pd_theme') || 'dark');
function toggleTheme() {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('pd_theme', next);
}
themeToggle.addEventListener('click', toggleTheme);
const mobileThemeToggle = document.getElementById('mobileThemeToggle');
mobileThemeToggle && mobileThemeToggle.addEventListener('click', toggleTheme);

/* ── HAMBURGER ──────────────────────────────────────────────────── */
document.getElementById('hamburger').addEventListener('click', () => {
  document.getElementById('mobileMenu').classList.toggle('open');
});

/* ── AUTH GUARD ─────────────────────────────────────────────────── */
const token = sessionStorage.getItem('pd_token');
if (!token) {
  window.location.href = 'login.html';
}

const navLoginBtn        = document.getElementById('navLoginBtn');
const navUser            = document.getElementById('navUser');
const avatarInitial      = document.getElementById('avatarInitial');
const avatarBtn          = document.getElementById('avatarBtn');
const avatarDropdown     = document.getElementById('avatarDropdown');
const avatarDropdownName = document.getElementById('avatarDropdownName');
const navLogout          = document.getElementById('navLogout');
const mobileLoginLink    = document.getElementById('mobileLoginLink');

function initials(fullName) {
  return fullName.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function logout() {
  sessionStorage.removeItem('pd_token');
  sessionStorage.removeItem('pd_user');
  window.location.href = 'login.html';
}
navLogout.addEventListener('click', logout);

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

const cachedUser = JSON.parse(sessionStorage.getItem('pd_user') || 'null');
if (cachedUser) {
  navLoginBtn.style.display = 'none';
  navUser.style.display     = 'flex';
  const mobileProfileLink = document.getElementById('mobileProfileLink');
  mobileProfileLink && (mobileProfileLink.style.display = 'block');
  avatarInitial.textContent = initials(cachedUser.name);
  avatarDropdownName.textContent = cachedUser.name;
  mobileLoginLink.textContent = 'Logout';
  mobileLoginLink.href = '#';
  mobileLoginLink.addEventListener('click', e => { e.preventDefault(); logout(); });
}

/* ── TOAST ──────────────────────────────────────────────────────── */
const toastEl = document.getElementById('toast');
let toastTimer;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
function pnlClass(n) {
  return n > 0 ? 'positive' : n < 0 ? 'negative' : '';
}

/* ── DATE RANGE FILTER (shared helper) ─────────────────────────── */
function getRangeBounds(range, fromStr, toStr) {
  const now = new Date();
  let from = null, to = null;
  if (range === 'today') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    to   = new Date(from.getTime() + 24 * 3600 * 1000 - 1);
  } else if (range === '7d') {
    to = now;
    from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  } else if (range === '30d') {
    to = now;
    from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  } else if (range === 'custom') {
    from = fromStr ? new Date(fromStr + 'T00:00:00') : null;
    to   = toStr   ? new Date(toStr + 'T23:59:59')   : null;
  }
  // 'all' -> both stay null (no bound)
  return { from, to };
}
function dateInRange(iso, bounds) {
  if (!iso) return false;
  const d = new Date(iso);
  if (bounds.from && d < bounds.from) return false;
  if (bounds.to && d > bounds.to) return false;
  return true;
}
/**
 * Wires up a .date-chip row + optional custom date inputs. Returns
 * { getBounds() } so callers can re-derive the active range on demand
 * (e.g. inside a filter/render function) without re-registering state.
 */
function setupDateFilter({ chipsId, customInputsId, fromId, toId, applyId, initialRange, onChange }) {
  const container  = document.getElementById(chipsId);
  const customWrap = document.getElementById(customInputsId);
  const fromInput  = document.getElementById(fromId);
  const toInput    = document.getElementById(toId);
  const applyBtn   = document.getElementById(applyId);
  const state = { range: initialRange, from: '', to: '' };

  function setActive(range) {
    container.querySelectorAll('.date-chip').forEach(b => b.classList.toggle('active', b.dataset.range === range));
    customWrap.classList.toggle('open', range === 'custom');
  }
  setActive(initialRange);

  container.querySelectorAll('.date-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      state.range = btn.dataset.range;
      setActive(state.range);
      if (state.range !== 'custom') onChange();
    });
  });
  applyBtn.addEventListener('click', () => {
    state.from = fromInput.value;
    state.to   = toInput.value;
    if (!state.from && !state.to) { showToast('Pick at least one date.'); return; }
    onChange();
  });

  return { getBounds: () => getRangeBounds(state.range, state.from, state.to) };
}

/* ── TABS ───────────────────────────────────────────────────────── */
const tabButtons = document.querySelectorAll('.report-tab');
const tabPanels  = { pnl: document.getElementById('tab-pnl'), tradebook: document.getElementById('tab-tradebook'), analyser: document.getElementById('tab-analyser') };
let loadedTabs = {};

function activateTab(name) {
  tabButtons.forEach(b => {
    const active = b.dataset.tab === name;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  Object.entries(tabPanels).forEach(([key, el]) => el.classList.toggle('active', key === name));

  if (!loadedTabs[name]) {
    loadedTabs[name] = true;
    if (name === 'pnl') loadPnlSummary();
    if (name === 'tradebook') loadTradebook();
    if (name === 'analyser') loadAnalyser();
  }
}
tabButtons.forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));

/* ═══════════════════════════════════════════════════════════════
   TAB 1 — P&L SUMMARY
   ═══════════════════════════════════════════════════════════════ */
let holdingsCache = []; // [{symbol, exch, qty, avg_price, ltp}]

async function fetchHoldingsWithLtp() {
  const res = await fetch('api/holdings.php', { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load holdings.');
  // Reports reflects the Portfolio, not intraday Positions — anything
  // still bought today is excluded here until it rolls over tomorrow.
  const holdings = (data.holdings || [])
    .map(h => ({ ...h, qty: h.qty - (h.today_qty || 0) }))
    .filter(h => h.qty > 0)
    .map(h => ({ ...h, ltp: h.avg_price }));

  if (holdings.length) {
    try {
      const symbols = holdings.map(h => ({ symbol: h.symbol, exch: h.exch }));
      const qres = await fetch('api/quotes.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ symbols }),
      });
      const qdata = await qres.json();
      if (qres.ok) {
        const bySymbol = {};
        (qdata.quotes || []).forEach(q => { bySymbol[q.symbol] = q; });
        holdings.forEach(h => { const q = bySymbol[h.symbol]; if (q && q.ltp) h.ltp = q.ltp; });
      }
    } catch (err) {
      console.warn('Live prices unavailable for reports, using avg. price:', err.message);
    }
  }
  return holdings;
}

let allOrders = []; // shared cache: full order history, used by P&L tab + TradeBook

async function ensureOrdersLoaded() {
  if (allOrders.length) return allOrders;
  const res = await fetch('api/orders.php?scope=all', { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load trade history.');
  allOrders = data.orders || [];
  return allOrders;
}

const pnlDateCtl = setupDateFilter({
  chipsId: 'pnlDateFilter', customInputsId: 'pnlCustomInputs',
  fromId: 'pnlDateFrom', toId: 'pnlDateTo', applyId: 'pnlCustomApply',
  initialRange: 'all',
  onChange: () => loadPnlSummary(),
});

async function loadPnlSummary() {
  try {
    const [orders, holdings] = await Promise.all([ensureOrdersLoaded(), fetchHoldingsWithLtp()]);
    holdingsCache = holdings;

    const bounds = pnlDateCtl.getBounds();
    const sells = orders.filter(o => o.status === 'EXECUTED' && o.realized_pnl !== null);
    const filteredSells = sells.filter(o => dateInRange(o.executed_at || o.created_at, bounds));

    const realized = filteredSells.reduce((s, o) => s + Number(o.realized_pnl), 0);
    const totalSellValue = filteredSells.reduce((s, o) => s + o.qty * (o.executed_price ?? o.price), 0);

    const realizedEl = document.getElementById('pnlRealized');
    realizedEl.textContent = (realized >= 0 ? '+' : '') + '₹' + fmt(realized);
    realizedEl.className = 'stat-value mono ' + pnlClass(realized);
    const costBasis = totalSellValue - realized;
    const realizedPct = costBasis > 0 ? (realized / costBasis) * 100 : 0;
    const realizedPctEl = document.getElementById('pnlRealizedPct');
    realizedPctEl.textContent = costBasis > 0 ? `${realizedPct >= 0 ? '+' : ''}${fmt(realizedPct)}%` : '';
    realizedPctEl.className = 'stat-pct mono ' + pnlClass(realized);

    document.getElementById('pnlClosedTrades').textContent = filteredSells.length;

    renderRealizedBySymbol(filteredSells);
  } catch (err) {
    showToast(err.message);
  }
}

function renderRealizedBySymbol(sells) {
  const body  = document.getElementById('pnlBySymbolBody');
  const count = document.getElementById('pnlBySymbolCount');

  const bySymbol = {};
  sells.forEach(o => {
    const key = `${o.symbol}:${o.exch}`;
    if (!bySymbol[key]) bySymbol[key] = { symbol: o.symbol, exch: o.exch, sells: 0, qty: 0, sellValue: 0, pnl: 0 };
    const row = bySymbol[key];
    row.sells += 1;
    row.qty += o.qty;
    row.sellValue += o.qty * (o.executed_price ?? o.price);
    row.pnl += Number(o.realized_pnl);
  });

  const rows = Object.values(bySymbol).sort((a, b) => b.pnl - a.pnl);
  count.textContent = `${rows.length} symbol${rows.length === 1 ? '' : 's'}`;

  const gainerNameEl = document.getElementById('pnlTopGainer');
  const gainerPnlEl  = document.getElementById('pnlTopGainerPnl');
  const loserNameEl  = document.getElementById('pnlTopLoser');
  const loserPnlEl   = document.getElementById('pnlTopLoserPnl');

  if (rows.length) {
    const gainer = rows[0];
    gainerNameEl.textContent = gainer.symbol;
    gainerPnlEl.textContent  = (gainer.pnl >= 0 ? '+' : '') + '₹' + fmt(gainer.pnl);
    gainerPnlEl.className    = 'stat-pct mono ' + pnlClass(gainer.pnl);

    const loser = rows[rows.length - 1];
    loserNameEl.textContent = loser.symbol;
    loserPnlEl.textContent  = (loser.pnl >= 0 ? '+' : '') + '₹' + fmt(loser.pnl);
    loserPnlEl.className    = 'stat-pct mono ' + pnlClass(loser.pnl);
  } else {
    gainerNameEl.textContent = '—'; gainerPnlEl.textContent = '';
    loserNameEl.textContent  = '—'; loserPnlEl.textContent  = '';
  }

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-3); padding:32px 20px;">No realized trades in this range.</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(r => {
    const costBasis = r.sellValue - r.pnl;
    const retPct = costBasis > 0 ? (r.pnl / costBasis) * 100 : 0;
    return `
      <tr data-sym="${r.symbol}" data-exch="${r.exch}">
        <td><span class="cell-sym">${r.symbol}</span><span class="cell-exch">${r.exch}</span></td>
        <td class="align-right mono col-hide-mobile">${r.sells}</td>
        <td class="align-right mono">${r.qty}</td>
        <td class="align-right cell-price col-hide-mobile">₹${fmt(r.sellValue)}</td>
        <td class="align-right cell-chg ${pnlClass(r.pnl)}">${r.pnl >= 0 ? '+' : ''}₹${fmt(r.pnl)}</td>
        <td class="align-right cell-chg ${pnlClass(r.pnl)}">${costBasis > 0 ? `${retPct >= 0 ? '+' : ''}${fmt(retPct)}%` : '—'}</td>
      </tr>`;
  }).join('');

  // Cache full row data (incl. hidden-on-mobile fields) for the tap sheet.
  pnlRowsCache = rows;
  if (window.innerWidth <= 700) {
    document.querySelectorAll('#pnlBySymbolBody tr[data-sym]').forEach(row => {
      row.addEventListener('click', () => openPnlSheet(row.dataset.sym, row.dataset.exch));
    });
  }
}

/* ── MOBILE ACTION SHEET (Realized P&L by Symbol row tap -> full detail) ── */
let pnlRowsCache = [];
const pnlActionSheetBackdrop = document.getElementById('pnlActionSheetBackdrop');

function openPnlSheet(sym, exch) {
  const r = pnlRowsCache.find(r => r.symbol === sym && r.exch === exch);
  if (!r) return;
  const costBasis = r.sellValue - r.pnl;
  const retPct = costBasis > 0 ? (r.pnl / costBasis) * 100 : 0;

  document.getElementById('pnlSheetSymbol').textContent   = r.symbol;
  document.getElementById('pnlSheetExch').textContent     = r.exch;
  document.getElementById('pnlSheetSells').textContent    = r.sells;
  document.getElementById('pnlSheetQty').textContent      = r.qty;
  document.getElementById('pnlSheetSellValue').textContent = '₹' + fmt(r.sellValue);

  const retEl = document.getElementById('pnlSheetReturn');
  retEl.textContent = costBasis > 0 ? `${retPct >= 0 ? '+' : ''}${fmt(retPct)}%` : '—';
  retEl.className = 'sheet-detail-val ' + pnlClass(r.pnl);

  const pnlEl = document.getElementById('pnlSheetPnl');
  pnlEl.textContent = (r.pnl >= 0 ? '+' : '') + '₹' + fmt(r.pnl);
  pnlEl.className = 'sheet-detail-val ' + pnlClass(r.pnl);

  pnlActionSheetBackdrop.classList.add('open');
}
function closePnlSheet() {
  pnlActionSheetBackdrop.classList.remove('open');
}
pnlActionSheetBackdrop.addEventListener('click', e => {
  if (e.target === pnlActionSheetBackdrop) closePnlSheet();
});

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
})(document.querySelector('#pnlActionSheetBackdrop .action-sheet'), closePnlSheet);

/* ═══════════════════════════════════════════════════════════════
   TAB 2 — TRADEBOOK
   ═══════════════════════════════════════════════════════════════ */
let tbFilter = { side: 'ALL' };

const STATUS_STYLES = {
  EXECUTED:  '',
  PENDING:   'style="background:rgba(255,193,7,0.15); color:#d9a441;"',
  TRIGGERED: 'style="background:rgba(255,193,7,0.15); color:#d9a441;"',
  CANCELLED: 'style="opacity:0.6;"',
  REJECTED:  'style="background:rgba(255,77,106,0.15); color:var(--negative);"',
};

const tbDateCtl = setupDateFilter({
  chipsId: 'tbDateFilter', customInputsId: 'tbCustomInputs',
  fromId: 'tbDateFrom', toId: 'tbDateTo', applyId: 'tbCustomApply',
  initialRange: 'all',
  onChange: () => renderTradebook(),
});

async function loadTradebook() {
  const body  = document.getElementById('tbBody');
  const count = document.getElementById('tbCount');
  try {
    await ensureOrdersLoaded();
    renderTradebook();
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--negative); padding:32px 20px;">${err.message}</td></tr>`;
    count.textContent = '0 trades';
  }
}

function applyTbFilter(orders) {
  const bounds = tbDateCtl.getBounds();
  return orders.filter(o => {
    // TradeBook is a record of actual trades, so cancelled and still-open
    // (pending/triggered) orders never belong here — only fills.
    if (o.status !== 'EXECUTED') return false;
    if (tbFilter.side !== 'ALL' && o.side !== tbFilter.side) return false;
    if (!dateInRange(o.created_at, bounds)) return false;
    return true;
  });
}

function renderTradebook() {
  const body  = document.getElementById('tbBody');
  const count = document.getElementById('tbCount');
  const filtered = applyTbFilter(allOrders);
  count.textContent = `${filtered.length} trade${filtered.length === 1 ? '' : 's'}`;

  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-3); padding:32px 20px;">No trades match this filter.</td></tr>`;
    return;
  }

  body.innerHTML = filtered.map(o => {
    const sideClass = o.side === 'BUY' ? 'positive' : 'negative';
    const isPending = o.status === 'PENDING' || o.status === 'TRIGGERED';
    const refPrice = o.executed_price ?? o.price;
    const total = o.qty * refPrice;
    const typeLabel = o.order_type === 'MARKET' ? 'Market' : o.order_type;
    const hasPnl = o.realized_pnl !== null && o.realized_pnl !== undefined;

    let priceDetail = `₹${fmt(refPrice)}`;
    if (isPending) {
      const parts = [];
      if (o.limit_price)   parts.push(`Limit ₹${fmt(o.limit_price)}`);
      if (o.trigger_price) parts.push(`Trigger ₹${fmt(o.trigger_price)}`);
      priceDetail = parts.join(' · ') || priceDetail;
    }

    return `
      <tr data-sym="${o.symbol}" data-exch="${o.exch}" data-side="${o.side}" data-type="${typeLabel}"
          data-price="${priceDetail}" data-total="${isPending ? '—' : '₹' + fmt(total)}"
          data-pnl="${hasPnl ? (o.realized_pnl >= 0 ? '+' : '') + '₹' + fmt(o.realized_pnl) : '—'}"
          data-pnlraw="${hasPnl ? o.realized_pnl : ''}" data-status="${o.status}" data-datetime="${fmtDate(o.created_at)}">
        <td><span class="cell-sym">${o.symbol}</span><span class="cell-exch">${o.exch}</span></td>
        <td><span class="${sideClass}" style="font-weight:600;">${o.side}</span></td>
        <td class="col-hide-mobile"><span class="panel-badge">${typeLabel}</span></td>
        <td class="align-right mono">${o.qty}</td>
        <td class="align-center cell-price">${priceDetail}</td>
        <td class="align-center cell-price col-hide-mobile">${isPending ? '—' : '₹' + fmt(total)}</td>
        <td class="align-right cell-chg col-hide-mobile ${hasPnl ? pnlClass(o.realized_pnl) : ''}">${hasPnl ? (o.realized_pnl >= 0 ? '+' : '') + '₹' + fmt(o.realized_pnl) : '—'}</td>
        <td class="mono col-hide-mobile" style="color:var(--text-3); font-size:12px;">${fmtDate(o.created_at)}</td>
      </tr>`;
  }).join('');

  if (window.innerWidth <= 700) {
    document.querySelectorAll('#tbBody tr[data-sym]').forEach(row => {
      row.addEventListener('click', () => openTradebookSheet(row.dataset));
    });
  }
}

/* ── MOBILE ACTION SHEET (TradeBook row tap -> full trade detail) ── */
const tbActionSheetBackdrop = document.getElementById('tbActionSheetBackdrop');

function openTradebookSheet(d) {
  document.getElementById('tbSheetSymbol').textContent = d.sym;
  document.getElementById('tbSheetExch').textContent   = d.exch;

  const sideEl = document.getElementById('tbSheetSide');
  sideEl.textContent = d.side;
  sideEl.className = 'sheet-detail-val ' + (d.side === 'BUY' ? 'positive' : 'negative');

  document.getElementById('tbSheetType').textContent   = d.type;
  document.getElementById('tbSheetPrice').textContent  = d.price;
  document.getElementById('tbSheetTotal').textContent  = d.total;
  document.getElementById('tbSheetDateTime').textContent = d.datetime;

  const pnlEl = document.getElementById('tbSheetPnl');
  pnlEl.textContent = d.pnl;
  pnlEl.className = 'sheet-detail-val ' + (d.pnlraw === '' ? '' : pnlClass(parseFloat(d.pnlraw)));

  tbActionSheetBackdrop.classList.add('open');
}
function closeTradebookSheet() {
  tbActionSheetBackdrop.classList.remove('open');
}
tbActionSheetBackdrop.addEventListener('click', e => {
  if (e.target === tbActionSheetBackdrop) closeTradebookSheet();
});

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
})(document.querySelector('#tbActionSheetBackdrop .action-sheet'), closeTradebookSheet);

const tbFilterBtn     = document.getElementById('tbFilterBtn');
const tbFilterPopover = document.getElementById('tbFilterPopover');
tbFilterBtn.addEventListener('click', e => { e.stopPropagation(); tbFilterPopover.classList.toggle('open'); });
document.addEventListener('click', e => {
  if (!tbFilterPopover.contains(e.target) && e.target !== tbFilterBtn) tbFilterPopover.classList.remove('open');
});
function refreshTbFilterUI() {
  tbFilterPopover.querySelectorAll('[data-tb-side]').forEach(b => b.classList.toggle('active', b.dataset.tbSide === tbFilter.side));
  tbFilterBtn.textContent = tbFilter.side !== 'ALL' ? '⇅ Filter •' : '⇅ Filter';
}
tbFilterPopover.querySelectorAll('[data-tb-side]').forEach(btn => {
  btn.addEventListener('click', () => { tbFilter.side = btn.dataset.tbSide; refreshTbFilterUI(); renderTradebook(); });
});
document.getElementById('tbFilterClear').addEventListener('click', () => {
  tbFilter = { side: 'ALL' }; refreshTbFilterUI(); renderTradebook();
});
refreshTbFilterUI();

document.getElementById('tbExportCsvBtn').addEventListener('click', () => {
  const rows = applyTbFilter(allOrders);
  if (!rows.length) { showToast('No trades to export.'); return; }
  const header = ['Symbol', 'Exch', 'Side', 'Type', 'Qty', 'Price', 'Total', 'Realized P&L', 'Status', 'Date & Time'];
  const lines = [header.join(',')];
  rows.forEach(o => {
    const refPrice = o.executed_price ?? o.price;
    const total = o.qty * refPrice;
    lines.push([
      o.symbol, o.exch, o.side, o.order_type,
      o.qty, refPrice, total,
      o.realized_pnl ?? '', o.status,
      fmtDate(o.created_at),
    ].join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `paperdesk-tradebook-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('tbExportPdfBtn').addEventListener('click', () => {
  const rows = applyTbFilter(allOrders);
  if (!rows.length) { showToast('No trades to export.'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const userName = (cachedUser && cachedUser.name) || 'PaperDesk User';
  const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  doc.setFontSize(16);
  doc.text('PaperDesk — TradeBook', 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Account: ${userName}`, 14, 25);
  doc.text(`Generated: ${now}`, 14, 30);

  const body = rows.map(o => [
    o.symbol, o.exch, o.side,
    o.order_type === 'MARKET' ? 'Market' : o.order_type,
    o.qty,
    'Rs.' + fmt(o.executed_price ?? o.price),
    o.realized_pnl !== null && o.realized_pnl !== undefined ? (o.realized_pnl >= 0 ? '+' : '') + 'Rs.' + fmt(o.realized_pnl) : '—',
    o.status,
    fmtDate(o.created_at),
  ]);

  doc.autoTable({
    startY: 38,
    head: [['Symbol', 'Exch', 'Side', 'Type', 'Qty', 'Price', 'Realized P&L', 'Status', 'Date & Time']],
    body,
    styles: { fontSize: 7.5 },
    headStyles: { fillColor: [30, 41, 59] },
    didParseCell: (hookData) => {
      if (hookData.column.index === 6 && hookData.section === 'body') {
        const raw = rows[hookData.row.index].realized_pnl;
        if (raw !== null && raw !== undefined) hookData.cell.styles.textColor = raw >= 0 ? [0, 150, 110] : [200, 40, 70];
      }
    },
  });

  doc.save(`paperdesk-tradebook-${new Date().toISOString().slice(0, 10)}.pdf`);
});

/* ═══════════════════════════════════════════════════════════════
   TAB 3 — PORTFOLIO ANALYSER
   ═══════════════════════════════════════════════════════════════ */
async function loadAnalyser() {
  const body = document.getElementById('anBody');
  try {
    const [holdings, orders] = await Promise.all([
      holdingsCache.length ? Promise.resolve(holdingsCache) : fetchHoldingsWithLtp(),
      ensureOrdersLoaded(),
    ]);
    holdingsCache = holdings;
    renderAnalyser(holdings);
    renderPerformanceChart(orders);
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--negative); padding:32px 20px;">${err.message}</td></tr>`;
  }
}

function renderAnalyser(holdings) {
  const body        = document.getElementById('anBody');
  const allocCount  = document.getElementById('anAllocCount');
  const holdingCnt  = document.getElementById('anHoldingCount');
  const investedEl  = document.getElementById('anInvested');
  const currentEl   = document.getElementById('anCurrent');
  const bestEl      = document.getElementById('anBest');
  const worstEl     = document.getElementById('anWorst');
  const diversifyEl = document.getElementById('anDiversification');

  holdingCnt.textContent = holdings.length;
  allocCount.textContent = `${holdings.length} scrip${holdings.length === 1 ? '' : 's'}`;

  if (!holdings.length) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-3); padding:32px 20px;">
      No holdings yet — head to the <a href="index.html" class="form-link">Watchlist</a> to place your first trade.
    </td></tr>`;
    investedEl.textContent = '₹0.00';
    currentEl.textContent = '₹0.00';
    bestEl.textContent = '—';
    worstEl.textContent = '—';
    diversifyEl.textContent = '—';
    document.getElementById('anDonutWrap').innerHTML = `<span style="color:var(--text-3); font-size:12px;">No holdings to chart yet.</span>`;
    document.getElementById('anPnlBars').innerHTML = `<span style="color:var(--text-3); font-size:12px;">No holdings to chart yet.</span>`;
    return;
  }

  const rows = holdings.map(h => {
    const invested = h.qty * h.avg_price;
    const current  = h.qty * h.ltp;
    const pnl      = current - invested;
    const pnlPct   = invested > 0 ? (pnl / invested) * 100 : 0;
    return { ...h, invested, current, pnl, pnlPct };
  });

  const totalInvested = rows.reduce((s, r) => s + r.invested, 0);
  const totalCurrent  = rows.reduce((s, r) => s + r.current, 0);
  investedEl.textContent = '₹' + fmt(totalInvested);
  currentEl.textContent  = '₹' + fmt(totalCurrent);

  const best  = rows.reduce((a, b) => (b.pnlPct > a.pnlPct ? b : a), rows[0]);
  const worst = rows.reduce((a, b) => (b.pnlPct < a.pnlPct ? b : a), rows[0]);
  bestEl.textContent = `${best.symbol} ${best.pnlPct >= 0 ? '+' : ''}${fmt(best.pnlPct)}%`;
  bestEl.className = 'stat-value mono ' + pnlClass(best.pnlPct);
  worstEl.textContent = `${worst.symbol} ${worst.pnlPct >= 0 ? '+' : ''}${fmt(worst.pnlPct)}%`;
  worstEl.className = 'stat-value mono ' + pnlClass(worst.pnlPct);

  // Simple diversification read: how concentrated is the portfolio in
  // its single largest holding by current value.
  const maxWeight = totalCurrent > 0 ? Math.max(...rows.map(r => r.current / totalCurrent)) * 100 : 0;
  let diversifyLabel = 'Well diversified';
  if (maxWeight >= 60) diversifyLabel = 'Highly concentrated';
  else if (maxWeight >= 35) diversifyLabel = 'Moderately concentrated';
  diversifyEl.textContent = diversifyLabel;

  renderDonutChart(rows.slice(), totalCurrent);
  renderPnlBarChart(rows.slice());

  rows.sort((a, b) => b.current - a.current);
  body.innerHTML = rows.map(r => {
    const weight = totalCurrent > 0 ? (r.current / totalCurrent) * 100 : 0;
    return `
      <tr data-sym="${r.symbol}" data-exch="${r.exch}">
        <td><span class="cell-sym">${r.symbol}</span><span class="cell-exch">${r.exch}</span></td>
        <td class="align-right mono">${r.qty}</td>
        <td class="align-right cell-price">₹${fmt(r.avg_price)}</td>
        <td class="align-right cell-price">₹${fmt(r.ltp)}</td>
        <td class="align-right cell-price">₹${fmt(r.current)}</td>
        <td class="align-right cell-chg ${pnlClass(r.pnl)}">${r.pnl >= 0 ? '+' : ''}₹${fmt(r.pnl)} <span class="row-pct">(${r.pnlPct >= 0 ? '+' : ''}${fmt(r.pnlPct)}%)</span></td>
        <td class="align-right mono">
          <div style="display:flex; align-items:center; gap:8px; justify-content:flex-end;">
            <div style="width:60px; height:6px; border-radius:4px; background:var(--bg-3); overflow:hidden;">
              <div style="width:${Math.min(weight, 100)}%; height:100%; background:var(--accent);"></div>
            </div>
            <span>${fmt(weight)}%</span>
          </div>
        </td>
      </tr>`;
  }).join('');

  // Cache rows (with weight) so the mobile detail sheet can look them
  // up by symbol without recomputing.
  anRowsCache = rows.map(r => ({ ...r, weight: totalCurrent > 0 ? (r.current / totalCurrent) * 100 : 0 }));

  if (window.innerWidth <= 700) {
    document.querySelectorAll('#anBody tr[data-sym]').forEach(row => {
      row.addEventListener('click', () => openAllocationSheet(row.dataset.sym, row.dataset.exch));
    });
  }
}

/* ── MOBILE ACTION SHEET (Portfolio Allocation row tap -> full detail) ── */
let anRowsCache = [];
const anActionSheetBackdrop = document.getElementById('actionSheetBackdrop');

function openAllocationSheet(sym, exch) {
  const r = anRowsCache.find(r => r.symbol === sym && r.exch === exch);
  if (!r) return;

  document.getElementById('sheetSymbol').textContent  = r.symbol;
  document.getElementById('sheetExch').textContent    = r.exch;
  document.getElementById('sheetQty').textContent      = r.qty;
  document.getElementById('sheetAvgPrice').textContent = '₹' + fmt(r.avg_price);
  document.getElementById('sheetLtp').textContent      = '₹' + fmt(r.ltp);
  document.getElementById('sheetCurrent').textContent  = '₹' + fmt(r.current);
  document.getElementById('sheetWeight').innerHTML =
    `<div style="flex:1; height:6px; border-radius:4px; background:var(--bg-3); overflow:hidden;">
       <div style="width:${Math.min(r.weight, 100)}%; height:100%; background:var(--accent);"></div>
     </div>
     <span style="flex-shrink:0;">${fmt(r.weight)}%</span>`;

  const pnlEl = document.getElementById('sheetPnl');
  pnlEl.textContent = (r.pnl >= 0 ? '+' : '') + '₹' + fmt(r.pnl) + ` (${r.pnlPct >= 0 ? '+' : ''}${fmt(r.pnlPct)}%)`;
  pnlEl.className   = 'sheet-detail-val ' + pnlClass(r.pnl);

  anActionSheetBackdrop.classList.add('open');
}
function closeAllocationSheet() {
  anActionSheetBackdrop.classList.remove('open');
}
anActionSheetBackdrop.addEventListener('click', e => {
  if (e.target === anActionSheetBackdrop) closeAllocationSheet();
});

// Swipe-down-to-dismiss — same behavior as the Watchlist/Portfolio/Orders sheets.
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
})(document.querySelector('#actionSheetBackdrop .action-sheet'), closeAllocationSheet);

/* ── ANALYSER CHARTS ──────────────────────────────────────────────
   No chart library loaded on this page, so both charts are built
   from plain CSS/DOM: the donut is a conic-gradient circle, the P&L
   chart is a set of bars growing left/right from a center line. */
const CHART_COLORS = ['#00C9A7', '#7C8CFF', '#F5A623', '#FF4D6A', '#22C55E', '#38BDF8', '#C084FC', '#F472B6'];

function renderDonutChart(rows, totalCurrent) {
  const wrap = document.getElementById('anDonutWrap');
  rows.sort((a, b) => b.current - a.current);

  let cumulative = 0;
  const stops = rows.map((r, i) => {
    const pct = totalCurrent > 0 ? (r.current / totalCurrent) * 100 : 0;
    const start = cumulative;
    cumulative += pct;
    return `${CHART_COLORS[i % CHART_COLORS.length]} ${start}% ${cumulative}%`;
  }).join(', ');

  wrap.innerHTML = `
    <div style="width:140px; height:140px; border-radius:50%; background:conic-gradient(${stops}); flex-shrink:0; position:relative;">
      <div style="position:absolute; inset:20px; border-radius:50%; background:var(--bg-1); display:flex; align-items:center; justify-content:center; flex-direction:column; text-align:center; padding:4px;">
        <span style="font-size:10px; color:var(--text-3);">Total Value</span>
        <span style="font-size:12.5px; font-weight:700; color:var(--text-1);">₹${fmt(totalCurrent)}</span>
      </div>
    </div>
    <div class="donut-legend">
      ${rows.map((r, i) => {
        const pct = totalCurrent > 0 ? (r.current / totalCurrent) * 100 : 0;
        return `<div class="donut-legend-item">
          <span class="donut-legend-swatch" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>
          <span class="sym">${r.symbol}</span>
          <span>${fmt(pct)}%</span>
        </div>`;
      }).join('')}
    </div>`;
}

function renderPnlBarChart(rows) {
  const wrap = document.getElementById('anPnlBars');
  rows.sort((a, b) => b.pnlPct - a.pnlPct);
  const maxAbsPct = Math.max(1, ...rows.map(r => Math.abs(r.pnlPct)));

  wrap.innerHTML = rows.map(r => {
    const halfWidthPct = Math.min(50, (Math.abs(r.pnlPct) / maxAbsPct) * 50);
    const cls = r.pnl >= 0 ? 'positive' : 'negative';
    const style = r.pnl >= 0 ? `width:${halfWidthPct}%;` : `width:${halfWidthPct}%;`;
    return `
      <div class="pnl-bar-row">
        <span class="cell-sym" title="${r.symbol}">${r.symbol}</span>
        <div class="pnl-bar-track">
          <div class="pnl-bar-mid"></div>
          <div class="pnl-bar-fill ${cls}" style="${style}"></div>
        </div>
        <span class="${pnlClass(r.pnl)}" style="text-align:right; font-family:'JetBrains Mono', monospace; font-size:12px;">${r.pnl >= 0 ? '+' : ''}₹${fmt(r.pnl)}</span>
      </div>`;
  }).join('');
}

/* ── PERFORMANCE LINE CHART (cumulative realized P&L) ─────────────
   Built as a plain SVG polyline/area — no chart library on this
   page. Each executed sell is a point plotted at its execution date,
   y = running cumulative realized P&L up to that point. */
function renderPerformanceChart(orders) {
  const container = document.getElementById('anPerfChart');
  const sells = orders
    .filter(o => o.status === 'EXECUTED' && o.realized_pnl !== null && o.realized_pnl !== undefined)
    .map(o => ({ date: new Date(o.executed_at || o.created_at), pnl: Number(o.realized_pnl) }))
    .sort((a, b) => a.date - b.date);

  if (sells.length < 1) {
    container.innerHTML = `<div class="perf-chart-empty">No realized trades yet — sell a holding to start tracking performance over time.</div>`;
    return;
  }

  let running = 0;
  const points = sells.map(s => { running += s.pnl; return { date: s.date, cum: running }; });
  // Lead the line in at zero on the first trade's date so the chart
  // always starts from a clear baseline instead of jumping in mid-air.
  points.unshift({ date: points[0].date, cum: 0 });

  const W = 900, H = 260, padL = 60, padR = 20, padT = 20, padB = 36;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  const minCum = Math.min(0, ...points.map(p => p.cum));
  const maxCum = Math.max(0, ...points.map(p => p.cum));
  const range = (maxCum - minCum) || 1;

  const minTime = points[0].date.getTime();
  const maxTime = points[points.length - 1].date.getTime();
  const timeRange = (maxTime - minTime) || 1;

  const x = t => padL + ((t - minTime) / timeRange) * innerW;
  const y = v => padT + innerH - ((v - minCum) / range) * innerH;
  const zeroY = y(0);

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.date.getTime()).toFixed(1)} ${y(p.cum).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${x(points[points.length - 1].date.getTime()).toFixed(1)} ${zeroY.toFixed(1)} L ${x(points[0].date.getTime()).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  const finalCum = points[points.length - 1].cum;
  const lineColor = finalCum >= 0 ? 'var(--positive)' : 'var(--negative)';

  // Y-axis gridlines/labels: zero line + top + bottom
  const yTicks = [minCum, 0, maxCum].filter((v, i, arr) => arr.indexOf(v) === i);

  // X-axis labels: first, middle, last date
  const xTickPoints = points.length > 2
    ? [points[0], points[Math.floor((points.length - 1) / 2)], points[points.length - 1]]
    : points;

  const dotsHtml = points.slice(1).map(p => {
    const label = p.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    return `<circle class="perf-point" cx="${x(p.date.getTime()).toFixed(1)}" cy="${y(p.cum).toFixed(1)}" r="3.5" fill="${lineColor}" stroke="var(--bg-1)" stroke-width="1.5"><title>${label}: ${p.cum >= 0 ? '+' : ''}₹${fmt(p.cum)}</title></circle>`;
  }).join('');

  const yLabelsHtml = yTicks.map(v => `
    <line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" stroke="var(--border)" stroke-width="1" />
    <text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="var(--text-3)" font-family="'JetBrains Mono', monospace">₹${fmt(v)}</text>
  `).join('');

  const xLabelsHtml = xTickPoints.map(p => `
    <text x="${x(p.date.getTime()).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="10.5" fill="var(--text-3)">${p.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</text>
  `).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="perfAreaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.28" />
          <stop offset="100%" stop-color="${lineColor}" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${yLabelsHtml}
      <path d="${areaPath}" fill="url(#perfAreaFill)" stroke="none" />
      <path d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      ${dotsHtml}
      ${xLabelsHtml}
    </svg>
    <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:11.5px; color:var(--text-3);">
      <span>${sells.length} realized trade${sells.length === 1 ? '' : 's'}</span>
      <span>Cumulative: <span style="color:${lineColor}; font-weight:600; font-family:'JetBrains Mono', monospace;">${finalCum >= 0 ? '+' : ''}₹${fmt(finalCum)}</span></span>
    </div>`;
}

/* ── INIT ───────────────────────────────────────────────────────── */
activateTab('pnl');
