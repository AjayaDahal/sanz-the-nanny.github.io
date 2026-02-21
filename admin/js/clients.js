/* ─────────────────────────────────────────────────
   clients.js — Client/family management v2
   Full profile view, children repeater,
   contract/invoice integration
   ───────────────────────────────────────────────── */

let clientsCache = [];
let editingClientKey = null;
let childrenList = [];
let activeClientTab = 'overview';

/* ═══════════════ CLIENT LIST ═══════════════ */

async function refreshClients() {
  const container = document.getElementById('clients-list');
  container.className = 'loading';
  container.textContent = 'Loading clients...';
  if (!firebaseReady) { container.className = ''; container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Firebase not connected</p></div>'; return; }

  try {
    const [clientSnap, contractSnap, invoiceSnap] = await Promise.all([
      fbOnce('/clients/'),
      fbOnce('/contracts/'),
      fbOnce('/invoices/')
    ]);

    const data = clientSnap.val() || {};
    clientsCache = Object.entries(data).map(([k, v]) => ({ _key: k, ...v }));
    clientsCache.sort((a, b) => (a.family_name || '').localeCompare(b.family_name || ''));

    // Auto-expire: mark clients inactive if contract_end is past today
    const todayStr = new Date().toISOString().split('T')[0];
    const expirePromises = [];
    clientsCache.forEach(c => {
      if ((c.status || 'active') === 'active' && c.contract_end && c.contract_end < todayStr) {
        c.status = 'expired';
        expirePromises.push(
          fbUpdate('/clients/' + c._key, { status: 'expired', expired_at: todayStr })
            .then(() => logActivity('client_expired', 'Auto-expired client: ' + (c.family_name || c.parent_name) + ' (contract ended ' + c.contract_end + ')', 'client'))
            .catch(e => console.warn('Auto-expire failed for', c._key, e))
        );
      }
    });
    if (expirePromises.length) await Promise.all(expirePromises);

    // Build counts per client
    const contracts = contractSnap.val() || {};
    const invoices = invoiceSnap.val() || {};
    const contractCounts = {};
    const invoiceCounts = {};
    Object.values(contracts).forEach(c => {
      const key = c.client_key;
      if (key) contractCounts[key] = (contractCounts[key] || 0) + 1;
    });
    Object.values(invoices).forEach(i => {
      const key = i.client_key;
      if (key) invoiceCounts[key] = (invoiceCounts[key] || 0) + 1;
    });

    const search = (document.getElementById('client-search').value || '').toLowerCase();
    const statusFilter = (document.getElementById('client-status-filter') || {}).value || 'active';
    let filtered = clientsCache;
    if (statusFilter !== 'all') {
      if (statusFilter === 'inactive') {
        // Show both inactive and expired under "Inactive" filter
        filtered = filtered.filter(c => c.status === 'inactive' || c.status === 'expired');
      } else {
        filtered = filtered.filter(c => (c.status || 'active') === statusFilter);
      }
    }
    if (search) {
      filtered = filtered.filter(c =>
        (c.family_name || '').toLowerCase().includes(search) ||
        (c.parent_name || '').toLowerCase().includes(search) ||
        (c.email || '').toLowerCase().includes(search)
      );
    }

    container.className = '';
    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">👨‍👩‍👧</div><p>No clients yet. Add your first client!</p></div>';
      return;
    }

    let html = '<div class="client-grid">';
    filtered.forEach(c => {
      const isExpired = c.status === 'expired';
      const statusCls = c.status === 'active' ? 'badge-active' : (isExpired ? 'badge-expired' : 'badge-inactive');
      const statusLabel = isExpired ? 'expired' : (c.status || 'active');
      const children = (c.children || []);
      let childrenStr = children.map(ch => ch.name + (ch.age ? ' (' + ch.age + ')' : '')).join(', ') || 'No children listed';
      const cContracts = contractCounts[c._key] || 0;
      const cInvoices = invoiceCounts[c._key] || 0;

      // Contract date range display
      let dateRangeHtml = '';
      if (c.contract_start || c.contract_end) {
        const start = c.contract_start ? formatDate(c.contract_start) : '—';
        const end = c.contract_end ? formatDate(c.contract_end) : 'Ongoing';
        dateRangeHtml = '<div>📅 ' + start + ' → ' + end + '</div>';
      }

      html += '<div class="client-card' + (isExpired ? ' expired' : '') + '">' +
        '<div class="client-card-top" onclick="openClientProfile(\'' + c._key + '\')">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">' +
            '<h4 style="color:var(--text);">' + esc(c.family_name || c.parent_name || 'Unknown') + '</h4>' +
            '<span class="badge ' + statusCls + '">' + statusLabel + '</span>' +
          '</div>' +
          '<div style="font-size:0.88rem;color:var(--text-muted);display:flex;flex-direction:column;gap:4px;">' +
            '<div>👤 ' + esc(c.parent_name || '—') + '</div>' +
            '<div>📧 ' + esc(c.email || '—') + '</div>' +
            (c.phone ? '<div>📞 ' + esc(c.phone) + '</div>' : '') +
            '<div>👶 ' + esc(childrenStr) + '</div>' +
            dateRangeHtml +
          '</div>' +
          (cContracts || cInvoices ? '<div class="client-card-stats">' +
            '<span>📝 ' + cContracts + ' Contract' + (cContracts !== 1 ? 's' : '') + '</span>' +
            '<span>💰 ' + cInvoices + ' Invoice' + (cInvoices !== 1 ? 's' : '') + '</span>' +
          '</div>' : '') +
        '</div>' +
        '<div class="client-card-actions">' +
          '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();createContractForClient(\'' + c._key + '\')"><span>📝</span> Contract</button>' +
          '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();createInvoiceForClient(\'' + c._key + '\')"><span>💰</span> Invoice</button>' +
          '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();openClientEdit(\'' + c._key + '\')"><span>✏️</span> Edit</button>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  } catch (err) {
    console.warn('[Clients] Error:', err);
    container.className = '';
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>Error loading clients</p></div>';
  }
}

/* ═══════════════ CLIENT PROFILE ═══════════════ */

function openClientProfile(key) {
  const client = clientsCache.find(c => c._key === key);
  if (!client) return;

  document.getElementById('clients-list').style.display = 'none';
  document.getElementById('client-toolbar').style.display = 'none';
  document.getElementById('client-edit-form').style.display = 'none';
  const profile = document.getElementById('client-profile');
  profile.style.display = 'block';
  profile.dataset.key = key;

  // Populate header
  const isExpired = client.status === 'expired';
  const statusCls = client.status === 'active' ? 'badge-active' : (isExpired ? 'badge-expired' : 'badge-inactive');
  const statusLabel = isExpired ? 'expired' : (client.status || 'active');
  document.getElementById('cp-name').textContent = client.family_name || client.parent_name || 'Unknown';
  document.getElementById('cp-status').className = 'badge ' + statusCls;
  document.getElementById('cp-status').textContent = statusLabel;
  document.getElementById('cp-parent').textContent = client.parent_name || '—';
  document.getElementById('cp-email').textContent = client.email || '—';
  document.getElementById('cp-phone').textContent = client.phone || '—';
  document.getElementById('cp-address').textContent = client.address || 'Not provided';

  // Show contract dates
  const datesEl = document.getElementById('cp-dates');
  if (datesEl) {
    if (client.contract_start || client.contract_end) {
      const start = client.contract_start ? formatDate(client.contract_start) : '—';
      const end = client.contract_end ? formatDate(client.contract_end) : 'Ongoing';
      datesEl.innerHTML = '📅 <strong>Contract:</strong> ' + start + ' → ' + end;
      if (client.service_type) datesEl.innerHTML += ' &nbsp;·&nbsp; ' + esc(client.service_type);
      datesEl.style.display = '';
    } else {
      datesEl.style.display = 'none';
    }
  }

  // Update toggle button text
  const toggleBtn = document.getElementById('cp-toggle-status');
  if (toggleBtn) {
    const isActive = (client.status || 'active') === 'active';
    toggleBtn.textContent = isActive ? '⏸️ Mark Inactive' : '▶️ Re-activate';
    toggleBtn.className = isActive ? 'btn btn-outline btn-sm' : 'btn btn-success btn-sm';
  }

  // Update availability override toggle
  const overrideBtn = document.getElementById('cp-toggle-override');
  if (overrideBtn) {
    const isOverride = !!client.availability_override;
    overrideBtn.textContent = isOverride ? '🔓 Override: ON' : '🔒 Override: OFF';
    overrideBtn.className = isOverride ? 'btn btn-success btn-sm' : 'btn btn-outline btn-sm';
    overrideBtn.title = isOverride
      ? 'Calendar is open for trials during this client\'s contract dates'
      : 'Calendar blocks trials during this client\'s contract dates';
  }

  // Reset to overview tab
  activeClientTab = 'overview';
  switchClientTab('overview');
}

function closeClientProfile() {
  document.getElementById('client-profile').style.display = 'none';
  document.getElementById('client-edit-form').style.display = 'none';
  document.getElementById('clients-list').style.display = '';
  document.getElementById('client-toolbar').style.display = '';
}

function switchClientTab(tab) {
  activeClientTab = tab;
  document.querySelectorAll('.cp-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.cp-tab-content').forEach(c => c.classList.toggle('active', c.id === 'cp-tab-' + tab));

  const key = document.getElementById('client-profile').dataset.key;
  const client = clientsCache.find(c => c._key === key);
  if (!client) return;

  if (tab === 'overview') renderClientOverview(client);
  else if (tab === 'contracts') refreshClientContracts(key, client);
  else if (tab === 'invoices') refreshClientInvoices(key, client);
}

function renderClientOverview(client) {
  const children = client.children || [];
  const container = document.getElementById('cp-children-list');
  if (children.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:1rem;"><p style="color:var(--text-dim);">No children added yet</p></div>';
  } else {
    let html = '';
    children.forEach(ch => {
      html += '<div class="child-info-card">' +
        '<div class="child-info-name">👶 ' + esc(ch.name || 'Unnamed') +
          (ch.age ? ' <span class="child-age">' + esc(String(ch.age)) + ' yrs</span>' : '') +
        '</div>' +
        (ch.allergies ? '<div class="child-info-detail">⚠️ Allergies: ' + esc(ch.allergies) + '</div>' : '') +
        (ch.notes ? '<div class="child-info-detail">📝 ' + esc(ch.notes) + '</div>' : '') +
      '</div>';
    });
    container.innerHTML = html;
  }
  document.getElementById('cp-notes-text').textContent = client.notes || 'No notes';
}

async function refreshClientContracts(key, client) {
  const container = document.getElementById('cp-contracts-list');
  container.innerHTML = '<div class="loading" style="padding:1rem;">Loading...</div>';
  try {
    const snap = await fbOnce('/contracts/');
    const data = snap.val() || {};
    const linked = Object.entries(data)
      .map(([k, v]) => ({ _key: k, ...v }))
      .filter(c => c.client_key === key ||
        (!c.client_key && c.client_email && client.email && c.client_email.toLowerCase() === client.email.toLowerCase()))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    if (linked.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:1.5rem;"><div class="empty-icon">📝</div><p>No contracts yet</p></div>';
    } else {
      let html = '';
      linked.forEach(c => {
        const badgeCls = 'badge-' + (c.status || 'draft');
        html += '<div class="linked-doc-card">' +
          '<div class="linked-doc-header">' +
            '<div><strong>' + esc(c.service_type || 'Service Agreement') + '</strong>' +
              '<span class="badge ' + badgeCls + '" style="margin-left:8px;">' + (c.status || 'draft') + '</span></div>' +
            '<span class="linked-doc-date">' + formatDate(c.created_at) + '</span>' +
          '</div>' +
          '<div class="linked-doc-details">' +
            (c.rate ? '<span>💵 ' + esc(c.rate) + '</span>' : '') +
            (c.start_date ? '<span>📅 Starts ' + formatDate(c.start_date) + '</span>' : '') +
            (c.schedule ? '<span>🕐 ' + esc(c.schedule) + '</span>' : '') +
          '</div>' +
          '<div class="btn-group" style="margin-top:0.5rem;">' +
            '<button class="btn btn-outline btn-sm" onclick="goToContract(\'' + c._key + '\')">View / Edit</button>' +
          '</div>' +
        '</div>';
      });
      container.innerHTML = html;
    }
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>Error loading contracts</p></div>';
  }
}

async function refreshClientInvoices(key, client) {
  const container = document.getElementById('cp-invoices-list');
  container.innerHTML = '<div class="loading" style="padding:1rem;">Loading...</div>';
  try {
    const snap = await fbOnce('/invoices/');
    const data = snap.val() || {};
    const linked = Object.entries(data)
      .map(([k, v]) => ({ _key: k, ...v }))
      .filter(i => i.client_key === key ||
        (!i.client_key && i.client_email && client.email && i.client_email.toLowerCase() === client.email.toLowerCase()))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    if (linked.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:1.5rem;"><div class="empty-icon">💰</div><p>No invoices yet</p></div>';
    } else {
      let totalPaid = 0, totalUnpaid = 0;
      let html = '';
      linked.forEach(inv => {
        const isOverdue = inv.payment_status !== 'paid' && inv.due_date && new Date(inv.due_date) < new Date();
        const status = isOverdue ? 'overdue' : (inv.payment_status || 'unpaid');
        const badgeCls = 'badge-' + status;
        if (status === 'paid') totalPaid += (inv.total_amount || 0);
        else totalUnpaid += (inv.total_amount || 0);

        html += '<div class="linked-doc-card">' +
          '<div class="linked-doc-header">' +
            '<div><strong>' + esc(inv.invoice_number || inv._key.substring(0, 6).toUpperCase()) + '</strong>' +
              '<span class="badge ' + badgeCls + '" style="margin-left:8px;">' + status + '</span></div>' +
            '<span style="color:var(--pink);font-weight:600;">' + formatCurrency(inv.total_amount) + '</span>' +
          '</div>' +
          '<div class="linked-doc-details">' +
            '<span>📅 Due: ' + formatDate(inv.due_date) + '</span>' +
            (inv.paid_at ? '<span>✅ Paid: ' + formatDate(inv.paid_at) + '</span>' : '') +
          '</div>' +
          '<div class="btn-group" style="margin-top:0.5rem;">' +
            '<button class="btn btn-outline btn-sm" onclick="goToInvoice(\'' + inv._key + '\')">View / Edit</button>' +
            (status !== 'paid' ? '<button class="btn btn-success btn-sm" onclick="quickMarkPaid(\'' + inv._key + '\',\'' + key + '\')">✅ Mark Paid</button>' : '') +
          '</div>' +
        '</div>';
      });

      const summary = '<div class="client-invoice-summary">' +
        '<div class="cis-item"><span class="cis-label">Total Paid</span><span class="cis-val" style="color:var(--green);">' + formatCurrency(totalPaid) + '</span></div>' +
        '<div class="cis-item"><span class="cis-label">Outstanding</span><span class="cis-val" style="color:var(--yellow);">' + formatCurrency(totalUnpaid) + '</span></div>' +
        '<div class="cis-item"><span class="cis-label">Total</span><span class="cis-val" style="color:var(--pink);">' + formatCurrency(totalPaid + totalUnpaid) + '</span></div>' +
      '</div>';

      container.innerHTML = summary + html;
    }
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>Error loading invoices</p></div>';
  }
}

async function quickMarkPaid(invoiceKey, clientKey) {
  if (!confirm('Mark this invoice as paid?')) return;
  try {
    await fbUpdate('/invoices/' + invoiceKey, { payment_status: 'paid', paid_at: new Date().toISOString() });
    logActivity('invoice_paid', 'Marked invoice as paid', 'invoice');
    const client = clientsCache.find(c => c._key === clientKey);
    if (client) refreshClientInvoices(clientKey, client);
  } catch (err) { alert('Failed: ' + err.message); }
}

/* ═══════════════ NAVIGATION ═══════════════ */

function goToContract(key) {
  closeClientProfile();
  switchTab('contracts');
  setTimeout(() => openEditContract(key), 300);
}

function goToInvoice(key) {
  closeClientProfile();
  switchTab('invoices');
  setTimeout(() => openEditInvoice(key), 300);
}

function createContractForClient(key) {
  const client = clientsCache.find(c => c._key === key);
  if (!client) return;
  closeClientProfile();
  switchTab('contracts');
  setTimeout(() => {
    openNewContract();
    document.getElementById('ct-client-name').value = client.family_name || client.parent_name || '';
    document.getElementById('ct-client-email').value = client.email || '';
    document.getElementById('contractForm').dataset.clientKey = key;
    const sel = document.getElementById('ct-client-select');
    if (sel) sel.value = key;
  }, 300);
}

function createInvoiceForClient(key) {
  const client = clientsCache.find(c => c._key === key);
  if (!client) return;
  closeClientProfile();
  switchTab('invoices');
  setTimeout(() => {
    openNewInvoice();
    document.getElementById('inv-client-name').value = client.family_name || client.parent_name || '';
    document.getElementById('inv-client-email').value = client.email || '';
    document.getElementById('invoiceForm').dataset.clientKey = key;
    const sel = document.getElementById('inv-client-select');
    if (sel) sel.value = key;
  }, 300);
}

/* ═══════════════ CLIENT SELECTOR (for contracts/invoices) ═══════════════ */

function populateClientSelect(selectId, selectedKey) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select a client or type manually below —</option>';
  clientsCache.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c._key;
    opt.textContent = (c.family_name || c.parent_name || 'Unknown') + ' (' + (c.email || 'no email') + ')';
    if (selectedKey && c._key === selectedKey) opt.selected = true;
    sel.appendChild(opt);
  });
}

function onClientSelectChange(prefix) {
  const sel = document.getElementById(prefix + '-client-select');
  const key = sel.value;
  const client = clientsCache.find(c => c._key === key);
  const form = document.getElementById(prefix === 'ct' ? 'contractForm' : 'invoiceForm');
  if (client) {
    document.getElementById(prefix + '-client-name').value = client.family_name || client.parent_name || '';
    document.getElementById(prefix + '-client-email').value = client.email || '';
    form.dataset.clientKey = key;
  } else {
    form.dataset.clientKey = '';
  }
}

/* ═══════════════ NEW / EDIT CLIENT FORM ═══════════════ */

function openNewClientForm() {
  editingClientKey = null;
  childrenList = [{ name: '', age: '', allergies: '', notes: '' }];
  document.getElementById('client-edit-title').textContent = 'New Client';
  document.getElementById('clientForm').reset();
  document.getElementById('cl-status').value = 'active';
  document.getElementById('clients-list').style.display = 'none';
  document.getElementById('client-toolbar').style.display = 'none';
  document.getElementById('client-profile').style.display = 'none';
  document.getElementById('client-edit-form').style.display = 'block';
  renderChildren();
}

function openClientEdit(key) {
  const client = clientsCache.find(c => c._key === key);
  if (!client) return;
  editingClientKey = key;
  childrenList = (client.children || []).map(c => ({ ...c }));
  if (childrenList.length === 0) childrenList = [{ name: '', age: '', allergies: '', notes: '' }];

  document.getElementById('client-edit-title').textContent = 'Edit: ' + (client.family_name || client.parent_name);
  document.getElementById('cl-family-name').value = client.family_name || '';
  document.getElementById('cl-parent-name').value = client.parent_name || '';
  document.getElementById('cl-email').value = client.email || '';
  document.getElementById('cl-phone').value = client.phone || '';
  document.getElementById('cl-address').value = client.address || '';
  document.getElementById('cl-notes').value = client.notes || '';
  document.getElementById('cl-status').value = client.status || 'active';

  document.getElementById('clients-list').style.display = 'none';
  document.getElementById('client-toolbar').style.display = 'none';
  document.getElementById('client-profile').style.display = 'none';
  document.getElementById('client-edit-form').style.display = 'block';
  renderChildren();
}

function closeClientForm() {
  document.getElementById('client-edit-form').style.display = 'none';
  const profileKey = document.getElementById('client-profile').dataset.key;
  if (editingClientKey && profileKey === editingClientKey) {
    refreshClients().then(() => openClientProfile(editingClientKey));
  } else {
    document.getElementById('clients-list').style.display = '';
    document.getElementById('client-toolbar').style.display = '';
  }
  editingClientKey = null;
}

/* ═══════════════ CHILDREN REPEATER ═══════════════ */

function renderChildren() {
  const container = document.getElementById('cl-children-repeater');
  let html = '';
  childrenList.forEach((child, i) => {
    html += '<div class="child-row">' +
      '<div class="child-row-header">' +
        '<span class="child-row-num">👶 Child ' + (i + 1) + '</span>' +
        (childrenList.length > 1 ? '<button type="button" class="btn btn-danger btn-sm" onclick="removeChild(' + i + ')" style="padding:2px 8px;">✕</button>' : '') +
      '</div>' +
      '<div class="child-row-fields">' +
        '<div class="form-group"><label>Name</label><input type="text" value="' + escAttr(child.name) + '" onchange="updateChild(' + i + ',\'name\',this.value)" placeholder="Child\'s name"></div>' +
        '<div class="form-group"><label>Age</label><input type="text" value="' + escAttr(child.age) + '" onchange="updateChild(' + i + ',\'age\',this.value)" placeholder="e.g. 3"></div>' +
        '<div class="form-group"><label>Allergies</label><input type="text" value="' + escAttr(child.allergies) + '" onchange="updateChild(' + i + ',\'allergies\',this.value)" placeholder="e.g. peanuts"></div>' +
        '<div class="form-group"><label>Notes</label><input type="text" value="' + escAttr(child.notes) + '" onchange="updateChild(' + i + ',\'notes\',this.value)" placeholder="Preferences..."></div>' +
      '</div>' +
    '</div>';
  });
  container.innerHTML = html;
}

function addChild() {
  childrenList.push({ name: '', age: '', allergies: '', notes: '' });
  renderChildren();
}

function removeChild(index) {
  childrenList.splice(index, 1);
  renderChildren();
}

function updateChild(index, field, value) {
  childrenList[index][field] = value;
}

/* ═══════════════ SAVE CLIENT ═══════════════ */

document.getElementById('clientForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  if (!firebaseReady) { alert('Firebase not connected'); return; }

  const children = childrenList.filter(c => c.name && c.name.trim());

  const clientData = {
    family_name: document.getElementById('cl-family-name').value,
    parent_name: document.getElementById('cl-parent-name').value,
    email: document.getElementById('cl-email').value,
    phone: document.getElementById('cl-phone').value,
    address: document.getElementById('cl-address').value,
    children: children,
    notes: document.getElementById('cl-notes').value,
    status: document.getElementById('cl-status').value || 'active',
    updated_at: new Date().toISOString()
  };

  try {
    if (editingClientKey) {
      await fbUpdate('/clients/' + editingClientKey, clientData);
      logActivity('client_updated', 'Updated client: ' + clientData.family_name, 'client');
    } else {
      clientData.created_at = new Date().toISOString();
      await fbPush('/clients', clientData);
      logActivity('client_created', 'Created client: ' + clientData.family_name, 'client');
    }
    closeClientForm();
    refreshClients();
    syncBlockedDates();
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
});

/* ═══════════════ DELETE CLIENT ═══════════════ */

/* ═══════════════ TOGGLE ACTIVE / INACTIVE ═══════════════ */

async function toggleClientStatus(key) {
  const client = clientsCache.find(c => c._key === key);
  if (!client) return;
  const currentStatus = client.status || 'active';
  const newStatus = (currentStatus === 'active') ? 'inactive' : 'active';
  const label = newStatus === 'inactive' ? 'mark this client as inactive' : 're-activate this client';
  if (!confirm('Are you sure you want to ' + label + '?')) return;
  try {
    await fbUpdate('/clients/' + key, { status: newStatus, updated_at: new Date().toISOString() });
    logActivity('client_status', (newStatus === 'inactive' ? 'Deactivated' : 'Re-activated') + ' client: ' + (client.family_name || client.parent_name), 'client');
    await refreshClients();
    syncBlockedDates();
    openClientProfile(key);
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

/* ═══════════════ AVAILABILITY OVERRIDE ═══════════════ */

async function toggleAvailabilityOverride(key) {
  const client = clientsCache.find(c => c._key === key);
  if (!client) return;
  const current = !!client.availability_override;
  const newVal = !current;
  const msg = newVal
    ? 'Turn ON availability override? The public calendar will show trial slots as available even during this client\'s contract dates.'
    : 'Turn OFF availability override? The public calendar will block trial bookings during this client\'s contract dates.';
  if (!confirm(msg)) return;
  try {
    await fbUpdate('/clients/' + key, { availability_override: newVal, updated_at: new Date().toISOString() });
    logActivity('client_override', (newVal ? 'Enabled' : 'Disabled') + ' availability override for ' + (client.family_name || client.parent_name), 'client');
    await refreshClients();
    syncBlockedDates();
    openClientProfile(key);
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function deleteClient(key) {
  if (!confirm('Delete this client? This cannot be undone.')) return;
  try {
    await fbRemove('/clients/' + key);
    logActivity('client_deleted', 'Deleted client', 'client');
    closeClientProfile();
    refreshClients();
    syncBlockedDates();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

/* ═══════════════ HELPERS ═══════════════ */

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function escAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Sync blocked dates to public /blocked_dates node ── */
async function syncBlockedDates() {
  if (!firebaseReady) return;
  try {
    const snap = await fbOnce('/clients/');
    const clients = snap.val() || {};
    const blocked = {};
    Object.values(clients).forEach(function(c) {
      if ((c.status === 'active') && c.contract_start && !c.availability_override) {
        const start = new Date(c.contract_start + 'T00:00:00');
        const end = c.contract_end
          ? new Date(c.contract_end + 'T00:00:00')
          : new Date(new Date().getFullYear(), new Date().getMonth() + 3, 0);
        for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          var key = d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
          blocked[key] = true;
        }
      }
    });
    await fbSet('/blocked_dates', blocked);
  } catch (e) {
    console.warn('[Clients] Failed to sync blocked dates:', e);
  }
}

// Search binding
document.getElementById('client-search').addEventListener('input', () => refreshClients());
