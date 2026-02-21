/* ─────────────────────────────────────────────────
   analytics-admin.js — Site analytics dashboard
   Reads data written by tracker.js
   ───────────────────────────────────────────────── */

let analyticsCharts = {};
let livePresenceRef = null;
let analyticsDays = 7; // default: last 7 days

/* ── Helpers ── */

/** Local date string matching tracker.js format (YYYY-MM-DD) */
function localDateStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function getDateRange(days) {
  days = days || analyticsDays;
  const end = localDateStr();
  const s = new Date();
  s.setDate(s.getDate() - (days - 1));
  return { startDate: localDateStr(s), endDate: end };
}

function setKPI(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0s';
  if (seconds < 60) return seconds + 's';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + 'm ' + s + 's';
}

function detectDevice(ua) {
  if (/mobile|android|iphone|ipod/i.test(ua)) return 'Mobile';
  if (/tablet|ipad/i.test(ua)) return 'Tablet';
  return 'Desktop';
}

/**
 * Flatten pageViews from range query result:
 * { date: { slug: { pushKey: {…} } } } → flat array
 */
function flattenRangePageViews(raw) {
  const arr = [];
  Object.entries(raw || {}).forEach(function([date, slugs]) {
    Object.entries(slugs || {}).forEach(function([slug, entries]) {
      if (entries && typeof entries === 'object') {
        Object.values(entries).forEach(function(pv) {
          if (pv && typeof pv === 'object' && pv.timestamp) {
            pv._slug = slug;
            pv._date = date;
            arr.push(pv);
          }
        });
      }
    });
  });
  return arr;
}

/**
 * Flatten sessions from range query result:
 * { date: { sessionId: {…} } } → flat array
 */
function flattenRangeSessions(raw) {
  const arr = [];
  Object.entries(raw || {}).forEach(function([date, sessions]) {
    Object.values(sessions || {}).forEach(function(s) {
      if (s && typeof s === 'object') {
        s._date = date;
        arr.push(s);
      }
    });
  });
  return arr;
}

/* ── Range Picker ── */
function setAnalyticsRange(days) {
  analyticsDays = days;
  document.querySelectorAll('.an-range-btn').forEach(function(btn) {
    btn.classList.toggle('active', parseInt(btn.dataset.days) === days);
  });
  var label = days === 1 ? 'Today' : 'Last ' + days + 'd';
  var el;
  el = document.getElementById('an-visitors-label');  if (el) el.textContent = 'Visitors (' + label + ')';
  el = document.getElementById('an-pageviews-label'); if (el) el.textContent = 'Pageviews (' + label + ')';
  el = document.getElementById('an-sessions-label');  if (el) el.textContent = 'Sessions (' + label + ')';
  refreshAnalytics();
}

/* ── Main Refresh ── */
async function refreshAnalytics() {
  if (!firebaseReady) {
    ['an-top-pages', 'an-top-referrers', 'an-live-table'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { el.className = ''; el.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Firebase not connected</p></div>'; }
    });
    return;
  }

  var range = getDateRange();

  try {
    // Two bulk queries for the selected date range
    var results = await Promise.all([
      firebase.database().ref('/site_analytics/pageViews')
        .orderByKey().startAt(range.startDate).endAt(range.endDate).once('value'),
      firebase.database().ref('/site_analytics/sessions')
        .orderByKey().startAt(range.startDate).endAt(range.endDate).once('value')
    ]);

    var pvArr  = flattenRangePageViews(results[0].val());
    var sessArr = flattenRangeSessions(results[1].val());

    renderKPIs(pvArr, sessArr);
    renderTopPages(pvArr);
    renderTopReferrers(pvArr);
    renderTrafficSources(pvArr);
    renderDeviceChart(sessArr, pvArr);
    await refreshTrafficChart();
    await refreshBookingFunnel();
  } catch (err) {
    console.warn('[Analytics] Error:', err);
  } finally {
    subscribeLiveVisitors();
    setTimeout(clearAnalyticsSpinners, 3000);
  }
}

/* Clear any loading spinners that are still stuck */
function clearAnalyticsSpinners() {
  ['an-top-pages', 'an-top-referrers', 'an-live-table'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el && el.classList.contains('loading')) {
      el.className = '';
      el.innerHTML = '<div class="empty-state"><p>No data available</p></div>';
    }
  });
}

/* ── KPIs ── */
function renderKPIs(pvArr, sessArr) {
  // Unique visitors (by visitorId, fall back to sessionId)
  var visitors = new Set();
  pvArr.forEach(function(pv) {
    if (pv.visitorId) visitors.add(pv.visitorId);
    else if (pv.sessionId) visitors.add(pv.sessionId);
  });
  setKPI('an-visitors', visitors.size);
  setKPI('an-pageviews', pvArr.length);
  setKPI('an-sessions', sessArr.length);

  // Avg session duration
  var durations = sessArr.filter(function(s) { return s.duration; }).map(function(s) { return s.duration; });
  var avgDuration = durations.length
    ? Math.round(durations.reduce(function(a, b) { return a + b; }, 0) / durations.length)
    : 0;
  setKPI('an-visitors-sub', 'Avg: ' + formatDuration(avgDuration));

  // Bounce rate
  var bounces = sessArr.filter(function(s) { return (s.pages || 1) <= 1 || (s.duration || 0) < 10; }).length;
  var bounceRate = sessArr.length ? Math.round((bounces / sessArr.length) * 100) : 0;
  setKPI('an-bounce', 'Bounce: ' + bounceRate + '%');

  // Live visitors from presence
  try {
    fbOnce('/site_analytics/presence/').then(function(presSnap) {
      var presData = presSnap.val() || {};
      var now = Date.now();
      var live = Object.values(presData).filter(function(p) {
        return now - (p.timestamp || p.lastSeen || 0) < 60000;
      }).length;
      setKPI('an-live', live);
    });
  } catch (e) {
    setKPI('an-live', 0);
  }
}

/* ── Traffic Chart (always 30 days) ── */
async function refreshTrafficChart() {
  var canvas = document.getElementById('chart-an-traffic');
  if (!canvas) return;

  var range = getDateRange(30);

  try {
    var snap = await firebase.database().ref('/site_analytics/pageViews')
      .orderByKey().startAt(range.startDate).endAt(range.endDate).once('value');
    var raw = snap.val() || {};

    var labels = [];
    var dataVisitors = [];
    var dataPageViews = [];

    for (var i = 29; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var dateStr = localDateStr(d);
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

      var dayData = raw[dateStr] || {};
      var dayPvs = [];
      Object.entries(dayData).forEach(function([slug, entries]) {
        Object.values(entries || {}).forEach(function(pv) {
          if (pv && pv.timestamp) dayPvs.push(pv);
        });
      });

      var sessions = new Set();
      dayPvs.forEach(function(pv) { if (pv.sessionId) sessions.add(pv.sessionId); });
      dataVisitors.push(sessions.size);
      dataPageViews.push(dayPvs.length);
    }

    if (analyticsCharts.traffic) analyticsCharts.traffic.destroy();
    analyticsCharts.traffic = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
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
  } catch (e) {
    console.warn('[Analytics] Traffic chart error:', e);
  }
}

/* ── Top Pages ── */
function renderTopPages(pvArr) {
  var container = document.getElementById('an-top-pages');
  if (!container) return;

  var pageCounts = {};
  pvArr.forEach(function(pv) {
    var page = pv._slug || pv.page || pv.path || '/';
    pageCounts[page] = (pageCounts[page] || 0) + 1;
  });

  var sorted = Object.entries(pageCounts).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 10);
  container.className = '';

  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No page view data</p></div>';
    return;
  }

  var max = sorted[0][1];
  var html = '';
  sorted.forEach(function(entry) {
    var page = entry[0], count = entry[1];
    var pct = Math.round((count / max) * 100);
    html += '<div class="analytics-bar-row">' +
      '<span class="bar-label" title="' + page + '">' + page + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;"></div></div>' +
      '<span class="bar-value">' + count + '</span>' +
      '</div>';
  });
  container.innerHTML = html;
}

/* ── Top Referrers ── */
function renderTopReferrers(pvArr) {
  var container = document.getElementById('an-top-referrers');
  if (!container) return;

  var refCounts = {};
  pvArr.forEach(function(pv) {
    var ref = pv.referrer || 'Direct';
    try { ref = ref !== 'Direct' ? new URL(ref).hostname : 'Direct'; } catch (e) {}
    refCounts[ref] = (refCounts[ref] || 0) + 1;
  });

  var sorted = Object.entries(refCounts).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 10);
  container.className = '';

  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No referrer data</p></div>';
    return;
  }

  var max = sorted[0][1];
  var html = '';
  sorted.forEach(function(entry) {
    var ref = entry[0], count = entry[1];
    var pct = Math.round((count / max) * 100);
    html += '<div class="analytics-bar-row">' +
      '<span class="bar-label">' + ref + '</span>' +
      '<div class="bar-track"><div class="bar-fill referrer" style="width:' + pct + '%;"></div></div>' +
      '<span class="bar-value">' + count + '</span>' +
      '</div>';
  });
  container.innerHTML = html;
}

/* ── Traffic Sources (doughnut) ── */
function renderTrafficSources(pvArr) {
  var canvas = document.getElementById('chart-an-sources');
  if (!canvas) return;

  var sources = { Direct: 0, Social: 0, Search: 0, Referral: 0 };
  pvArr.forEach(function(pv) {
    var src = (pv.source || 'direct').toLowerCase();
    if (src === 'direct') sources.Direct++;
    else if (/^(google|bing|yahoo|duckduckgo|baidu)$/.test(src)) sources.Search++;
    else if (/^(facebook|instagram|twitter|linkedin|tiktok|pinterest|youtube)$/.test(src)) sources.Social++;
    else sources.Referral++;
  });

  // Filter out zeros for cleaner chart
  var labels = [], values = [], bgColors = [];
  var colorMap = { Direct: '#ff6b9d', Social: '#ffa07a', Search: '#c44569', Referral: '#ff9ff3' };
  Object.entries(sources).forEach(function(entry) {
    if (entry[1] > 0) {
      labels.push(entry[0]);
      values.push(entry[1]);
      bgColors.push(colorMap[entry[0]]);
    }
  });

  if (labels.length === 0) {
    labels.push('No data');
    values.push(1);
    bgColors.push('#555');
  }

  if (analyticsCharts.sources) analyticsCharts.sources.destroy();
  analyticsCharts.sources = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: labels, datasets: [{ data: values, backgroundColor: bgColors }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#ccc', padding: 12 } } }
    }
  });
}

/* ── Device Chart ── */
function renderDeviceChart(sessArr, pvArr) {
  var canvas = document.getElementById('chart-an-devices');
  if (!canvas) return;

  var devices = {};

  // Prefer session-level device info
  sessArr.forEach(function(s) {
    var d = s.device || detectDevice(s.userAgent || '');
    var label = d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
    devices[label] = (devices[label] || 0) + 1;
  });

  // Fall back to pageView device field if no session data
  if (Object.keys(devices).length === 0 && pvArr) {
    pvArr.forEach(function(pv) {
      if (pv.device) {
        var label = pv.device.charAt(0).toUpperCase() + pv.device.slice(1).toLowerCase();
        devices[label] = (devices[label] || 0) + 1;
      }
    });
  }

  var labels = Object.keys(devices);
  var values = Object.values(devices);

  if (labels.length === 0) {
    labels.push('No data');
    values.push(1);
  }

  if (analyticsCharts.device) analyticsCharts.device.destroy();
  analyticsCharts.device = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: labels,
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
}

/* ── Live Visitors (Real-time listener) ── */
function subscribeLiveVisitors() {
  if (livePresenceRef || !firebaseReady) return;
  var liveTable = document.getElementById('an-live-table');
  try {
    livePresenceRef = firebase.database().ref('/site_analytics/presence');
    livePresenceRef.on('value', function(snap) {
      var data = snap.val() || {};
      var now = Date.now();
      var liveArr = Object.entries(data).filter(function(entry) {
        return now - (entry[1].timestamp || entry[1].lastSeen || 0) < 60000;
      });
      var live = liveArr.length;
      setKPI('an-live', live);

      var dashLive = document.getElementById('dash-live-visitors');
      if (dashLive) dashLive.textContent = live;

      if (liveTable) {
        liveTable.className = '';
        if (live === 0) {
          liveTable.innerHTML = '<div class="empty-state"><p>No active visitors right now</p></div>';
        } else {
          var html = '<table class="data-table"><thead><tr><th>Page</th><th>Device</th><th>Last Seen</th></tr></thead><tbody>';
          liveArr.forEach(function(entry) {
            var p = entry[1];
            var page = p.page || '/';
            var device = p.device || 'Unknown';
            var ago = Math.round((now - (p.timestamp || p.lastSeen || 0)) / 1000);
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
  var canvas = document.getElementById('chart-an-funnel');
  if (!canvas) return;

  try {
    var snap = await fbOnce('/trial_bookings/');
    var data = snap.val() || {};
    var bookings = Object.values(data);

    var total    = bookings.length;
    var pending  = bookings.filter(function(b) { return b.status === 'pending'; }).length;
    var accepted = bookings.filter(function(b) { return b.status === 'accepted'; }).length;
    var declined = bookings.filter(function(b) { return b.status === 'declined'; }).length;

    var clientSnap = await fbOnce('/clients/');
    var clients = Object.keys(clientSnap.val() || {}).length;

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
  Object.values(analyticsCharts).forEach(function(c) { try { c.destroy(); } catch (e) {} });
  analyticsCharts = {};
}
