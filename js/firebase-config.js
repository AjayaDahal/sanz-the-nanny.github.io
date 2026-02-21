/* ─────────────────────────────────────────────────
   Firebase Config — Sanz the Nanny
   Placeholders (__*__) are replaced at build time
   by GitHub Actions from repository secrets.
   For local dev, load js/env.js first (gitignored).
   ───────────────────────────────────────────────── */

const _env = (typeof window !== 'undefined' && window.ENV) || {};
function _e(placeholder, envKey) {
  return (placeholder && !placeholder.startsWith('__')) ? placeholder : (_env[envKey] || placeholder);
}

const FIREBASE_CONFIG = {
  apiKey:            _e("__FIREBASE_API_KEY__",            "FIREBASE_API_KEY"),
  authDomain:        _e("__FIREBASE_AUTH_DOMAIN__",        "FIREBASE_AUTH_DOMAIN"),
  databaseURL:       _e("__FIREBASE_DATABASE_URL__",       "FIREBASE_DATABASE_URL"),
  projectId:         _e("__FIREBASE_PROJECT_ID__",         "FIREBASE_PROJECT_ID"),
  storageBucket:     _e("__FIREBASE_STORAGE_BUCKET__",     "FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: _e("__FIREBASE_MESSAGING_SENDER_ID__","FIREBASE_MESSAGING_SENDER_ID"),
  appId:             _e("__FIREBASE_APP_ID__",             "FIREBASE_APP_ID"),
  measurementId:     _e("__FIREBASE_MEASUREMENT_ID__",     "FIREBASE_MEASUREMENT_ID")
};

const EMAILJS_CONFIG = {
  publicKey:   "5OzjXOEKMfBjx2lYF",
  serviceId:   "service_nsjlidd",
  templateId:  "template_universal"   // 1 universal template — full HTML built in JS (free-tier = 2 max)
};

const ADMIN_EMAILS = ['sanz.the.nanny@gmail.com'];

/* ── Branded Email Builder ──
   Builds full HTML email in JavaScript so we only need
   ONE EmailJS template (free-tier limits to 2 templates).
   The universal template just renders: {{{html_body}}}
   ─────────────────────────────────────────────────── */
function buildBrandedEmail(title, bodyHtml, footerNote) {
  return '<div style="max-width:600px;margin:0 auto;font-family:Segoe UI,Arial,sans-serif;">' +
    '<div style="background:linear-gradient(135deg,#ff6b9d,#c44569);padding:30px 20px;text-align:center;border-radius:12px 12px 0 0;">' +
      '<h1 style="color:#fff;margin:0;font-size:22px;">' + title + '</h1>' +
      '<p style="color:#ffe0ec;margin:5px 0 0;font-size:13px;">Sanz the Nanny</p>' +
    '</div>' +
    '<div style="background:#ffffff;padding:28px 24px;border-left:1px solid #f0e6ef;border-right:1px solid #f0e6ef;">' +
      bodyHtml +
    '</div>' +
    '<div style="background:#fff5f7;padding:18px;text-align:center;border-radius:0 0 12px 12px;border:1px solid #f0e6ef;border-top:none;">' +
      (footerNote ? '<p style="color:#999;font-size:12px;margin:0 0 6px;">' + footerNote + '</p>' : '') +
      '<p style="color:#c44569;font-size:13px;margin:0;">&hearts; Sanz the Nanny &middot; Austin, TX</p>' +
      '<p style="color:#999;font-size:11px;margin:4px 0 0;">sanz.the.nanny@gmail.com</p>' +
    '</div>' +
  '</div>';
}

function sendBrandedEmail(toEmail, subject, title, bodyHtml, footerNote, replyTo) {
  if (typeof emailjs === 'undefined') return Promise.reject(new Error('EmailJS not loaded'));
  return emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
    to_email: toEmail,
    subject: subject,
    reply_to: replyTo || 'sanz.the.nanny@gmail.com',
    html_body: buildBrandedEmail(title, bodyHtml, footerNote)
  });
}

/* ── Initialise Firebase (compat SDK) ── */
let db = null;
let firebaseReady = false;

function initFirebase() {
  try {
    if (typeof firebase === 'undefined') { console.warn('Firebase SDK not loaded'); return false; }
    if (FIREBASE_CONFIG.apiKey.startsWith('__FIREBASE')) { console.warn('Firebase config not injected — running in dev mode'); return false; }
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    firebaseReady = true;
    return true;
  } catch (err) {
    console.warn('Firebase init failed:', err);
    return false;
  }
}

/* ── Firebase helpers ── */
const FB_TIMEOUT = 12000;

function fbRef(path) {
  return db ? db.ref(path) : null;
}

function fbOnce(path, timeoutMs) {
  const ms = timeoutMs || FB_TIMEOUT;
  const r = fbRef(path);
  if (!r) return Promise.reject(new Error('Firebase not ready'));
  return Promise.race([
    r.once('value'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase read timed out (' + path + ')')), ms))
  ]);
}

function fbPush(path, data) {
  const r = fbRef(path);
  if (!r) return Promise.reject(new Error('Firebase not ready'));
  return r.push(data);
}

function fbSet(path, data) {
  const r = fbRef(path);
  if (!r) return Promise.reject(new Error('Firebase not ready'));
  return r.set(data);
}

function fbUpdate(path, data) {
  const r = fbRef(path);
  if (!r) return Promise.reject(new Error('Firebase not ready'));
  return r.update(data);
}

function fbRemove(path) {
  const r = fbRef(path);
  if (!r) return Promise.reject(new Error('Firebase not ready'));
  return r.remove();
}

/* ── EmailJS helper ── */
function initEmailJS() {
  if (typeof emailjs === 'undefined') { console.warn('EmailJS SDK not loaded'); return false; }
  if (EMAILJS_CONFIG.publicKey.startsWith('__EMAILJS')) { console.warn('EmailJS config not injected'); return false; }
  emailjs.init(EMAILJS_CONFIG.publicKey);
  return true;
}

/* ── Auth helpers ── */
function isAdminEmail(email) {
  return ADMIN_EMAILS.includes((email || '').toLowerCase());
}
