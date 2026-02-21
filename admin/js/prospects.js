/* ─────────────────────────────────────────────────
   prospects.js — Prospective client management
   Contact form submissions appear here as leads.
   ───────────────────────────────────────────────── */

let prospectsCache = [];

/* ═══════════════ FILTER BUTTONS ═══════════════ */

document.querySelectorAll('.prospect-filter').forEach(btn => {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.prospect-filter').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    refreshProspects(this.dataset.filter);
  });
});

/* ═══════════════ LOAD & RENDER ═══════════════ */

async function refreshProspects(filter) {
  filter = filter || 'all';
  const container = document.getElementById('prospects-list');
  container.className = 'loading';
  container.textContent = 'Loading prospects...';
  if (!firebaseReady) { container.className = ''; container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Firebase not connected</p></div>'; return; }

  try {
    const snap = await fbOnce('/prospects/');
    const data = snap.val() || {};
    prospectsCache = Object.entries(data).map(([k, v]) => ({ _key: k, ...v }));
    prospectsCache.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    let filtered = prospectsCache;
    if (filter !== 'all') filtered = prospectsCache.filter(p => p.status === filter);

    container.className = '';
    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🌱</div><p>No ' + (filter === 'all' ? '' : filter + ' ') + 'prospects yet</p></div>';
      return;
    }

    let html = '';
    filtered.forEach(p => {
      const status = p.status || 'new';
      const badgeCls = 'badge-' + status;

      html += '<div class="booking-card">' +
        '<div class="booking-card-header">' +
          '<h4>' + esc(p.name || 'Unknown') + '</h4>' +
          '<span class="badge ' + badgeCls + '">' + status + '</span>' +
        '</div>' +
        '<div class="booking-card-details">' +
          '<div><strong>Email:</strong> ' + esc(p.email || '—') + '</div>' +
          '<div><strong>Phone:</strong> ' + esc(p.phone || '—') + '</div>' +
          '<div><strong>Source:</strong> ' + esc(p.source || 'contact_form') + '</div>' +
          '<div><strong>Submitted:</strong> ' + formatDateTime(p.created_at) + '</div>' +
          (p.message ? '<div style="grid-column:1/-1;"><strong>Message:</strong> ' + esc(p.message) + '</div>' : '') +
        '</div>' +
        '<div class="booking-card-actions"><div class="btn-group">';

      if (status === 'new') {
        html += '<button class="btn btn-outline btn-sm" onclick="markProspectContacted(\'' + p._key + '\')">📞 Mark Contacted</button>';
      }
      if (status !== 'converted') {
        html += '<button class="btn btn-success btn-sm" onclick="convertProspectToClient(\'' + p._key + '\')">→ Convert to Client</button>';
      }
      html += '<button class="btn btn-danger btn-sm" onclick="deleteProspect(\'' + p._key + '\')">🗑️ Delete</button>';

      html += '</div></div></div>';
    });

    container.innerHTML = html;
  } catch (err) {
    console.warn('[Prospects] Error:', err);
    container.className = '';
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>Error loading prospects</p></div>';
  }
}

/* ═══════════════ ACTIONS ═══════════════ */

async function markProspectContacted(key) {
  if (!firebaseReady) return;
  try {
    await fbUpdate('/prospects/' + key, { status: 'contacted', contacted_at: new Date().toISOString() });
    logActivity('prospect_contacted', 'Marked prospect as contacted', 'prospect');
    refreshProspects();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function convertProspectToClient(key) {
  const prospect = prospectsCache.find(p => p._key === key);
  if (!prospect) { alert('Prospect not found in cache. Please refresh and try again.'); return; }
  if (!firebaseReady) { alert('Firebase not connected'); return; }

  if (!confirm('Convert "' + (prospect.name || 'this prospect') + '" to a client?')) return;

  try {
    // Create client record
    const clientData = {
      family_name: prospect.name || '',
      parent_name: prospect.name || '',
      email: prospect.email || '',
      phone: (prospect.phone && prospect.phone !== 'Not provided') ? prospect.phone : '',
      children: [],
      notes: 'Converted from prospect. Original message: ' + (prospect.message || '—'),
      status: 'active',
      source: 'prospect_conversion',
      created_at: new Date().toISOString()
    };
    await fbPush('/clients', clientData);

    // Update prospect status
    await fbUpdate('/prospects/' + key, { status: 'converted', converted_at: new Date().toISOString() });

    logActivity('prospect_converted', 'Converted prospect to client: ' + prospect.name, 'prospect');

    alert('✅ ' + (prospect.name || 'Prospect') + ' has been added as a client!');

    // Navigate to clients tab so the user can see the new client
    switchTab('clients');
  } catch (err) {
    console.error('[Prospects] Convert error:', err);
    alert('Failed to convert prospect: ' + err.message);
  }
}

async function deleteProspect(key) {
  if (!confirm('Delete this prospect? This cannot be undone.')) return;
  try {
    await fbRemove('/prospects/' + key);
    logActivity('prospect_deleted', 'Deleted prospect', 'prospect');
    refreshProspects();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}
