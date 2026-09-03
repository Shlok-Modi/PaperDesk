/* ────────────────────────────────────────────────────────────────
   PaperDesk — login.js
   Handles: tab switch, form validation, password strength,
   eye toggle, API calls to backend, session storage
────────────────────────────────────────────────────────────────── */

'use strict';

const API = ''; // Same origin — XAMPP serves both frontend and API // Backend URL — change in production

/* ── THEME ──────────────────────────────────────────────────────── */
const html        = document.documentElement;
const themeToggle = document.getElementById('themeToggle');
const saved       = localStorage.getItem('pd_theme') || 'dark';
html.setAttribute('data-theme', saved);
themeToggle.addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('pd_theme', next);
});

/* ── REDIRECT IF ALREADY LOGGED IN ─────────────────────────────── */
if (sessionStorage.getItem('pd_token')) {
  window.location.href = 'index.html';
}

/* ── IDLE-LOGOUT NOTICE ─────────────────────────────────────────── */
if (new URLSearchParams(window.location.search).get('reason') === 'idle') {
  window.addEventListener('DOMContentLoaded', () => {
    showToast("You were signed out due to inactivity.");
  });
}

/* ── TAB SWITCHING ──────────────────────────────────────────────── */
const tabLogin    = document.getElementById('tabLogin');
const tabSignup   = document.getElementById('tabSignup');
const loginForm   = document.getElementById('loginForm');
const signupForm  = document.getElementById('signupForm');

function showTab(tab) {
  const isLogin = tab === 'login';
  tabLogin.classList.toggle('active', isLogin);
  tabSignup.classList.toggle('active', !isLogin);
  loginForm.classList.toggle('hidden', !isLogin);
  signupForm.classList.toggle('hidden', isLogin);
  clearErrors();
}

tabLogin.addEventListener('click',  () => showTab('login'));
tabSignup.addEventListener('click', () => showTab('signup'));

// Cross-links inside forms
document.getElementById('switchToSignup').addEventListener('click', e => {
  e.preventDefault(); showTab('signup');
});
document.getElementById('switchToLogin').addEventListener('click', e => {
  e.preventDefault(); showTab('login');
});

/* ── EYE TOGGLES ────────────────────────────────────────────────── */
document.querySelectorAll('.eye-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    input.type  = input.type === 'password' ? 'text' : 'password';
    btn.style.color = input.type === 'text'
      ? 'var(--accent)' : 'var(--text-3)';
  });
});

/* ── PASSWORD REQUIREMENTS (enforced, not just cosmetic) ─────────
   These are the mandatory rules — separate from the STRENGTH meter
   above, which still grades overall strength for feedback but no
   longer decides whether a password is *allowed*. Same checks are
   re-run server-side in signup.php, since client-side JS can always
   be bypassed. */
const PASSWORD_RULES = [
  { key: 'len',     test: pw => pw.length >= 8,          },
  { key: 'upper',   test: pw => /[A-Z]/.test(pw),        },
  { key: 'number',  test: pw => /[0-9]/.test(pw),        },
  { key: 'special', test: pw => /[^A-Za-z0-9]/.test(pw), },
];

function passwordMeetsRules(pw) {
  return PASSWORD_RULES.every(r => r.test(pw));
}

/** Updates a checklist's <li data-rule="..."> items to reflect which
 *  rules the given password currently satisfies. `prefix` is the
 *  id prefix used for each <li> (e.g. 'signupRule' -> 'signupRuleLen'). */
function updatePwChecklist(prefix, pw) {
  PASSWORD_RULES.forEach(r => {
    const el = document.getElementById(prefix + r.key.charAt(0).toUpperCase() + r.key.slice(1));
    if (el) el.classList.toggle('met', r.test(pw));
  });
}

/* ── PASSWORD STRENGTH ───────────────────────────────────────────── */
const signupPassword = document.getElementById('signupPassword');
const strengthFill   = document.getElementById('strengthFill');
const strengthLabel  = document.getElementById('strengthLabel');

const STRENGTH = [
  { test: pw => pw.length >= 8,                   points: 1 },
  { test: pw => /[A-Z]/.test(pw),                 points: 1 },
  { test: pw => /[0-9]/.test(pw),                 points: 1 },
  { test: pw => /[^A-Za-z0-9]/.test(pw),          points: 1 },
  { test: pw => pw.length >= 12,                  points: 1 },
];

const LEVELS = [
  { label: '',           color: 'transparent',  w: '0%'   },
  { label: 'Too weak',   color: 'var(--negative)', w: '20%' },
  { label: 'Weak',       color: '#F5A623',       w: '40%'  },
  { label: 'Fair',       color: '#F5A623',       w: '60%'  },
  { label: 'Good',       color: 'var(--positive)', w: '80%'},
  { label: 'Strong',     color: 'var(--positive)', w: '100%'},
];

signupPassword.addEventListener('input', () => {
  const pw    = signupPassword.value;
  const score = pw ? STRENGTH.reduce((s, r) => s + (r.test(pw) ? r.points : 0), 0) : 0;
  const lvl   = LEVELS[score];
  strengthFill.style.width      = lvl.w;
  strengthFill.style.background = lvl.color;
  strengthLabel.textContent     = lvl.label;
  strengthLabel.style.color     = lvl.color;
  updatePwChecklist('signupRule', pw);
});

/* ── ERROR HELPERS ───────────────────────────────────────────────── */
function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add('show');
}

function clearErrors() {
  document.querySelectorAll('.form-error').forEach(el => {
    el.classList.remove('show');
    el.textContent = '';
  });
  document.querySelectorAll('.form-input').forEach(el => {
    el.classList.remove('error');
  });
}

function setLoading(formType, loading) {
  const btn     = document.getElementById(`${formType}Btn`);
  const spinner = document.getElementById(`${formType}Spinner`);
  const text    = btn.querySelector('.btn-auth-text');
  btn.disabled  = loading;
  spinner.classList.toggle('show', loading);
  text.style.opacity = loading ? '0.6' : '1';
}

/* ── TOAST ───────────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

/* ── SAVE SESSION ────────────────────────────────────────────────── */
function saveSession(user, token) {
  sessionStorage.setItem('pd_token', token);
  sessionStorage.setItem('pd_user',  JSON.stringify({
    id:      user.id,
    name:    user.name,
    email:   user.email,
    picture: user.picture_url || null,
  }));
}

/* ── LOGIN ───────────────────────────────────────────────────────── */
loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors();

  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) {
    showError('loginError', 'Please fill in all fields.');
    return;
  }

  setLoading('login', true);

  try {
    const res  = await fetch(`${API}api/login.php`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.code === 'EMAIL_NOT_VERIFIED') {
        showToast('Please verify your email first — redirecting…');
        setTimeout(() => {
          window.location.href = `verify-otp.html?email=${encodeURIComponent(data.email || email)}&purpose=signup`;
        }, 800);
        return;
      }
      throw new Error(data.error || 'Login failed. Please try again.');
    }

    saveSession(data.user, data.token);
    showToast('Welcome back, ' + data.user.name + '!');

    setTimeout(() => { window.location.href = 'index.html'; }, 800);

  } catch (err) {
    showError('loginError', err.message);
    document.getElementById('loginPassword').classList.add('error');
  } finally {
    setLoading('login', false);
  }
});

/* ── SIGNUP ──────────────────────────────────────────────────────── */
signupForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors();

  const name     = document.getElementById('signupName').value.trim();
  const email    = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const confirm  = document.getElementById('signupConfirm').value;

  // Client-side validation
  if (!name || !email || !password || !confirm) {
    showError('signupError', 'Please fill in all fields.');
    return;
  }
  if (name.length < 2) {
    showError('signupError', 'Name must be at least 2 characters.');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError('signupError', 'Please enter a valid email address.');
    document.getElementById('signupEmail').classList.add('error');
    return;
  }
  if (!passwordMeetsRules(password)) {
    showError('signupError', 'Password must meet all the requirements listed below.');
    document.getElementById('signupPassword').classList.add('error');
    return;
  }
  if (password !== confirm) {
    showError('signupError', 'Passwords do not match.');
    document.getElementById('signupConfirm').classList.add('error');
    return;
  }

  setLoading('signup', true);

  try {
    const res  = await fetch(`${API}api/signup.php`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Signup failed. Please try again.');
    }

    // Account created but not yet verified — send them to the OTP
    // screen instead of straight into the app.
    showToast(data.message || 'Check your email for a verification code.');
    setTimeout(() => {
      window.location.href = `verify-otp.html?email=${encodeURIComponent(data.email || email)}&purpose=signup`;
    }, 600);

  } catch (err) {
    showError('signupError', err.message);
  } finally {
    setLoading('signup', false);
  }
});

/* Forgot password now links directly to forgot-password.html */

/* ── GOOGLE SIGN-IN ──────────────────────────────────────────────── */
// Same client ID as api/config.php's GOOGLE_CLIENT_ID — must match or
// Google will refuse to render the button / issue tokens.
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com';

function initGoogleSignIn() {
  if (!window.google?.accounts?.id) {
    // GSI script hasn't loaded yet (slow network) — retry shortly.
    setTimeout(initGoogleSignIn, 200);
    return;
  }

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback:  handleGoogleCredential,
  });

  google.accounts.id.renderButton(
    document.getElementById('googleSignInBtn'),
    {
      theme: 'outline',
      size:  'large',
      shape: 'pill',
      width: document.getElementById('googleSignInBtn').offsetWidth,
    }
  );
}

async function handleGoogleCredential(response) {
  clearErrors();
  try {
    const res  = await fetch(`${API}api/google-login.php`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ credential: response.credential }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Google sign-in failed. Please try again.');
    }

    saveSession(data.user, data.token);
    showToast('Welcome, ' + data.user.name + '!');

    setTimeout(() => { window.location.href = 'index.html'; }, 800);

  } catch (err) {
    const errorTarget = loginForm.classList.contains('hidden') ? 'signupError' : 'loginError';
    showError(errorTarget, err.message);
  }
}

initGoogleSignIn();
