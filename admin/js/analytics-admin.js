/* ─────────────────────────────────────────────────
   analytics-admin.js — Site analytics dashboard
   Reads data written by tracker.js
   ───────────────────────────────────────────────── */

let analyticsCharts = {};
let livePresenceRef = null;

/* Flatten page-view data from {slug: {pushKey: {…}}} to [{…}] */
function flattenPageViews(pvData) {
  const arr = [];
  Object.entries(pvData || {}).forEach(function([slug, children]) {
    if (children && typeof children === 'object') {
      Object.values(children).forEach(function(pv) {
        if (pv && typeof pv === 'object' && pv.timestamp) {
          pv._slug = slug;  // attach slug for page identification
          arr.push(pv);
        }
      });
    }
  });
  return arr;
}

async function refreshAnalytics() {
  if (!firebaseReady) {
    // Clear all loading spinners in analytics panel
    ['an-top-pages', 'an-top-referrers', 'an-live-table'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.className = ''; el.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Firebase not connected</p></div>'; }
    });
    return;
  }

  try {
    await Promise.all([
      refreshAnalyticsKPIs(),
      refreshTrafficChart(),
      refreshTopPages(),
      refreshTopReferrers(),
      refreshDeviceChart(),
      refreshTrafficSources(),
      refreshBookingFunnel()
    ]);
  } catch (err) {
    console.warn('[Analytics] Error:', err);
  } finally {
    // Always subscribe to live visitors and clear any stuck spinners
    subscribeLiveVisitors();
    setTimeout(clearAnalyticsSpinners, 3000);
  }
}

/* Clear any loading spinners that are still stuck */
function clearAnalyticsSpinners() {
  ['an-top-pages', 'an-top-referrers', 'an-live-table'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.classList.contains('loading')) {
      el.className = '';
      el.innerHTML = '<div class="empty-state"><p>No data available</p></div>';
    }
  });
}

/* ── KPIs ── */
async function refreshAnalyticsKPIs() {
  const today = new Date().toISOString().split('T')[0];

  // Visitors today
  try {
    const pvSnap = await fbOnce('/site_analytics/pageViews/' + today);
    const pvArr = flattenPageViews(pvSnap.val());
    const distinctSessions = new Set();
    pvArr.forEach(pv => { if (pv.sessionId) distinctSessions.add(pv.sessionId); });
    setKPI('an-visitors', distinctSessions.size);

    // Page views today
    setKPI('an-pageviews', pvArr.length);
  } catch (e) {
    setKPI('an-visitors', '—');
    setKPI('an-pageviews', '—');
  }

  // Sessions today
  try {
    const sessSnap = await fbOnce('/site_analytics/sessions/' + today);
    const sessData = sessSnap.val() || {};
    const sessions = Object.values(sessData);
    setKPI('an-sessions', sessions.length);

    // Avg session duration
    const durations = sessions.filter(s => s.duration).map(s => s.duration);
    const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    setKPI('an-visitors-sub', 'Avg: ' + formatDuration(avgDuration));

    // Bounce rate (sessions with only 1 page view or duration < 10s)
    const bounces = sessions.filter(s => (s.pages || 1) <= 1 || (s.duration || 0) < 10).length;
    const bounceRate = sessions.length ? Math.round((bounces / sessions.length) * 100) : 0;
    setKPI('an-bounce', 'Bounce: ' + bounceRate + '%');
  } catch (e) {
    setKPI('an-sessions', '—');
    setKPI('an-visitors-sub', '—');
    setKPI('an-bounce', '—');
  }

  // Live visitors
  try {
    const presSnap = await fbOnce('/site_analytics/presence/');
    const presData = presSnap.val() || {};
    const now = Date.now();
    const live = Object.values(presData).filter(p => now - (p.timestamp || p.lastSeen || 0) < 60000).length;
    setKPI('an-live', live);
  } catch (e) {
    setKPI('an-live', 0);
  }
}

function setKPI(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatDuration(seconds) {
  if (seconds < 60) return seconds + 's';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + 'm ' + s + 's';
}

/* ── Traffic Chart (30 days) ── */
async function refreshTrafficChart() {
  const canvas = document.getElementById('chart-an-traffic');
  if (!canvas) return;

  const labels = [];
  const dataVisitors = [];
  const dataPageViews = [];

  const promises = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    promises.push(
      fbOnce('/site_analytics/pageViews/' + dateStr).then(snap => {
        const pvArr = flattenPageViews(snap.val());
        const sessions = new Set();
        pvArr.forEach(pv => { if (pv.sessionId) sessions.add(pv.sessionId); });
        return { visitors: sessions.size, views: pvArr.length };
      }).catch(() => ({ visitors: 0, views: 0 }))
    );
  }

  const results = await Promise.all(promises);
  results.forEach(r => {
    dataVisitors.push(r.visitors);
    dataPageViews.push(r.views);
  });

  if (analyticsCharts.traffic) analyticsCharts.traffic.destroy();
  analyticsCharts.traffic = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Visitors',
          data: dataVisitors,
          borderColor: '#ff6b9d',
          backgroundColor: 'rgba(255,107,157,0.15)',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Page Views',
          data: dataPageViews,
          borderColor: '#ffa07a',
          backgroundColor: 'rgba(255,160,122,0.1)',
          fill: true,
          tension: 0.4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#ccc' } } },
      scales: {
        x: { ticks: { color: '#888', maxRotation: 45 }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { beginAtZero: true, ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

/* ── Top Pages ── */
async function refreshTopPages() {
  const container = document.getElementById('an-top-pages');
  if (!container) return;
  const today = new Date().toISOString().split('T')[0];

  try {
    const snap = await fbOnce('/site_analytics/pageViews/' + today);
    const pvArr = flattenPageViews(snap.val());
    const pageCounts = {};
    pvArr.forEach(pv => {
      const page = pv._slug || pv.page || pv.path || '/';
      pageCounts[page] = (pageCounts[page] || 0) + 1;
    });

    const sorted = Object.entries(pageCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    container.className = '';
    if (sorted.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No page views today</p></div>';
      return;
    }

    const max = sorted[0][1];
    let html = '';
    sorted.forEach(([page, count]) => {
      const pct = Math.round((count / max) * 100);
      html += '<div class="analytics-bar-row">' +
        '<span class="bar-label" title="' + page + '">' + page + '</span>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;"></div></div>' +
        '<span class="bar-value">' + count + '</span>' +
      '</div>';
    });
    container.innerHTML = html;
  } catch (e) {
    container.className = '';
    container.innerHTML = '<div class="empty-state">—</div>';
  }
}

/* ── Top Referrers ── */
async function refreshTopReferrers() {
  const container = document.getElementById('an-top-referrers');
  if (!container) return;
  const today = new Date().toISOString().split('T')[0];

  try {
    const snap = await fbOnce('/site_analytics/pageViews/' + today);
    const pvArr = flattenPageViews(snap.val());
    const refCounts = {};
    pvArr.forEach(pv => {
      let ref = pv.referrer || 'Direct';
      try { ref = ref !== 'Direct' ? new URL(ref).hostname : 'Direct'; } catch (e) {}
      refCounts[ref] = (refCounts[ref] || 0) + 1;
    });

    const sorted = Object.entries(refCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    container.className = '';
    if (sorted.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No referrer data</p></div>';
      return;
    }

    const max = sorted[0][1];
    let html = '';
    sorted.forEach(([ref, count]) => {
      const pct = Math.round((count / max) * 100);
      html += '<div class="analytics-bar-row">' +
        '<span class="bar-label">' + ref + '</span>' +
        '<div class="bar-track"><div class="bar-fill referrer" style="width:' + pct + '%;"></div></div>' +
        '<span class="bar-value">' + count + '</span>' +
      '</div>';
    });
    container.innerHTML = html;
  } catch (e) {
    container.className = '';
    container.innerHTML = '<div class="empty-state">—</div>';
  }
}

/* ── Device Chart ── */
async function refreshDeviceChart() {
  const canvas = document.getElementById('chart-an-devices');
  if (!canvas) return;
  const today = new Date().toISOString().split('T')[0];

  try {
    const snap = await fbOnce('/site_analytics/sessions/' + today);
    const data = snap.val() || {};
    const devices = {};
    Object.values(data).forEach(s => {
      const d = s.device || detectDevice(s.userAgent || '');
      devices[d] = (devices[d] || 0) + 1;
    });

    const labels = Object.keys(devices);
    const values = Object.values(devices);
    if (labels.length === 0) {
      labels.push('No data');
      values.push(1);
    }

    if (analyticsCharts.device) analyticsCharts.device.destroy();
    analyticsCharts.device = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: ['#ff6b9d', '#ffa07a', '#c44569', '#ff9ff3', '#ffc312', '#7ed6df']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: '#ccc', padding: 12 } } }
      }
    });
  } catch (e) {}
}

function detectDevice(ua) {
  if (/mobile|android|iphone|ipad|ipod/i.test(ua)) return 'Mobile';
  if (/tablet|ipad/i.test(ua)) return 'Tablet';
  return 'Desktop';
}

/* ── Traffic Sources ── */
async function refreshTrafficSources() {
  const canvas = document.getElementById('chart-an-sources');
  if (!canvas) return;
  const today = new Date().toISOString().split('T')[0];

  try {
    const snap = await fbOnce('/site_analytics/pageViews/' + today);
    const pvArr = flattenPageViews(snap.val());
    const sources = { Direct: 0, Social: 0, Search: 0, Referral: 0 };

    pvArr.forEach(pv => {
      const src = (pv.source || 'direct').toLowerCase();
      if (src === 'direct') sources.Direct++;
      else if (/^(google|bing|yahoo|duckduckgo|baidu)$/.test(src)) sources.Search++;
      else if (/^(facebook|instagram|twitter|linkedin|tiktok|pinterest|youtube)$/.test(src)) sources.Social++;
      else sources.Referral++;
    });

    const labels = Object.keys(sources);
    const values = Object.values(sources);

    if (analyticsCharts.sources) analyticsCharts.sources.destroy();
    analyticsCharts.sources = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: ['#ff6b9d', '#ffa07a', '#c44569', '#ff9ff3']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: '#ccc', padding: 12 } } }
      }
    });
  } catch (e) {}
}

/* ── Live Visitors (Real-time listener) ── */
function subscribeLiveVisitors() {
  if (livePresenceRef || !firebaseReady) return;
  const liveTable = document.getElementById('an-live-table');
  try {
    livePresenceRef = firebase.database().ref('/site_analytics/presence');
    livePresenceRef.on('value', snap => {
      const data = snap.val() || {};
      const now = Date.now();
      const liveArr = Object.entries(data).filter(([,p]) => now - (p.timestamp || p.lastSeen || 0) < 60000);
      const live = liveArr.length;
      setKPI('an-live', live);

      // Also update dashboard live count
      const dashLive = document.getElementById('dash-live-visitors');
      if (dashLive) dashLive.textContent = live;

      // Update live visitors table
      if (liveTable) {
        liveTable.className = '';
        if (live === 0) {
          liveTable.innerHTML = '<div class="empty-state"><p>No active visitors right now</p></div>';
        } else {
          let html = '<table class="data-table"><thead><tr><th>Page</th><th>Device</th><th>Last Seen</th></tr></thead><tbody>';
          liveArr.forEach(([id, p]) => {
            const page = p.page || '/';
            const device = p.device || 'Unknown';
            const ago = Math.round((now - (p.timestamp || p.lastSeen || 0)) / 1000);
            html += '<tr><td>' + page + '</td><td>' + device + '</td><td>' + ago + 's ago</td></tr>';
          });
          html += '</tbody></table>';
          liveTable.innerHTML = html;
        }
      }
    });
  } catch (e) {
    console.warn('[Analytics] Presence listener error:', e);
    if (liveTable) { liveTable.className = ''; liveTable.innerHTML = '<div class="empty-state"><p>Could not connect</p></div>'; }
  }
}

/* ── Booking Funnel ── */
async function refreshBookingFunnel() {
  const canvas = document.getElementById('chart-an-funnel');
  if (!canvas) return;

  try {
    const snap = await fbOnce('/trial_bookings/');
    const data = snap.val() || {};
    const bookings = Object.values(data);

    const total = bookings.length;
    const pending = bookings.filter(b => b.status === 'pending').length;
    const accepted = bookings.filter(b => b.status === 'accepted').length;
    const declined = bookings.filter(b => b.status === 'declined').length;

    const clientSnap = await fbOnce('/clients/');
    const clients = Object.keys(clientSnap.val() || {}).length;

    if (analyticsCharts.funnel) analyticsCharts.funnel.destroy();
    analyticsCharts.funnel = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Submitted', 'Pending', 'Accepted', 'Declined', 'Converted'],
        datasets: [{
          label: 'Count',
          data: [total, pending, accepted, declined, clients],
          backgroundColor: ['#ff6b9d', '#ffc312', '#2ecc71', '#e74c3c', '#c44569'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#ccc' }, grid: { display: false } }
        }
      }
    });
  } catch (e) {}
}

/* ── Cleanup on tab switch ── */
function cleanupAnalytics() {
  if (livePresenceRef) {
    livePresenceRef.off();
    livePresenceRef = null;
  }
  Object.values(analyticsCharts).forEach(c => { try { c.destroy(); } catch (e) {} });
  analyticsCharts = {};
}
