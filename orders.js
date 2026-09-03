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
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/* ── LOAD ORDERS ────────────────────────────────────────────────── */
const ordersBody  = document.getElementById('ordersBody');
const orderCount  = document.getElementById('orderCount');

const STATUS_STYLES = {
  EXECUTED:  '',
  PENDING:   'style="background:rgba(255,193,7,0.15); color:#d9a441;"',
  TRIGGERED: 'style="background:rgba(255,193,7,0.15); color:#d9a441;"',
  CANCELLED: 'style="opacity:0.6;"',
  REJECTED:  'style="background:rgba(255,77,106,0.15); color:var(--negative);"',
};

async function loadOrders() {
  try {
    // No ?scope= param -> api/orders.php defaults to today's orders
    // only (compared against the DB server's date). Once the
    // calendar day rolls over, today's fills move into Positions (if
    // still open) or Portfolio (once carried past midnight), and the
    // full record lives on in Reports → TradeBook.
    const res  = await fetch('api/orders.php', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load orders.');

    const orders = data.orders || [];
    orderCount.textContent = `${orders.length} order${orders.length === 1 ? '' : 's'}`;

    if (orders.length === 0) {
      ordersBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-3); padding:32px 20px;">
        No orders placed today — head to the <a href="index.html" class="form-link">Watchlist</a> to place one,
        or check <a href="reports.html" class="form-link">Reports → TradeBook</a> for past orders.
      </td></tr>`;
      return;
    }

    ordersBody.innerHTML = orders.map(o => {
      const sideClass = o.side === 'BUY' ? 'positive' : 'negative';
      const isPending = o.status === 'PENDING' || o.status === 'TRIGGERED';
      // For pending orders there's no fill price yet — show the
      // limit/trigger the user set instead of a misleading "price".
      const refPrice = o.executed_price ?? o.price;
      const total = o.qty * refPrice;
      const typeLabel = o.order_type === 'MARKET' ? 'Market' : o.order_type;

      let priceDetail = `₹${fmt(refPrice)}`;
      if (isPending) {
        const parts = [];
        if (o.limit_price)   parts.push(`Limit ₹${fmt(o.limit_price)}`);
        if (o.trigger_price) parts.push(`Trigger ₹${fmt(o.trigger_price)}`);
        priceDetail = parts.join(' · ') || priceDetail;
      }

      return `
        <tr data-type="${typeLabel}" data-total="${isPending ? '—' : '₹' + fmt(total)}" data-status="${o.status}" data-datetime="${fmtDate(o.created_at)}" data-sym="${o.symbol}" data-exch="${o.exch}" data-id="${o.id}" data-pending="${isPending}">
          <td>
            <span class="cell-sym">${o.symbol}</span>
            <span class="cell-exch">${o.exch}</span>
          </td>
          <td><span class="${sideClass}" style="font-weight:600;">${o.side}</span></td>
          <td class="col-hide-mobile"><span class="panel-badge">${typeLabel}</span></td>
          <td class="align-right mono">${o.qty}</td>
          <td class="align-center cell-price">${priceDetail}</td>
          <td class="align-center cell-price col-hide-mobile">${isPending ? '—' : '₹' + fmt(total)}</td>
          <td><span class="panel-badge" ${STATUS_STYLES[o.status] || ''}>${o.status}</span></td>
          <td class="mono col-hide-mobile" style="color:var(--text-3); font-size:12px;">${fmtDate(o.created_at)}</td>
          <td class="align-right">
            ${window.innerWidth > 700 && isPending ? `<button class="btn-chart cancel-order-btn" data-id="${o.id}">Cancel</button>` : ''}
          </td>
        </tr>`;
    }).join('');

    document.querySelectorAll('.cancel-order-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        cancelOrder(btn.dataset.id, btn);
      });
    });

    // Mobile: tapping a row opens a sheet with the columns that were
    // hidden to avoid horizontal scrolling (Type / Total / Date & Time).
    if (window.innerWidth <= 700) {
      document.querySelectorAll('#ordersBody tr[data-sym]').forEach(row => {
        row.addEventListener('click', e => {
          if (e.target.closest('button')) return;
          openOrderSheet(row.dataset);
        });
      });
    }
  } catch (err) {
    ordersBody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--negative); padding:32px 20px;">${err.message}</td></tr>`;
    showToast(err.message);
  }
}

async function cancelOrder(orderId, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res  = await fetch('api/cancel-order.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ orderId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not cancel order.');
    showToast('Order cancelled.');
    loadOrders();
  } catch (err) {
    showToast(err.message);
    btn.disabled = false;
    btn.textContent = 'Cancel';
  }
}

/* ── MOBILE ORDER DETAIL SHEET ─────────────────────────────────── */
const actionSheetBackdrop = document.getElementById('actionSheetBackdrop');

function openOrderSheet(d) {
  document.getElementById('sheetSymbol').textContent   = d.sym;
  document.getElementById('sheetExch').textContent     = d.exch;
  document.getElementById('sheetType').textContent     = d.type;
  document.getElementById('sheetTotal').textContent    = d.total;
  document.getElementById('sheetStatus').textContent   = d.status;
  document.getElementById('sheetDateTime').textContent = d.datetime;

  const cancelBtn = document.getElementById('sheetCancelBtn');
  cancelBtn.style.display = d.pending === 'true' ? 'block' : 'none';
  cancelBtn.onclick = () => {
    closeOrderSheet();
    cancelOrder(d.id, cancelBtn);
  };

  actionSheetBackdrop.classList.add('open');
}
function closeOrderSheet() {
  actionSheetBackdrop.classList.remove('open');
}
actionSheetBackdrop.addEventListener('click', e => {
  if (e.target === actionSheetBackdrop) closeOrderSheet();
});

// Swipe-down-to-dismiss — same behavior as the Watchlist/Portfolio sheets.
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
})(document.querySelector('#actionSheetBackdrop .action-sheet'), closeOrderSheet);

loadOrders();
// Pending orders can fill any moment via the background order engine
// (order-engine.php), so keep the list fresh without a manual reload.
setInterval(loadOrders, 5000);
