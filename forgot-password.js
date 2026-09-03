'use strict';

const html = document.documentElement;
html.setAttribute('data-theme', localStorage.getItem('pd_theme') || 'dark');
document.getElementById('themeToggle').addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('pd_theme', next);
});

const form       = document.getElementById('forgotForm');
const errorBox   = document.getElementById('forgotError');
const successBox = document.getElementById('forgotSuccess');
const btn        = document.getElementById('forgotBtn');
const spinner    = document.getElementById('forgotSpinner');

form.addEventListener('submit', async e => {
  e.preventDefault();
  errorBox.classList.remove('show');
  successBox.style.display = 'none';

  const email = document.getElementById('forgotEmail').value.trim();
  btn.disabled = true;
  spinner.classList.add('show');

  try {
    const res  = await fetch('api/forgot-password.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');

    successBox.textContent = data.message + ' Redirecting...';
    successBox.style.display = 'block';
    form.reset();

    setTimeout(() => {
      window.location.href = 'verify-otp.html?email=' + encodeURIComponent(email);
    }, 900);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.add('show');
  } finally {
    btn.disabled = false;
    spinner.classList.remove('show');
  }
});
