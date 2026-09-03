'use strict';

const API = '';

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

const navLoginBtn = document.getElementById('navLoginBtn');
const navUser     = document.getElementById('navUser');
const avatarInitial   = document.getElementById('avatarInitial');
const avatarBtn       = document.getElementById('avatarBtn');
const avatarDropdown  = document.getElementById('avatarDropdown');
const avatarDropdownName = document.getElementById('avatarDropdownName');
const navLogout   = document.getElementById('navLogout');
const mobileLoginLink = document.getElementById('mobileLoginLink');

function initials(fullName) {
  return fullName.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

// Renders the user's Google profile photo in the navbar avatar when one
// is available; otherwise leaves the existing initials circle as-is.
function renderAvatar(u) {
  if (u.picture) {
    const img = document.createElement('img');
    img.src = u.picture;
    img.alt = u.name;
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
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
  renderAvatar(cachedUser);
  avatarDropdownName.textContent = cachedUser.name;
  mobileLoginLink.textContent = 'Logout';
  mobileLoginLink.href = '#';
  mobileLoginLink.addEventListener('click', e => { e.preventDefault(); logout(); });
}

/* ── LOAD PROFILE ───────────────────────────────────────────────── */
const form           = document.getElementById('profileForm');
const nameInput       = document.getElementById('profileName');
const emailInput      = document.getElementById('profileEmail');
const dobInput         = document.getElementById('profileDob');
const genderInput      = document.getElementById('profileGender');
const createdInput     = document.getElementById('profileCreated');
const lastLoginInput   = document.getElementById('profileLastLogin');
const errorBox         = document.getElementById('profileError');
const successBox       = document.getElementById('profileSuccess');
const btn              = document.getElementById('profileBtn');
const spinner          = document.getElementById('profileSpinner');

let authProvider = 'password';

async function loadProfile() {
  try {
    const res  = await fetch('api/profile.php', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load profile.');

    nameInput.value    = data.user.name || '';
    emailInput.value   = data.user.email || '';
    dobInput.value     = data.user.dob ? data.user.dob.slice(0, 10) : '';
    genderInput.value  = data.user.gender || '';
    createdInput.value = data.user.created_at
      ? new Date(data.user.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
      : '';
    lastLoginInput.value = data.user.last_login_at
      ? new Date(data.user.last_login_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
      : 'This session';
    authProvider = data.user.auth_provider || 'password';
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.add('show');
  }
}
loadProfile();

/* ── SAVE PROFILE ───────────────────────────────────────────────── */
form.addEventListener('submit', async e => {
  e.preventDefault();
  errorBox.classList.remove('show');
  successBox.style.display = 'none';

  btn.disabled = true;
  spinner.classList.add('show');

  try {
    const res = await fetch('api/profile.php', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        name:   nameInput.value.trim(),
        dob:    dobInput.value,
        gender: genderInput.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update profile.');

    // Update cached user for navbar display
    const updated = JSON.parse(sessionStorage.getItem('pd_user') || '{}');
    updated.name = data.user.name;
    sessionStorage.setItem('pd_user', JSON.stringify(updated));
    renderAvatar(updated);
    avatarDropdownName.textContent = data.user.name;

    successBox.textContent = 'Profile updated successfully.';
    successBox.style.display = 'block';
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.add('show');
  } finally {
    btn.disabled = false;
    spinner.classList.remove('show');
  }
});

/* ── DELETE ACCOUNT ─────────────────────────────────────────────── */
const deleteAccountBtn    = document.getElementById('deleteAccountBtn');
const deleteBackdrop      = document.getElementById('deleteBackdrop');
const deleteModalClose    = document.getElementById('deleteModalClose');
const deletePasswordGroup = document.getElementById('deletePasswordGroup');
const deleteTypeGroup     = document.getElementById('deleteTypeGroup');
const deletePasswordInput = document.getElementById('deletePasswordInput');
const deleteConfirmInput  = document.getElementById('deleteConfirmInput');
const deleteError         = document.getElementById('deleteError');
const deleteConfirmBtn    = document.getElementById('deleteConfirmBtn');
const deleteSpinner       = document.getElementById('deleteSpinner');

function openDeleteModal() {
  deleteError.classList.remove('show');
  deletePasswordInput.value = '';
  deleteConfirmInput.value  = '';

  // Password accounts confirm with their current password; Google-only
  // accounts have no password to check, so they type DELETE instead.
  const isPasswordAccount = authProvider !== 'google';
  deletePasswordGroup.style.display = isPasswordAccount ? 'block' : 'none';
  deleteTypeGroup.style.display     = isPasswordAccount ? 'none' : 'block';

  deleteBackdrop.classList.add('open');
}
function closeDeleteModal() {
  deleteBackdrop.classList.remove('open');
}

deleteAccountBtn.addEventListener('click', openDeleteModal);
deleteModalClose.addEventListener('click', closeDeleteModal);
deleteBackdrop.addEventListener('click', e => { if (e.target === deleteBackdrop) closeDeleteModal(); });

deleteConfirmBtn.addEventListener('click', async () => {
  deleteError.classList.remove('show');

  const isPasswordAccount = authProvider !== 'google';
  const payload = isPasswordAccount
    ? { password: deletePasswordInput.value }
    : { confirm: deleteConfirmInput.value };

  if (isPasswordAccount && !payload.password) {
    deleteError.textContent = 'Enter your password to confirm.';
    deleteError.classList.add('show');
    return;
  }
  if (!isPasswordAccount && payload.confirm.trim().toUpperCase() !== 'DELETE') {
    deleteError.textContent = 'Type DELETE exactly to confirm.';
    deleteError.classList.add('show');
    return;
  }

  deleteConfirmBtn.disabled = true;
  deleteSpinner.classList.add('show');

  try {
    const res = await fetch('api/delete-account.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete account.');

    // Account is gone server-side — clear the local session and send
    // them to the public homepage rather than the login screen, since
    // there's nothing left to log back into.
    sessionStorage.removeItem('pd_token');
    sessionStorage.removeItem('pd_user');
    window.location.href = 'landing.html';
  } catch (err) {
    deleteError.textContent = err.message;
    deleteError.classList.add('show');
    deleteConfirmBtn.disabled = false;
    deleteSpinner.classList.remove('show');
  }
});
