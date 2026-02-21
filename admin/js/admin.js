/* ─────────────────────────────────────────────────
   admin.js — Core admin dashboard logic
   Auth, navigation, initialization, helpers
   ───────────────────────────────────────────────── */

let currentUser = null;
let activeTab = 'dashboard';

/* ── Activity feed pagination state ── */
let _activityAll = [];
let _activityPage = 1;
let _activityPageSize = 5;

/* ── Chart registry ── */
const _chartInstances = {};
function createChart(canvasId, type, data, opts) {
  if (_chartInstances[canvasId]) _chartInstances[canvasId].destroy();
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const defaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#9e8fa0', font: { family: 'Poppins' } } }
    },
    scales: (type === 'line' || type === 'bar') ? {
      x: { ticks: { color: '#706070' }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { ticks: { color: '#706070' }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }
    } : {}
  };
  const mergedOpts = deepMerge(defaults, opts || {});
  _chartInstances[canvasId] = new Chart(ctx, { type, data, options: mergedOpts });
  return _chartInstances[canvasId];
}

function deepMerge(target, source) {
  const output = Object.assign({}, target);
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      output[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

/* ── Formatting helpers ── */
function formatNumber(n) { return (n || 0).toLocaleString(); }
function formatCurrency(n) { return '$' + (parseFloat(n) || 0).toFixed(2); }
function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDateTime(str) {
  if (!str) return '—';
  const d = new Date(str);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function formatDuration(secs) {
  if (!secs || secs < 0) return '0s';
  if (secs < 60) return Math.round(secs) + 's';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ' + Math.round(secs % 60) + 's';
  return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
}
function dateStr(offset) {
  const d = new Date();
  if (offset) d.setDate(d.getDate() - offset);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function shortId() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }
function slugToTitle(slug) {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/* ── Tab Navigation ── */
function switchTab(tab) {
  activeTab = tab;
  // Update sidebar buttons
  document.querySelectorAll('.sidebar-nav button').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('onclick').includes(tab));
  });
  // Update panels
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('panel-' + tab);
  if (panel) panel.classList.add('active');
  // Trigger panel-specific refresh
  switch (tab) {
    case 'dashboard': refreshDashboard(); break;
    case 'bookings': refreshBookings(); break;
    case 'calendar': refreshAdminCalendar(); break;
    case 'clients': refreshClients(); break;
    case 'prospects': refreshProspects(); break;
    case 'contracts': refreshContracts(); break;
    case 'invoices': refreshInvoices(); break;
    case 'analytics': refreshAnalytics(); break;
  }
}

/* ── Auth ── */
function showApp(user) {
  currentUser = user;
  document.getElementById('auth-overlay').classList.add('hidden');
  const app = document.getElementById('app');
  app.style.display = '';
  app.classList.add('visible');

  const info = document.getElementById('user-info');
  if (user.photoURL) {
    info.innerHTML = '<img src="' + user.photoURL + '" alt=""><span style="color:var(--text);font-size:0.85rem;">' + (user.displayName || user.email) + '</span>';
  } else {
    info.textContent = user.email;
  }

  initDashboard();
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('auth-loading').style.display = 'none';
  document.getElementById('btn-google-signin').style.display = '';
  setTimeout(() => { el.style.display = 'none'; }, 6000);
}

function logout() {
  if (typeof firebase !== 'undefined' && firebase.auth) {
    firebase.auth().signOut().then(() => location.reload());
  } else {
    location.reload();
  }
}

/* ── Google Sign-In ── */
document.getElementById('btn-google-signin').addEventListener('click', function () {
  if (typeof firebase === 'undefined' || !firebase.auth) {
    showAuthError('Firebase not loaded. Please refresh.');
    return;
  }
  document.getElementById('btn-google-signin').style.display = 'none';
  document.getElementById('auth-loading').style.display = 'block';

  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  firebase.auth().signInWithPopup(provider)
    .then(result => {
      if (!isAdminEmail(result.user.email)) {
        firebase.auth().signOut();
        showAuthError('Access denied. ' + result.user.email + ' is not authorized.');
      }
    })
    .catch(err => {
      console.warn('Sign-in error:', err);
      if (err.code === 'auth/popup-closed-by-user') {
        document.getElementById('auth-loading').style.display = 'none';
        document.getElementById('btn-google-signin').style.display = '';
      } else if (err.code === 'auth/unauthorized-domain') {
        showAuthError('Domain "' + location.hostname + '" not authorized. Add it in Firebase Console → Authentication → Settings → Authorized domains.');
      } else {
        showAuthError((err.code || '') + ': ' + (err.message || 'Sign-in failed.'));
      }
    });
});

/* ── Init ── */
function initDashboard() {
  if (!firebaseReady) {
    document.getElementById('fb-warning').style.display = 'block';
    document.getElementById('fb-warning-detail').textContent =
      'Firebase config not injected or failed to initialize. Data features are unavailable.';
    // Clear all loading spinners when Firebase isn't ready
    document.querySelectorAll('.loading').forEach(el => {
      el.className = '';
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Firebase not connected</p></div>';
    });
  } else {
    // Firebase data probe
    fbOnce('/trial_bookings/', 12000).then(() => {
      console.log('[Admin] Firebase probe OK');
    }).catch(err => {
      const msg = err.message || String(err);
      const el = document.getElementById('fb-warning');
      const det = document.getElementById('fb-warning-detail');
      el.style.display = 'block';
      if (msg.includes('PERMISSION_DENIED') || msg.includes('permission_denied')) {
        det.innerHTML = 'Signed in as <strong>' + (currentUser ? currentUser.email : '?') + '</strong> but Firebase rules denied the read. Check <a href="https://console.firebase.google.com/project/sanz-the-nanny/database/sanz-the-nanny-default-rtdb/rules" target="_blank">Firebase Console → Rules</a>.';
      } else if (msg.includes('timed out')) {
        det.textContent = 'Could not reach database within 12s. Try a hard refresh.';
      } else {
        det.textContent = 'Error: ' + msg;
      }
    });
  }

  // Log activity
  logActivity('admin_login', 'Admin logged in: ' + (currentUser ? currentUser.email : 'unknown'));

  refreshDashboard();
}

/* ── Activity Logger ── */
function logActivity(action, description, entityType) {
  if (!firebaseReady) return;
  fbPush('/activity_logs', {
    action: action,
    description: description,
    entity_type: entityType || 'system',
    created_at: new Date().toISOString(),
    admin_email: currentUser ? currentUser.email : 'unknown'
  }).catch(() => {});
}

/* ── Activity Feed Renderer (paginated) ── */
const _activityIcons = {
  admin_login: '🔑', booking_accepted: '✅', booking_declined: '❌',
  client_created: '👤', client_updated: '👤', client_deleted: '🗑️',
  contract_created: '📝', contract_updated: '📝', contract_sent: '📤', contract_deleted: '🗑️',
  invoice_created: '💰', invoice_updated: '💰', invoice_sent: '📤', invoice_paid: '💵', invoice_deleted: '🗑️',
  booking_converted: '🎉'
};

function renderActivityFeed() {
  const feedEl = document.getElementById('dash-activity-feed');
  const paginationEl = document.getElementById('activity-pagination');
  feedEl.className = '';

  if (_activityAll.length === 0) {
    feedEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><p>No activity yet</p></div>';
    if (paginationEl) paginationEl.style.display = 'none';
    return;
  }

  const total = _activityAll.length;
  const totalPages = Math.ceil(total / _activityPageSize);
  if (_activityPage > totalPages) _activityPage = totalPages;
  if (_activityPage < 1) _activityPage = 1;

  const start = (_activityPage - 1) * _activityPageSize;
  const end = Math.min(start + _activityPageSize, total);
  const slice = _activityAll.slice(start, end);

  let html = '';
  slice.forEach(a => {
    html += '<div class="activity-item">' +
      '<div class="activity-icon" style="background:rgba(255,107,157,0.1);">' + (_activityIcons[a.action] || '📌') + '</div>' +
      '<div><div class="activity-text">' + (a.description || a.action) + '</div>' +
      '<div class="activity-time">' + formatDateTime(a.created_at) + '</div></div></div>';
  });
  feedEl.innerHTML = html;

  // Update pagination controls
  if (paginationEl) {
    paginationEl.style.display = total > 5 ? 'flex' : (_activityPageSize < total ? 'flex' : 'none');
    // Always show if there's data so user can change page size
    if (total > 0) paginationEl.style.display = 'flex';

    const rangeEl = document.getElementById('activity-range');
    if (rangeEl) rangeEl.textContent = '(' + (start + 1) + '–' + end + ' of ' + total + ')';

    const pageNumEl = document.getElementById('activity-page-num');
    if (pageNumEl) pageNumEl.textContent = _activityPage + ' / ' + totalPages;

    const prevBtn = document.getElementById('activity-prev');
    const nextBtn = document.getElementById('activity-next');
    if (prevBtn) prevBtn.disabled = _activityPage <= 1;
    if (nextBtn) nextBtn.disabled = _activityPage >= totalPages;
  }
}

function changeActivityPage(delta) {
  _activityPage += delta;
  renderActivityFeed();
}

function changeActivityPageSize(val) {
  _activityPageSize = parseInt(val) || 5;
  _activityPage = 1;
  renderActivityFeed();
}

/* ── Dashboard Refresh ── */
async function refreshDashboard() {
  if (!firebaseReady) return;

  try {
    // KPI: Pending trials
    const bookingsSnap = await fbOnce('/trial_bookings/');
    const bookings = bookingsSnap.val() || {};
    const bookingsArr = Object.entries(bookings).map(([k, v]) => ({ _key: k, ...v }));
    const pending = bookingsArr.filter(b => b.status === 'pending');
    document.getElementById('kpi-pending').textContent = pending.length;

    // Recent bookings on dashboard
    const recentEl = document.getElementById('dash-recent-bookings');
    recentEl.className = '';
    if (pending.length === 0) {
      recentEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No pending trials</p></div>';
    } else {
      let html = '';
      pending.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5).forEach(b => {
        html += '<div class="activity-item">' +
          '<div class="activity-icon" style="background:rgba(255,213,79,0.15);">📅</div>' +
          '<div><div class="activity-text"><strong>' + (b.parent_name || 'Unknown') + '</strong> — ' + formatDate(b.selected_date) + ' at ' + (b.preferred_time || '?') + '</div>' +
          '<div class="activity-time">' + formatDateTime(b.created_at) + '</div></div></div>';
      });
      recentEl.innerHTML = html;
    }

    // KPI: Active clients
    const clientsSnap = await fbOnce('/clients/');
    const clients = clientsSnap.val() || {};
    const activeClients = Object.values(clients).filter(c => c.status === 'active');
    document.getElementById('kpi-clients').textContent = activeClients.length;

    // KPI: Revenue this month
    const invoicesSnap = await fbOnce('/invoices/');
    const invoices = invoicesSnap.val() || {};
    const now = new Date();
    const thisMonth = now.getFullYear() + '-' + pad(now.getMonth() + 1);
    let revenue = 0;
    Object.values(invoices).forEach(inv => {
      if (inv.payment_status === 'paid' && inv.paid_at && inv.paid_at.startsWith(thisMonth)) {
        revenue += parseFloat(inv.total_amount) || 0;
      }
    });
    document.getElementById('kpi-revenue').textContent = formatCurrency(revenue);

    // KPI: Site visitors today
    const today = dateStr(0);
    const pvSnap = await fbOnce('/site_analytics/pageViews/' + today);
    const pvData = pvSnap.val() || {};
    const sessions = new Set();
    let totalPV = 0;
    Object.values(pvData).forEach(pageData => {
      if (typeof pageData === 'object') {
        Object.values(pageData).forEach(entry => {
          totalPV++;
          if (entry.sessionId) sessions.add(entry.sessionId);
        });
      }
    });
    document.getElementById('kpi-visitors').textContent = sessions.size;
    document.getElementById('kpi-visitors-sub').textContent = totalPV + ' pageviews';

    // Traffic chart
    const trafficData = {};
    const promises = [];
    for (let i = 29; i >= 0; i--) {
      const d = dateStr(i);
      promises.push(fbOnce('/site_analytics/pageViews/' + d, 8000).then(snap => {
        const data = snap.val();
        let count = 0;
        if (data) Object.values(data).forEach(pd => { if (typeof pd === 'object') count += Object.keys(pd).length; });
        trafficData[d] = count;
      }).catch(() => { trafficData[d] = 0; }));
    }
    await Promise.all(promises);
    const sortedDates = Object.keys(trafficData).sort();
    createChart('chart-dash-traffic', 'line', {
      labels: sortedDates.map(d => { const p = d.split('-'); return p[1] + '/' + p[2]; }),
      datasets: [{
        label: 'Pageviews',
        data: sortedDates.map(d => trafficData[d]),
        borderColor: '#ff6b9d',
        backgroundColor: 'rgba(255,107,157,0.1)',
        fill: true, tension: 0.4, pointRadius: 3,
        pointBackgroundColor: '#ff6b9d', borderWidth: 2
      }]
    }, { plugins: { legend: { display: false } } });

    // Activity feed
    const actSnap = await fbOnce('/activity_logs/');
    const actData = actSnap.val() || {};
    _activityAll = Object.entries(actData).map(([k, v]) => ({ _key: k, ...v }));
    _activityAll.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    _activityPage = 1;
    renderActivityFeed();
  } catch (err) {
    console.warn('[Dashboard] refresh error:', err);
    // Clear any lingering loading spinners
    ['dash-recent-bookings', 'dash-activity-feed'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.classList.contains('loading')) {
        el.className = '';
        el.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Could not load data</p></div>';
      }
    });
  }
}

/* ── Filter button binding ── */
document.querySelectorAll('.booking-filter, .contract-filter, .invoice-filter').forEach(btn => {
  btn.addEventListener('click', function () {
    this.parentElement.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    const filter = this.dataset.filter;
    if (this.classList.contains('booking-filter')) refreshBookings(filter);
    else if (this.classList.contains('contract-filter')) refreshContracts(filter);
    else if (this.classList.contains('invoice-filter')) refreshInvoices(filter);
  });
});

/* ── Firebase Init & Auth Observer ── */
(function () {
  const fbOk = initFirebase();
  if (!fbOk) {
    document.getElementById('fb-warning').style.display = 'block';
    return;
  }
  initEmailJS();

  firebase.auth().onAuthStateChanged(user => {
    if (user && isAdminEmail(user.email)) {
      showApp(user);
    } else if (user) {
      firebase.auth().signOut();
      showAuthError('Access denied. ' + user.email + ' is not an authorized admin.');
    } else {
      document.getElementById('auth-overlay').classList.remove('hidden');
      document.getElementById('app').style.display = 'none';
      document.getElementById('btn-google-signin').style.display = '';
      document.getElementById('auth-loading').style.display = 'none';
    }
  });
})();
