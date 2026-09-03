'use strict';

const html = document.documentElement;
html.setAttribute('data-theme', localStorage.getItem('pd_theme') || 'dark');
document.getElementById('themeToggle').addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('pd_theme', next);
});

const params  = new URLSearchParams(window.location.search);
const email   = params.get('email') || '';
const purpose = params.get('purpose') === 'signup' ? 'signup' : 'password_reset';

const VERIFY_ENDPOINT = purpose === 'signup' ? 'api/verify-signup-otp.php' : 'api/verify-otp.php';
const RESEND_ENDPOINT = purpose === 'signup' ? 'api/resend-signup-otp.php' : 'api/forgot-password.php';

const subtitle   = document.getElementById('otpSubtitle');
const form       = document.getElementById('otpForm');
const boxes      = Array.from(document.querySelectorAll('.otp-box'));
const errorBox   = document.getElementById('otpError');
const successBox = document.getElementById('otpSuccess');
const btn        = document.getElementById('otpBtn');
const spinner    = document.getElementById('otpSpinner');
const resendBtn  = document.getElementById('resendBtn');

if (!email) {
  errorBox.textContent = 'Missing email. Please restart the process.';
  errorBox.classList.add('show');
  form.querySelector('button[type="submit"]').disabled = true;
  resendBtn.disabled = true;
} else {
  subtitle.textContent = `We sent a 6-digit code to ${email}. It expires in 10 minutes.`;
}

// ── OTP box behavior: auto-advance, backspace, paste ──────────────
boxes.forEach((box, i) => {
  box.addEventListener('input', () => {
    box.value = box.value.replace(/[^0-9]/g, '').slice(0, 1);
    if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
  });
  box.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !box.value && i > 0) boxes[i - 1].focus();
  });
  box.addEventListener('paste', e => {
    e.preventDefault();
    const digits = (e.clipboardData.getData('text') || '').replace(/[^0-9]/g, '').slice(0, 6).split('');
    digits.forEach((d, idx) => { if (boxes[idx]) boxes[idx].value = d; });
    const next = boxes[Math.min(digits.length, boxes.length - 1)];
    if (next) next.focus();
  });
});

function getOtp() {
  return boxes.map(b => b.value).join('');
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  errorBox.classList.remove('show');
  successBox.style.display = 'none';

  const otp = getOtp();
  if (otp.length !== 6) {
    errorBox.textContent = 'Please enter all 6 digits.';
    errorBox.classList.add('show');
    return;
  }

  btn.disabled = true;
  spinner.classList.add('show');

  try {
    const res  = await fetch(VERIFY_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, otp }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Verification failed.');

    if (purpose === 'signup') {
      // Verified — the endpoint already returned a login token, so
      // save the session and go straight into the app. Same storage
      // mechanism/shape as login.js's saveSession().
      sessionStorage.setItem('pd_token', data.token);
      sessionStorage.setItem('pd_user', JSON.stringify({
        id:    data.user.id,
        name:  data.user.name,
        email: data.user.email,
      }));

      successBox.textContent = 'Email verified. Redirecting...';
      successBox.style.display = 'block';
      setTimeout(() => { window.location.href = 'index.html'; }, 700);
      return;
    }

    // Stash the reset token for reset-password.html — sessionStorage
    // keeps it off the URL (no risk of it leaking via browser history
    // or referrer headers).
    sessionStorage.setItem('pd_reset_token', data.reset_token);
    sessionStorage.setItem('pd_reset_email', email);

    successBox.textContent = 'Code verified. Redirecting...';
    successBox.style.display = 'block';
    setTimeout(() => { window.location.href = 'reset-password.html'; }, 700);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.add('show');
    boxes.forEach(b => b.value = '');
    boxes[0].focus();
  } finally {
    btn.disabled = false;
    spinner.classList.remove('show');
  }
});

// ── Resend with cooldown ───────────────────────────────────────────
let cooldown = 0;
function tickCooldown() {
  if (cooldown <= 0) {
    resendBtn.disabled = false;
    resendBtn.textContent = 'Resend code';
    return;
  }
  resendBtn.disabled = true;
  resendBtn.textContent = `Resend code (${cooldown}s)`;
  cooldown--;
  setTimeout(tickCooldown, 1000);
}

resendBtn.addEventListener('click', async () => {
  errorBox.classList.remove('show');
  successBox.style.display = 'none';
  try {
    const res  = await fetch(RESEND_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not resend code.');

    successBox.textContent = 'A new code has been sent.';
    successBox.style.display = 'block';
    boxes.forEach(b => b.value = '');
    boxes[0].focus();

    cooldown = 60;
    tickCooldown();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.add('show');
  }
});
