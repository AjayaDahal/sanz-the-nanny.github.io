/* ─────────────────────────────────────────────────
   contracts.js — Nanny service agreement builder
   Adapted from AjayaDesign contracts.js pattern
   ───────────────────────────────────────────────── */

let contractsCache = [];
let contractClauses = [];
let editingContractKey = null;

/* ── Default clauses for nanny service agreements ── */
const DEFAULT_CLAUSES = [
  { id: 'scope', title: 'Scope of Services', body: 'The Nanny agrees to provide childcare services including but not limited to: supervision, feeding, bathing, diaper changes, transportation to/from activities, homework assistance, educational play, and age-appropriate activities. Light housekeeping related to child care (cleaning up after meals, tidying play areas, children\'s laundry) is included.', category: 'core', enabled: true },
  { id: 'schedule', title: 'Work Schedule', body: 'The Nanny shall work the following schedule: [SCHEDULE]. Any changes to the regular schedule must be communicated at least 48 hours in advance. Overtime beyond the agreed schedule will be compensated at 1.5x the regular rate.', category: 'core', enabled: true },
  { id: 'compensation', title: 'Compensation & Payment', body: 'The Family agrees to pay the Nanny [RATE] via [METHOD]. Payment shall be made [FREQUENCY]. Mileage reimbursement at the current IRS rate applies for any driving required during work hours.', category: 'core', enabled: true },
  { id: 'trial-period', title: 'Trial Period', body: 'The first two (2) weeks of employment shall be considered a trial period. During this time, either party may terminate the agreement with 24 hours written notice.', category: 'core', enabled: true },
  { id: 'confidentiality', title: 'Confidentiality', body: 'The Nanny agrees to maintain strict confidentiality regarding all family information, including but not limited to: home address, daily routines, financial information, medical information about children, and any personal family matters.', category: 'legal', enabled: true },
  { id: 'health-safety', title: 'Health & Safety', body: 'The Nanny maintains current CPR and First Aid certification. The Nanny will follow all safety protocols established by the Family. In the event of a medical emergency, the Nanny is authorized to seek immediate medical attention and will contact the parents as soon as possible.', category: 'core', enabled: true },
  { id: 'sick-days', title: 'Sick Days & Time Off', body: 'The Nanny is entitled to [X] paid sick days and [X] paid vacation days per year. The Nanny will provide as much advance notice as possible for planned time off. The Family will provide [X] paid holidays per year.', category: 'core', enabled: true },
  { id: 'termination', title: 'Termination', body: 'After the trial period, either party may terminate this agreement with two (2) weeks written notice. Immediate termination may occur in cases of gross misconduct, endangerment of children, or violation of confidentiality.', category: 'legal', enabled: true },
  { id: 'house-rules', title: 'House Rules & Guidelines', body: 'The Nanny agrees to follow all house rules established by the Family, including but not limited to: screen time limits, dietary restrictions/allergies, discipline approach, and approved activities/outings. A detailed guide will be provided separately.', category: 'core', enabled: true },
  { id: 'communication', title: 'Communication', body: 'The Nanny will provide daily updates to the parents regarding the children\'s activities, meals, naps, and any concerns. Communication will be via [text/app/email]. The Nanny will immediately notify parents of any injuries, illnesses, or behavioral concerns.', category: 'core', enabled: true },
  { id: 'transportation', title: 'Transportation', body: 'The Nanny [will/will not] be required to provide transportation for children. If transportation is required, the Nanny must maintain a valid driver\'s license, current auto insurance, and use an approved car seat for each child.', category: 'core', enabled: false },
  { id: 'background-check', title: 'Background Check', body: 'The Nanny consents to a comprehensive background check at the Family\'s expense. This may include criminal history, driving record, and reference verification.', category: 'legal', enabled: false },
];

async function refreshContracts(filter) {
  filter = filter || 'all';
  const container = document.getElementById('contracts-list');
  container.className = 'loading';
  container.textContent = 'Loading contracts...';
  if (!firebaseReady) { container.className = ''; container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Firebase not connected</p></div>'; return; }

  try {
    const snap = await fbOnce('/contracts/');
    const data = snap.val() || {};
    contractsCache = Object.entries(data).map(([k, v]) => ({ _key: k, ...v }));
    contractsCache.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    let filtered = contractsCache;
    if (filter !== 'all') filtered = contractsCache.filter(c => c.status === filter);

    container.className = '';
    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><p>No ' + (filter === 'all' ? '' : filter + ' ') + 'contracts found</p></div>';
      return;
    }

    let html = '<table class="data-table"><thead><tr>' +
      '<th>Client</th><th>Service</th><th>Rate</th><th>Status</th><th>Created</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    filtered.forEach(c => {
      const badgeCls = 'badge-' + (c.status || 'draft');
      html += '<tr>' +
        '<td><strong>' + (c.client_name || '—') + '</strong></td>' +
        '<td>' + (c.service_type || '—') + '</td>' +
        '<td>' + (c.rate || '—') + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + (c.status || 'draft') + '</span></td>' +
        '<td>' + formatDate(c.created_at) + '</td>' +
        '<td><div class="btn-group">' +
          '<button class="btn btn-outline btn-sm" onclick="openEditContract(\'' + c._key + '\')">Edit</button>' +
          '<button class="btn btn-outline btn-sm" onclick="downloadContractPDFByKey(\'' + c._key + '\')">📄 PDF</button>' +
          (c.status === 'draft' ? '<button class="btn btn-danger btn-sm" onclick="deleteContract(\'' + c._key + '\')">Delete</button>' : '') +
        '</div></td>' +
      '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    console.warn('[Contracts] Error:', err);
    container.className = '';
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>Error loading contracts</p></div>';
  }
}

function openNewContract() {
  editingContractKey = null;
  contractClauses = DEFAULT_CLAUSES.map(c => ({ ...c }));
  document.getElementById('contract-builder-title').textContent = 'New Service Agreement';
  document.getElementById('contractForm').reset();
  document.getElementById('contractForm').dataset.clientKey = '';
  document.getElementById('contract-builder').style.display = 'block';
  document.getElementById('contracts-list').style.display = 'none';
  if (typeof populateClientSelect === 'function') populateClientSelect('ct-client-select');
  renderClauses();
}

function openEditContract(key) {
  const contract = contractsCache.find(c => c._key === key);
  if (!contract) return;
  editingContractKey = key;
  document.getElementById('contract-builder-title').textContent = 'Edit: ' + (contract.client_name || 'Contract');
  document.getElementById('ct-client-name').value = contract.client_name || '';
  document.getElementById('ct-client-email').value = contract.client_email || '';
  document.getElementById('ct-service-type').value = contract.service_type || 'Full-Time Nanny';
  document.getElementById('ct-rate').value = contract.rate || '';
  document.getElementById('ct-start-date').value = contract.start_date || '';
  document.getElementById('ct-end-date').value = contract.end_date || '';
  document.getElementById('ct-schedule').value = contract.schedule || '';
  document.getElementById('ct-notes').value = contract.notes || '';
  contractClauses = (contract.clauses && contract.clauses.length) ? contract.clauses.map(c => ({ ...c })) : DEFAULT_CLAUSES.map(c => ({ ...c }));
  document.getElementById('contractForm').dataset.clientKey = contract.client_key || '';
  document.getElementById('contract-builder').style.display = 'block';
  document.getElementById('contracts-list').style.display = 'none';
  if (typeof populateClientSelect === 'function') populateClientSelect('ct-client-select', contract.client_key);
  renderClauses();
}

function closeContractBuilder() {
  document.getElementById('contract-builder').style.display = 'none';
  document.getElementById('contracts-list').style.display = 'block';
  editingContractKey = null;
}

function renderClauses() {
  const container = document.getElementById('contract-clauses');
  let html = '';
  contractClauses.forEach((clause, i) => {
    const catColors = { core: 'var(--pink)', legal: 'var(--yellow)', technical: 'var(--blue)', support: 'var(--green)' };
    html += '<div class="clause-card ' + (clause.enabled ? '' : 'disabled') + '">' +
      '<div class="clause-card-header">' +
        '<h4>' + (clause.title || 'Untitled Clause') + '</h4>' +
        '<span class="badge" style="background:' + (catColors[clause.category] || 'var(--text-dim)') + '22;color:' + (catColors[clause.category] || 'var(--text-dim)') + ';">' + (clause.category || 'general') + '</span>' +
        '<label class="clause-toggle"><input type="checkbox" ' + (clause.enabled ? 'checked' : '') + ' onchange="toggleClause(' + i + ', this.checked)"><span class="slider"></span></label>' +
        '<button class="btn btn-danger btn-sm" onclick="removeClause(' + i + ')" style="padding:2px 8px;">✕</button>' +
      '</div>' +
      '<div class="clause-body">' +
        '<textarea onchange="updateClauseBody(' + i + ', this.value)">' + (clause.body || '') + '</textarea>' +
      '</div>' +
    '</div>';
  });
  container.innerHTML = html;
}

function toggleClause(index, enabled) {
  contractClauses[index].enabled = enabled;
  renderClauses();
}

function updateClauseBody(index, body) {
  contractClauses[index].body = body;
}

function removeClause(index) {
  contractClauses.splice(index, 1);
  renderClauses();
}

function addClause() {
  contractClauses.push({
    id: 'custom-' + shortId().toLowerCase(),
    title: 'Custom Clause',
    body: '',
    category: 'core',
    enabled: true
  });
  renderClauses();
}

/* ── Save Contract (shared logic) ── */
async function saveContractData() {
  if (!firebaseReady) throw new Error('Firebase not connected');

  const contractData = {
    client_name: document.getElementById('ct-client-name').value,
    client_email: document.getElementById('ct-client-email').value,
    client_key: document.getElementById('contractForm').dataset.clientKey || '',
    service_type: document.getElementById('ct-service-type').value,
    rate: document.getElementById('ct-rate').value,
    start_date: document.getElementById('ct-start-date').value,
    end_date: document.getElementById('ct-end-date').value,
    schedule: document.getElementById('ct-schedule').value,
    notes: document.getElementById('ct-notes').value,
    clauses: contractClauses,
    updated_at: new Date().toISOString()
  };

  if (editingContractKey) {
    await fbUpdate('/contracts/' + editingContractKey, contractData);
    logActivity('contract_updated', 'Updated contract for ' + contractData.client_name, 'contract');
    // Sync dates to linked client
    if (contractData.client_key) {
      const dateSync = { updated_at: new Date().toISOString() };
      if (contractData.start_date) dateSync.contract_start = contractData.start_date;
      if (contractData.end_date) dateSync.contract_end = contractData.end_date;
      if (contractData.service_type) dateSync.service_type = contractData.service_type;
      if (contractData.schedule) dateSync.schedule = contractData.schedule;
      fbUpdate('/clients/' + contractData.client_key, dateSync).catch(e => console.warn('Date sync failed:', e));
    }
    return editingContractKey;
  } else {
    contractData.status = 'draft';
    contractData.created_at = new Date().toISOString();
    contractData.short_id = shortId();
    const ref = await fbPush('/contracts', contractData);
    logActivity('contract_created', 'Created contract for ' + contractData.client_name, 'contract');
    // Sync dates to linked client
    if (contractData.client_key) {
      const dateSync = { updated_at: new Date().toISOString() };
      if (contractData.start_date) dateSync.contract_start = contractData.start_date;
      if (contractData.end_date) dateSync.contract_end = contractData.end_date;
      if (contractData.service_type) dateSync.service_type = contractData.service_type;
      if (contractData.schedule) dateSync.schedule = contractData.schedule;
      fbUpdate('/clients/' + contractData.client_key, dateSync).catch(e => console.warn('Date sync failed:', e));
    }
    return ref.key;
  }
}

/* ── Form submit handler ── */
document.getElementById('contractForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  try {
    await saveContractData();
    closeContractBuilder();
    refreshContracts();
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
});

/* ── Send Contract via Email ── */
async function sendContract() {
  const clientName = document.getElementById('ct-client-name').value;
  const clientEmail = document.getElementById('ct-client-email').value;
  if (!clientEmail) { alert('Client email is required to send'); return; }
  if (!clientName) { alert('Client name is required'); return; }

  const sendBtn = document.querySelector('[onclick="sendContract()"]');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending...'; }

  try {
    // Save first (await properly — no more dispatchEvent)
    const savedKey = await saveContractData();
    editingContractKey = savedKey;

    if (typeof sendBrandedEmail !== 'function') {
      alert('EmailJS not configured. Please set up EmailJS to send contracts.');
      return;
    }

    // Generate a signing token
    const signingToken = shortId() + shortId();
    const signingUrl = location.origin + location.pathname.replace('index.html', '') + 'sign.html?token=' + signingToken;

    // Save signing data
    await fbSet('/signing/' + signingToken, {
      contract_key: savedKey,
      client_name: clientName,
      client_email: clientEmail,
      status: 'pending',
      created_at: new Date().toISOString()
    });

    // Update contract status to sent
    await fbUpdate('/contracts/' + savedKey, { status: 'sent', signing_token: signingToken });

    // Build clauses HTML
    const enabledClauses = contractClauses.filter(c => c.enabled);
    let clausesHtml = '';
    enabledClauses.forEach((c, i) => {
      clausesHtml += '<div style="margin-bottom:16px;padding:12px;background:#fff5f7;border-radius:8px;border-left:3px solid #ff6b9d;">' +
        '<strong style="color:#c44569;">' + (i + 1) + '. ' + (c.title || 'Clause') + '</strong>' +
        '<p style="margin:6px 0 0;color:#444;font-size:14px;">' + (c.body || '').replace(/\n/g, '<br>') + '</p>' +
      '</div>';
    });

    const serviceType = document.getElementById('ct-service-type').value;
    const rate = document.getElementById('ct-rate').value;
    const schedule = document.getElementById('ct-schedule').value || 'As agreed';
    const startDate = document.getElementById('ct-start-date').value ? formatDate(document.getElementById('ct-start-date').value) : 'TBD';
    const notes = document.getElementById('ct-notes').value || '';

    const contractBody = '<p style="font-size:15px;color:#333;">Hi ' + clientName + ',</p>' +
      '<p style="color:#555;">Please review your nanny service agreement below:</p>' +
      '<table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse;">' +
        '<tr><td style="padding:8px 12px;font-weight:600;color:#c44569;width:110px;">Service</td><td style="padding:8px 12px;">' + serviceType + '</td></tr>' +
        '<tr style="background:#fff5f7;"><td style="padding:8px 12px;font-weight:600;color:#c44569;">Rate</td><td style="padding:8px 12px;">' + rate + '</td></tr>' +
        '<tr><td style="padding:8px 12px;font-weight:600;color:#c44569;">Schedule</td><td style="padding:8px 12px;">' + schedule + '</td></tr>' +
        '<tr style="background:#fff5f7;"><td style="padding:8px 12px;font-weight:600;color:#c44569;">Start Date</td><td style="padding:8px 12px;">' + startDate + '</td></tr>' +
      '</table>' +
      '<h3 style="color:#c44569;margin:24px 0 12px;">Terms &amp; Conditions</h3>' +
      clausesHtml +
      (notes ? '<div style="margin-top:16px;padding:12px;background:#f9f9f9;border-radius:8px;"><strong>Notes:</strong> ' + notes + '</div>' : '') +
      '<div style="text-align:center;margin:24px 0;">' +
        '<a href="' + signingUrl + '" style="display:inline-block;background:linear-gradient(135deg,#ff6b9d,#c44569);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">Review &amp; Sign Agreement</a>' +
      '</div>';

    await sendBrandedEmail(clientEmail, 'Your Nanny Service Agreement - Sanz the Nanny', 'Service Agreement', contractBody, 'Please review and sign at your earliest convenience.');

    alert('Contract sent to ' + clientEmail + '!');
    logActivity('contract_sent', 'Sent contract to ' + clientName + ' (' + clientEmail + ')', 'contract');
    closeContractBuilder();
    refreshContracts();
  } catch (err) {
    console.error('Send contract error:', err);
    alert('Failed to send: ' + (err.text || err.message));
  } finally {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send to Client'; }
  }
}

/* ── Delete Contract ── */
async function deleteContract(key) {
  if (!confirm('Delete this contract?')) return;
  try {
    await fbRemove('/contracts/' + key);
    logActivity('contract_deleted', 'Deleted contract: ' + key, 'contract');
    refreshContracts();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

/* ── Download Contract as PDF ── */
function downloadContractPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const maxWidth = pageWidth - 2 * margin;
  let y = 20;

  function checkPage(needed) {
    if (y + needed > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 20;
    }
  }

  // Header
  doc.setFillColor(255, 107, 157);
  doc.rect(0, 0, pageWidth, 40, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont(undefined, 'bold');
  doc.text('Nanny Service Agreement', margin, 28);
  y = 55;

  // Parties
  doc.setTextColor(30, 30, 46);
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Service Provider:', margin, y);
  doc.setFont(undefined, 'normal');
  doc.text('Sanskriti Chaulagain (Sanz)', margin + 48, y);
  y += 8;
  doc.setFont(undefined, 'bold');
  doc.text('Client:', margin, y);
  doc.setFont(undefined, 'normal');
  doc.text(document.getElementById('ct-client-name').value || '—', margin + 48, y);
  y += 8;
  doc.setFont(undefined, 'bold');
  doc.text('Email:', margin, y);
  doc.setFont(undefined, 'normal');
  doc.text(document.getElementById('ct-client-email').value || '—', margin + 48, y);
  y += 15;

  // Service Details
  doc.setFillColor(255, 240, 245);
  doc.rect(margin, y, maxWidth, 40, 'F');
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text('Service: ', margin + 5, y + 10);
  doc.setFont(undefined, 'normal');
  doc.text(document.getElementById('ct-service-type').value || '—', margin + 30, y + 10);
  doc.setFont(undefined, 'bold');
  doc.text('Rate: ', margin + 5, y + 20);
  doc.setFont(undefined, 'normal');
  doc.text(document.getElementById('ct-rate').value || '—', margin + 30, y + 20);
  doc.setFont(undefined, 'bold');
  doc.text('Schedule: ', margin + 5, y + 30);
  doc.setFont(undefined, 'normal');
  doc.text(document.getElementById('ct-schedule').value || '—', margin + 35, y + 30);
  y += 55;

  // Clauses
  contractClauses.filter(c => c.enabled).forEach(clause => {
    checkPage(40);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(196, 69, 105);
    doc.text(clause.title, margin, y);
    y += 7;
    doc.setFont(undefined, 'normal');
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(clause.body || '', maxWidth);
    lines.forEach(line => {
      checkPage(7);
      doc.text(line, margin, y);
      y += 5.5;
    });
    y += 8;
  });

  // Client Signature area
  checkPage(50);
  y += 10;
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, margin + 100, y);
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('Client Signature', margin, y + 5);
  y += 10;
  doc.text('Date: _______________', margin, y);

  const filename = 'Sanz-Contract-' + (document.getElementById('ct-client-name').value || 'Draft').replace(/\s+/g, '-') + '.pdf';
  doc.save(filename);
}

/* ── Download Contract PDF by key (from list view) ── */
async function downloadContractPDFByKey(key) {
  const contract = contractsCache.find(c => c._key === key);
  if (!contract) { alert('Contract not found'); return; }

  // Also try to load signing data for signed contracts
  let signingData = null;
  if (contract.status === 'signed') {
    try {
      const sigSnap = await fbOnce('/signing/');
      const sigAll = sigSnap.val() || {};
      const match = Object.entries(sigAll).find(([, v]) => v.contract_key === key);
      if (match) signingData = match[1];
    } catch (_) {}
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const maxWidth = pageWidth - 2 * margin;
  let y = 20;

  function checkPage(needed) {
    if (y + needed > pageHeight - 25) { doc.addPage(); y = 20; }
  }

  // Header
  doc.setFillColor(255, 107, 157);
  doc.rect(0, 0, pageWidth, 40, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont(undefined, 'bold');
  doc.text('Nanny Service Agreement', margin, 28);
  y = 50;

  // Status
  var status = (contract.status || 'draft').toUpperCase();
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text('Status: ' + status, pageWidth - margin - 40, 48);
  y = 55;

  // Parties
  doc.setTextColor(30, 30, 46);
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Service Provider:', margin, y);
  doc.setFont(undefined, 'normal');
  doc.text('Sanskriti Chaulagain (Sanz)', margin + 50, y);
  y += 8;
  doc.setFont(undefined, 'bold');
  doc.text('Client:', margin, y);
  doc.setFont(undefined, 'normal');
  doc.text(contract.client_name || '—', margin + 50, y);
  y += 8;
  doc.setFont(undefined, 'bold');
  doc.text('Email:', margin, y);
  doc.setFont(undefined, 'normal');
  doc.text(contract.client_email || '—', margin + 50, y);
  y += 15;

  // Service details
  doc.setFillColor(255, 240, 245);
  doc.roundedRect(margin, y, maxWidth, 35, 3, 3, 'F');
  doc.setFontSize(11);
  var detailY = y + 10;
  doc.setFont(undefined, 'bold');
  doc.text('Service:', margin + 5, detailY);
  doc.setFont(undefined, 'normal');
  doc.text(contract.service_type || '—', margin + 32, detailY);
  doc.setFont(undefined, 'bold');
  doc.text('Rate:', margin + 5, detailY + 10);
  doc.setFont(undefined, 'normal');
  doc.text(contract.rate ? '$' + contract.rate : '—', margin + 32, detailY + 10);
  doc.setFont(undefined, 'bold');
  doc.text('Schedule:', margin + 5, detailY + 20);
  doc.setFont(undefined, 'normal');
  doc.text(contract.schedule || '—', margin + 35, detailY + 20);
  if (contract.start_date) {
    doc.setFont(undefined, 'bold');
    doc.text('Start Date:', pageWidth / 2, detailY);
    doc.setFont(undefined, 'normal');
    doc.text(contract.start_date, pageWidth / 2 + 35, detailY);
  }
  y += 50;

  // Clauses
  var clauses = (contract.clauses || []).filter(function(cl) { return cl.enabled !== false; });
  clauses.forEach(function(clause, i) {
    checkPage(30);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(196, 69, 105);
    doc.text((i + 1) + '. ' + (clause.title || ''), margin, y);
    y += 7;
    doc.setFont(undefined, 'normal');
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(10);
    var lines = doc.splitTextToSize(clause.body || clause.text || '', maxWidth);
    lines.forEach(function(line) {
      checkPage(7);
      doc.text(line, margin, y);
      y += 5.5;
    });
    y += 8;
  });

  // Client Signature area
  checkPage(60);
  y += 10;
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, margin + 100, y);
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('Client Signature', margin, y + 5);

  if (signingData && signingData.status === 'signed' && signingData.signer_name) {
    doc.setFontSize(12);
    doc.setTextColor(30, 30, 60);
    doc.setFont(undefined, 'italic');
    doc.text(signingData.signer_name, margin + 5, y - 5);

    if (signingData.signature_data) {
      try { doc.addImage(signingData.signature_data, 'PNG', margin, y - 35, 60, 28); } catch (_) {}
    }

    y += 10;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('Signed by: ' + signingData.signer_name, margin, y);
    y += 5;
    doc.text('Date: ' + new Date(signingData.signed_at).toLocaleDateString(), margin, y);
  } else {
    y += 10;
    doc.text('Date: _______________', margin, y);
  }

  // Footer
  y = pageHeight - 15;
  doc.setFontSize(8);
  doc.setTextColor(180, 180, 180);
  doc.text('Sanz the Nanny — Austin, TX — sanz.the.nanny@gmail.com', pageWidth / 2, y, { align: 'center' });

  doc.save('Sanz-Contract-' + (contract.client_name || 'Draft').replace(/\s+/g, '-') + '.pdf');
}
