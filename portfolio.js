'use strict';

/* ── THEME ──────────────────────────────────────────────────────── */
const html = document.documentElement;
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

const navLoginBtn = document.getElementById('navLoginBtn');
const navUser = document.getElementById('navUser');
const avatarInitial = document.getElementById('avatarInitial');
const avatarBtn = document.getElementById('avatarBtn');
const avatarDropdown = document.getElementById('avatarDropdown');
const avatarDropdownName = document.getElementById('avatarDropdownName');
const navLogout = document.getElementById('navLogout');
const mobileLoginLink = document.getElementById('mobileLoginLink');

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
  navUser.style.display = 'flex';
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
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── STATE ──────────────────────────────────────────────────────── */
let holdings = [];   // [{symbol, exch, qty, avg_price, ltp}]
let cashBalance = 0;

const holdingsBody = document.getElementById('holdingsBody');
const holdingCount = document.getElementById('holdingCount');
const statInvested = document.getElementById('statInvested');
const statCurrent = document.getElementById('statCurrent');
const statPnl = document.getElementById('statPnl');
const statPnlPct = document.getElementById('statPnlPct');
const statRealized = document.getElementById('statRealized');
const statRealizedPct = document.getElementById('statRealizedPct');
const statOverall = document.getElementById('statOverall');
const statCash = document.getElementById('statCash');

let realizedPnl = 0; // fetched separately, since it's a DB aggregate, not derivable from live holdings

async function refreshRealizedPnl() {
  try {
    const res = await fetch('api/pnl-summary.php', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load P&L summary.');
    realizedPnl = data.totalRealized;
    statRealized.textContent = (realizedPnl >= 0 ? '+' : '') + '₹' + fmt(realizedPnl);
    statRealized.className = 'stat-value mono ' + (realizedPnl > 0 ? 'positive' : realizedPnl < 0 ? 'negative' : '');

    // Cost basis = sell proceeds minus the P&L those sells generated.
    const costBasis = data.totalSellValue - realizedPnl;
    const realizedPct = costBasis > 0 ? (realizedPnl / costBasis) * 100 : 0;
    statRealizedPct.textContent = costBasis > 0 ? `${realizedPct >= 0 ? '+' : ''}${fmt(realizedPct)}%` : '';
    statRealizedPct.className = 'stat-pct mono ' + (realizedPnl > 0 ? 'positive' : realizedPnl < 0 ? 'negative' : '');

    updateOverallPnl();
  } catch (err) {
    console.warn('refreshRealizedPnl failed:', err.message);
  }
}

function updateOverallPnl() {
  const unrealized = lastUnrealizedPnl;
  const overall = unrealized + realizedPnl;
  statOverall.textContent = (overall >= 0 ? '+' : '') + '₹' + fmt(overall);
  statOverall.className = 'stat-value mono ' + (overall > 0 ? 'positive' : overall < 0 ? 'negative' : '');
}

let lastUnrealizedPnl = 0; // updated by renderHoldings, read by updateOverallPnl

async function refreshBalance() {
  try {
    const res = await fetch('api/me.php', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load balance.');
    cashBalance = parseFloat(data.user.balance);
    statCash.textContent = '₹' + fmt(cashBalance);
  } catch (err) {
    console.warn('refreshBalance failed:', err.message);
  }
}

async function loadHoldings() {
  const res = await fetch('api/holdings.php', { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load holdings.');
  // Portfolio shows only what's carried forward from a previous day —
  // anything still bought today lives on the Positions tab until it
  // rolls over tomorrow.
  holdings = (data.holdings || [])
    .map(h => ({ ...h, qty: h.qty - (h.today_qty || 0) }))
    .filter(h => h.qty > 0)
    .map(h => ({ ...h, ltp: h.avg_price }));
}

async function refreshLivePrices() {
  if (holdings.length === 0) return;
  try {
    const symbols = holdings.map(h => ({ symbol: h.symbol, exch: h.exch }));
    const res = await fetch('api/quotes.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ symbols }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'quotes.php failed');

const bySymbol = {};
    (data.quotes || []).forEach(q => { bySymbol[q.symbol] = q; });
    holdings.forEach(h => {
      const q = bySymbol[h.symbol];
      if (q && q.ltp) h.ltp = q.ltp;
    });
    updateOpenTradeModalLivePrice();
  } catch (err) {
    console.warn('Live prices unavailable, showing avg. price instead:', err.message);
  }
}

/**
 * Keeps the Trade modal's displayed LTP live while it's open on the
 * Portfolio page too — same fix as the Watchlist page's modal, since
 * this is a separate copy of the modal with its own state.
 */
function updateOpenTradeModalLivePrice() {
  if (backdrop.classList.contains('open') && currentSym) {
    const h = holdings.find(h => h.symbol === currentSym && h.exch === currentExch);
    if (h && h.ltp) {
      currentLtp = h.ltp;
      document.getElementById('modalLtp').textContent = '₹' + fmt(currentLtp);
      updateEst();
    }
  }
  if (actionSheetBackdrop.classList.contains('open') && sheetSym) {
    const h = holdings.find(h => h.symbol === sheetSym && h.exch === sheetExch);
    if (h) renderSheetDetail(h);
  }
}

/* ── MOBILE ACTION SHEET (holding detail + Trade) ─────────────────── */
const actionSheetBackdrop = document.getElementById('actionSheetBackdrop');
let sheetSym = '', sheetExch = 'NSE';

function renderSheetDetail(h) {
  const invested = h.qty * h.avg_price;
  const current  = h.qty * h.ltp;
  const pnl      = current - invested;
  const pnlClass = pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : 'neutral';

  document.getElementById('sheetSymbol').textContent   = h.symbol;
  document.getElementById('sheetExch').textContent     = h.exch;
  document.getElementById('sheetQty').textContent       = h.qty;
  document.getElementById('sheetAvgPrice').textContent  = '₹' + fmt(h.avg_price);
  document.getElementById('sheetLtp').textContent       = '₹' + fmt(h.ltp);
  document.getElementById('sheetInvested').textContent  = '₹' + fmt(invested);
  document.getElementById('sheetCurrent').textContent   = '₹' + fmt(current);
  const pnlEl = document.getElementById('sheetPnl');
  pnlEl.textContent = (pnl >= 0 ? '+' : '') + '₹' + fmt(pnl);
  pnlEl.className   = 'sheet-detail-val ' + pnlClass;
}

function openHoldingSheet(sym, exch) {
  sheetSym = sym; sheetExch = exch;
  const h = findHolding(sym, exch);
  if (h) renderSheetDetail(h);
  actionSheetBackdrop.classList.add('open');
}
function closeHoldingSheet() {
  actionSheetBackdrop.classList.remove('open');
}
actionSheetBackdrop.addEventListener('click', e => { if (e.target === actionSheetBackdrop) closeHoldingSheet(); });

/**
 * Swipe-down-to-dismiss: drag the sheet down past a threshold (or
 * flick it fast) to close, otherwise it snaps back up. Standard
 * mobile bottom-sheet behavior.
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
    const draggedFarEnough = currentY > 100; // px threshold to count as "dismiss"
    if (draggedFarEnough) {
      onClose();
    }
    sheetEl.style.transform = ''; // let the .open class's CSS transform take back over
    currentY = 0;
  });
})(document.querySelector('#actionSheetBackdrop .action-sheet'), closeHoldingSheet);

document.getElementById('sheetTradeBtn').addEventListener('click', () => {
  const h = findHolding(sheetSym, sheetExch);
  closeHoldingSheet();
  openModal(sheetSym, sheetExch, h ? h.ltp : 0);
});

/* ── SORT & FILTER (client-side, per session — not persisted) ────── */
let holdSortState = { filterExch: 'ALL', sortBy: null, dir: 'asc' };

const holdSortBtn     = document.getElementById('holdSortBtn');
const holdSortPopover = document.getElementById('holdSortPopover');

if (holdSortBtn) {
  holdSortBtn.addEventListener('click', e => {
    e.stopPropagation();
    holdSortPopover.classList.toggle('open');
  });
}
document.addEventListener('click', e => {
  if (holdSortPopover && !holdSortPopover.contains(e.target) && e.target !== holdSortBtn) {
    holdSortPopover.classList.remove('open');
  }
});

function refreshHoldSortUI() {
  holdSortPopover.querySelectorAll('[data-filter-exch]').forEach(b => b.classList.toggle('active', b.dataset.filterExch === holdSortState.filterExch));
  holdSortPopover.querySelectorAll('[data-sort-by]').forEach(b => b.classList.toggle('active', b.dataset.sortBy === holdSortState.sortBy));
  holdSortPopover.querySelectorAll('[data-dir]').forEach(b => b.classList.toggle('active', b.dataset.dir === holdSortState.dir));
  holdSortBtn.textContent = (holdSortState.sortBy || holdSortState.filterExch !== 'ALL') ? '⇅ Sort •' : '⇅ Sort';
}

holdSortPopover.querySelectorAll('[data-filter-exch]').forEach(btn => {
  btn.addEventListener('click', () => {
    holdSortState.filterExch = btn.dataset.filterExch;
    refreshHoldSortUI();
    renderHoldings();
  });
});
holdSortPopover.querySelectorAll('[data-sort-by]').forEach(btn => {
  btn.addEventListener('click', () => {
    holdSortState.sortBy = holdSortState.sortBy === btn.dataset.sortBy ? null : btn.dataset.sortBy;
    refreshHoldSortUI();
    renderHoldings();
  });
});
holdSortPopover.querySelectorAll('[data-dir]').forEach(btn => {
  btn.addEventListener('click', () => {
    holdSortState.dir = btn.dataset.dir;
    refreshHoldSortUI();
    renderHoldings();
  });
});
document.getElementById('holdSortClear').addEventListener('click', () => {
  holdSortState = { filterExch: 'ALL', sortBy: null, dir: 'asc' };
  refreshHoldSortUI();
  renderHoldings();
});
refreshHoldSortUI();

/**
 * Applies the current filter + sort to the holdings array before
 * display. P&L/%-change/invested figures are computed live here
 * (they depend on the current LTP, same as the underlying table).
 */
function applyHoldSortFilter(items) {
  let out = holdSortState.filterExch === 'ALL' ? items.slice() : items.filter(h => h.exch === holdSortState.filterExch);

  if (holdSortState.sortBy) {
    const dirMul = holdSortState.dir === 'desc' ? -1 : 1;
    out.sort((a, b) => {
      const aInvested = a.qty * a.avg_price, bInvested = b.qty * b.avg_price;
      const aCurrent  = a.qty * a.ltp,       bCurrent  = b.qty * b.ltp;
      const aPnl = aCurrent - aInvested,     bPnl = bCurrent - bInvested;
      let av, bv;
      switch (holdSortState.sortBy) {
        case 'alpha':    av = a.symbol; bv = b.symbol; return av.localeCompare(bv) * dirMul;
        case 'chg':      av = a.avg_price ? (a.ltp - a.avg_price) / a.avg_price : -Infinity;
                         bv = b.avg_price ? (b.ltp - b.avg_price) / b.avg_price : -Infinity; break;
        case 'ltp':      av = a.ltp; bv = b.ltp; break;
        case 'pnl':      av = aPnl; bv = bPnl; break;
        case 'pnlpct':   av = aInvested ? aPnl / aInvested : -Infinity;
                         bv = bInvested ? bPnl / bInvested : -Infinity; break;
        case 'invested': av = aInvested; bv = bInvested; break;
        default: return 0;
      }
      return (av - bv) * dirMul;
    });
  }

  return out;
}

function renderHoldings() {
  holdingCount.textContent = `${holdings.length} scrip${holdings.length === 1 ? '' : 's'}`;

  if (holdings.length === 0) {
    holdingsBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-3); padding:32px 20px;">
      No holdings yet — head to the <a href="index.html" class="form-link">Watchlist</a> to place your first trade.
    </td></tr>`;
    statInvested.textContent = '₹0.00';
    statCurrent.textContent = '₹0.00';
    statPnl.textContent = '₹0.00';
    statPnl.className = 'stat-value mono';
    statPnlPct.textContent = '';
    statPnlPct.className = 'stat-pct mono';
    lastUnrealizedPnl = 0;
    updateOverallPnl();
    return;
  }

  const displayed = applyHoldSortFilter(holdings);

  if (!displayed.length) {
    holdingsBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-3); padding:32px 20px;">No holdings match this filter.</td></tr>`;
  }

  // Totals always reflect ALL holdings, not just the filtered/sorted view
  let totalInvested = 0, totalCurrent = 0;
  holdings.forEach(h => {
    totalInvested += h.qty * h.avg_price;
    totalCurrent  += h.qty * h.ltp;
  });

  if (displayed.length) {
    holdingsBody.innerHTML = displayed.map(h => {
      const invested = h.qty * h.avg_price;
      const current = h.qty * h.ltp;
      const pnl = current - invested;
      const pnlClass = pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : 'neutral';
      const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

      return `
        <tr data-sym="${h.symbol}" data-exch="${h.exch}">
          <td>
            <span class="cell-sym">${h.symbol}</span>
            <span class="cell-exch">${h.exch}</span>
          </td>
          <td class="align-right mono">${h.qty}</td>
          <td class="align-right cell-price">₹${fmt(h.avg_price)}</td>
          <td class="align-right cell-price">₹${fmt(h.ltp)}</td>
          <td class="align-right cell-price">₹${fmt(invested)}</td>
          <td class="align-right cell-price">₹${fmt(current)}</td>
          <td class="align-center cell-chg ${pnlClass}">${pnl >= 0 ? '+' : ''}₹${fmt(pnl)} <span class="row-pct">(${pnlPct >= 0 ? '+' : ''}${fmt(pnlPct)}%)</span></td>
          <td class="align-right">
            <button class="btn-trade" data-sym="${h.symbol}" data-exch="${h.exch}" data-ltp="${h.ltp}">Trade</button>
          </td>
        </tr>`;
    }).join('');
  }

  const totalPnl = totalCurrent - totalInvested;
  statInvested.textContent = '₹' + fmt(totalInvested);
  statCurrent.textContent = '₹' + fmt(totalCurrent);
  statPnl.textContent = (totalPnl >= 0 ? '+' : '') + '₹' + fmt(totalPnl);
  statPnl.className = 'stat-value mono ' + (totalPnl > 0 ? 'positive' : totalPnl < 0 ? 'negative' : '');

  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
  statPnlPct.textContent = totalInvested > 0 ? `${totalPnlPct >= 0 ? '+' : ''}${fmt(totalPnlPct)}%` : '';
  statPnlPct.className = 'stat-pct mono ' + (totalPnl > 0 ? 'positive' : totalPnl < 0 ? 'negative' : '');

  lastUnrealizedPnl = totalPnl;
  updateOverallPnl();

  document.querySelectorAll('.btn-trade').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openModal(btn.dataset.sym, btn.dataset.exch, parseFloat(btn.dataset.ltp));
    });
  });

  // Mobile: whole row tappable, opens a detail sheet with Trade
  // inside instead of relying on the cramped Action column.
  if (window.innerWidth <= 700) {
    document.querySelectorAll('#holdingsBody tr[data-sym]').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        openHoldingSheet(row.dataset.sym, row.dataset.exch);
      });
    });
  }
}

async function refreshAll() {
  try {
    await loadHoldings();
    await refreshLivePrices();
    renderHoldings();
  } catch (err) {
    holdingsBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--negative); padding:32px 20px;">${err.message}</td></tr>`;
  }
}

refreshBalance();
refreshAll();
refreshRealizedPnl();

/* ── PDF EXPORT ───────────────────────────────────────────────────── */
document.getElementById('exportPdfBtn').addEventListener('click', async () => {
  const btn = document.getElementById('exportPdfBtn');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Generating…';

  try {
    const res = await fetch('api/orders.php?scope=all', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load trade history.');

    const orders = (data.orders || []).filter(o => o.status === 'EXECUTED');
    if (!orders.length) { showToast('No executed trades yet to export.'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const userName = (cachedUser && cachedUser.name) || 'PaperDesk User';
    const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

    doc.setFontSize(16);
    doc.text('PaperDesk — Trade History & P&L Report', 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Account: ${userName}`, 14, 25);
    doc.text(`Generated: ${now}`, 14, 30);

    // Summary block
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text('Summary', 14, 40);
    doc.setFontSize(10);
    doc.text(`Unrealized P&L: ${lastUnrealizedPnl >= 0 ? '+' : ''}Rs. ${fmt(lastUnrealizedPnl)}`, 14, 47);
    doc.text(`Realized P&L: ${realizedPnl >= 0 ? '+' : ''}Rs. ${fmt(realizedPnl)}`, 14, 53);
    doc.text(`Overall P&L: ${(lastUnrealizedPnl + realizedPnl) >= 0 ? '+' : ''}Rs. ${fmt(lastUnrealizedPnl + realizedPnl)}`, 14, 59);
    doc.text(`Cash Available: Rs. ${fmt(cashBalance)}`, 14, 65);
    const rows = orders.map(o => [
      o.symbol,
      o.exch,
      o.side,
      o.order_type === 'MARKET' ? 'Market' : o.order_type,
      o.qty,
      'Rs.' + fmt(o.executed_price ?? o.price),
      o.realized_pnl !== null ? (o.realized_pnl >= 0 ? '+' : '') + 'Rs.' + fmt(o.realized_pnl) : '—',
      new Date(o.executed_at || o.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }),
    ]);

    doc.autoTable({
      startY: 72,
      head: [['Symbol', 'Exch', 'Side', 'Type', 'Qty', 'Price', 'Realized P&L', 'Executed At']],
      body: rows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
      didParseCell: (hookData) => {
        // Color realized P&L cells green/red in the PDF too
        if (hookData.column.index === 6 && hookData.section === 'body') {
          const raw = orders[hookData.row.index].realized_pnl;
          if (raw !== null) hookData.cell.styles.textColor = raw >= 0 ? [0, 150, 110] : [200, 40, 70];
        }
      },
    });

    doc.save(`paperdesk-trade-history-${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});
setInterval(async () => { await refreshLivePrices(); renderHoldings(); await refreshRealizedPnl(); }, 5000);

/* ── ORDER MODAL (market orders only) ────────────────────────────── */
const backdrop = document.getElementById('modalBackdrop');
const sideBuy = document.getElementById('sideBuy');
const sideSell = document.getElementById('sideSell');
const placeBtn = document.getElementById('placeBtn');
const qtyInput = document.getElementById('qty');
const orderEst = document.getElementById('orderEst');
const cashAvailableEl = document.getElementById('cashAvailable');
const heldQtyDisplay = document.getElementById('heldQtyDisplay');

let currentSide = 'BUY', currentLtp = 0, currentSym = '', currentExch = 'NSE';
let currentOrderType = 'MARKET';

const orderTypeNote = document.getElementById('orderTypeNote');
const priceFieldsRow = document.getElementById('priceFieldsRow');
const limitPriceField = document.getElementById('limitPriceField');
const triggerPriceField = document.getElementById('triggerPriceField');
const limitPriceInput = document.getElementById('limitPriceInput');
const triggerPriceInput = document.getElementById('triggerPriceInput');

const ORDER_TYPE_NOTES = {
  MARKET: 'Market order — executes instantly at the current live price.',
  LIMIT: 'Limit order — fills automatically once the price reaches your limit, even if the app is closed.',
  'SL-M': 'Stop-loss (market) — protects this holding by selling at market the instant price drops to your trigger.',
  'SL-L': 'Stop-loss (limit) — once price drops to your trigger, it becomes a limit sell at your limit price.',
};

function updateOrderType(type) {
  currentOrderType = type;
  document.querySelectorAll('.ot-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  orderTypeNote.textContent = ORDER_TYPE_NOTES[type];

  const needsLimit = type === 'LIMIT' || type === 'SL-L';
  const needsTrigger = type === 'SL-M' || type === 'SL-L';
  priceFieldsRow.style.display = (needsLimit || needsTrigger) ? 'grid' : 'none';
  limitPriceField.style.display = needsLimit ? 'flex' : 'none';
  triggerPriceField.style.display = needsTrigger ? 'flex' : 'none';

  if (needsLimit && !limitPriceInput.value) limitPriceInput.value = currentLtp.toFixed(2);
  if (needsTrigger && !triggerPriceInput.value) triggerPriceInput.value = currentLtp.toFixed(2);

  updatePlaceBtnLabel();
}

document.querySelectorAll('.ot-btn').forEach(btn => {
  btn.addEventListener('click', () => updateOrderType(btn.dataset.type));
});

function findHolding(sym, exch) {
  return holdings.find(h => h.symbol === sym && h.exch === exch);
}

function openModal(sym, exch, ltp) {
  currentSym = sym; currentExch = exch || 'NSE'; currentLtp = ltp; currentSide = 'BUY';
  document.getElementById('modalSymbol').textContent = sym;
  document.getElementById('modalName').textContent = currentExch;
  document.getElementById('modalLtp').textContent = '₹' + fmt(ltp);
  qtyInput.value = '1';
  limitPriceInput.value = ''; triggerPriceInput.value = '';
  updateOrderType('MARKET');
  updateSide('BUY'); updateEst(); updateHeldQtyDisplay();
  cashAvailableEl.textContent = '₹' + fmt(cashBalance);
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

function updateHeldQtyDisplay() {
  const h = findHolding(currentSym, currentExch);
  heldQtyDisplay.value = h ? `${h.qty} shares` : '0 shares';
}

function updateSide(side) {
  currentSide = side;
  sideBuy.classList.toggle('active', side === 'BUY');
  sideSell.classList.toggle('active', side === 'SELL');
  updatePlaceBtnLabel();
  updateHeldQtyDisplay();

  // Opened from Portfolio, so a Sell almost always means "sell what I
  // hold" — default the qty to the full held quantity instead of 1.
  // Switching back to Buy resets to 1, since that's a fresh purchase.
  const h = findHolding(currentSym, currentExch);
  if (side === 'SELL' && h && h.qty > 0) {
    qtyInput.value = h.qty;
  } else if (side === 'BUY') {
    qtyInput.value = '1';
  }
  updateEst();
}

function updatePlaceBtnLabel() {
  const prefix = currentOrderType === 'MARKET' ? '' : `${currentOrderType} `;
  const sideLabel = currentSide === 'BUY' ? 'ADD MORE' : 'EXIT'; // display only — order payload still sends BUY/SELL
  placeBtn.textContent = `${prefix}${sideLabel} ${currentSym}`;
  placeBtn.className = `btn-place ${currentSide === 'BUY' ? 'buy' : 'sell'}`;
}

sideBuy.addEventListener('click', () => updateSide('BUY'));
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
    const res = await fetch('api/trade.php', {
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
      statCash.textContent = '₹' + fmt(cashBalance);
      showToast(`✓ ${data.side} ${qty} ${currentSym} @ ₹${fmt(data.price)} — Executed`);
      await refreshAll();
      await refreshRealizedPnl();
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    placeBtn.disabled = false;
    placeBtn.textContent = originalText;
  }
});
