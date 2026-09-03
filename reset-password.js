'use strict';

const html = document.documentElement;
html.setAttribute('data-theme', localStorage.getItem('pd_theme') || 'dark');
document.getElementById('themeToggle').addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('pd_theme', next);
});

const resetPassword = document.getElementById('resetPassword');

// Same mandatory policy as signup (login.js) — kept in sync manually
// since these are separate pages/bundles; re-checked server-side too.
const PASSWORD_RULES = [
  { key: 'len',     test: pw => pw.length >= 8,          },
  { key: 'upper',   test: pw => /[A-Z]/.test(pw),        },
  { key: 'number',  test: pw => /[0-9]/.test(pw),        },
  { key: 'special', test: pw => /[^A-Za-z0-9]/.test(pw), },
];

function passwordMeetsRules(pw) {
  return PASSWORD_RULES.every(r => r.test(pw));
}

function updatePwChecklist(prefix, pw) {
  PASSWORD_RULES.forEach(r => {
    const el = document.getElementById(prefix + r.key.charAt(0).toUpperCase() + r.key.slice(1));
    if (el) el.classList.toggle('met', r.test(pw));
  });
}

resetPassword.addEventListener('input', () => {
  updatePwChecklist('resetRule', resetPassword.value);
});

document.querySelectorAll('.eye-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    input.type  = input.type === 'password' ? 'text' : 'password';
  });
});

// Reset token comes from sessionStorage, set by verify-otp.js after a
// successful OTP check — never exposed in the URL.
const resetToken = sessionStorage.getItem('pd_reset_token') || '';
const email      = sessionStorage.getItem('pd_reset_email') || '';

const form       = document.getElementById('resetForm');
const errorBox   = document.getElementById('resetError');
const successBox = document.getElementById('resetSuccess');
const btn        = document.getElementById('resetBtn');
const spinner    = document.getElementById('resetSpinner');

if (!resetToken || !email) {
  errorBox.textContent = 'Your reset session has expired. Please start over.';
  errorBox.classList.add('show');
  form.querySelector('button[type="submit"]').disabled = true;
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  errorBox.classList.remove('show');
  successBox.style.display = 'none';

  const password = document.getElementById('resetPassword').value;
  const confirm  = document.getElementById('resetConfirm').value;

  if (!passwordMeetsRules(password)) {
    errorBox.textContent = 'Password must meet all the requirements listed below.';
    errorBox.classList.add('show');
    return;
  }
  if (password !== confirm) {
    errorBox.textContent = 'Passwords do not match.';
    errorBox.classList.add('show');
    return;
  }

  btn.disabled = true;
  spinner.classList.add('show');

  try {
    const res  = await fetch('api/reset-password.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, reset_token: resetToken, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to reset password.');

    sessionStorage.removeItem('pd_reset_token');
    sessionStorage.removeItem('pd_reset_email');

    successBox.textContent = data.message + ' Redirecting to sign in...';
    successBox.style.display = 'block';
    form.reset();
    setTimeout(() => { window.location.href = 'login.html'; }, 1800);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.add('show');
  } finally {
    btn.disabled = false;
    spinner.classList.remove('show');
  }
});
