/* ─────────────────────────────────────────────────
   invoices.js — Invoice management
   Adapted from AjayaDesign invoices.js pattern
   ───────────────────────────────────────────────── */

let invoicesCache = [];
let invoiceItems = [];
let editingInvoiceKey = null;

/* ── PayPal config — update with Sanz's PayPal.me ── */
const PAYPAL_ME = '__PAYPAL_ME_USERNAME__'; // e.g., 'sanztheNanny'
const PAYPAL_FEE_PERCENT = 0.0349;
const PAYPAL_FEE_FIXED = 0.49;

function calcPayPalGross(net) {
  const gross = (net + PAYPAL_FEE_FIXED) / (1 - PAYPAL_FEE_PERCENT);
  return Math.ceil(gross * 100) / 100;
}

function getPayPalLink(amount) {
  if (PAYPAL_ME.startsWith('__')) return '#';
  const gross = calcPayPalGross(amount);
  return 'https://paypal.me/' + PAYPAL_ME + '/' + gross.toFixed(2) + 'USD';
}

async function refreshInvoices(filter) {
  filter = filter || 'all';
  const container = document.getElementById('invoices-list');
  container.className = 'loading';
  container.textContent = 'Loading invoices...';
  if (!firebaseReady) { container.className = ''; container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Firebase not connected</p></div>'; return; }

  try {
    const snap = await fbOnce('/invoices/');
    const data = snap.val() || {};
    invoicesCache = Object.entries(data).map(([k, v]) => ({ _key: k, ...v }));
    invoicesCache.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    let filtered = invoicesCache;
    if (filter !== 'all') {
      if (filter === 'overdue') {
        const now = new Date();
        filtered = invoicesCache.filter(inv => inv.payment_status !== 'paid' && inv.due_date && new Date(inv.due_date) < now);
      } else {
        filtered = invoicesCache.filter(inv => inv.payment_status === filter);
      }
    }

    container.className = '';
    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">💰</div><p>No ' + (filter === 'all' ? '' : filter + ' ') + 'invoices found</p></div>';
      return;
    }

    let html = '<table class="data-table"><thead><tr>' +
      '<th>#</th><th>Client</th><th>Amount</th><th>Due</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    filtered.forEach(inv => {
      const isOverdue = inv.payment_status !== 'paid' && inv.due_date && new Date(inv.due_date) < new Date();
      const status = isOverdue ? 'overdue' : (inv.payment_status || 'unpaid');
      const badgeCls = 'badge-' + status;

      html += '<tr>' +
        '<td><strong>' + (inv.invoice_number || inv._key.substring(0, 6).toUpperCase()) + '</strong></td>' +
        '<td>' + (inv.client_name || '—') + '</td>' +
        '<td style="color:var(--pink);font-weight:600;">' + formatCurrency(inv.total_amount) + '</td>' +
        '<td>' + formatDate(inv.due_date) + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + status + '</span></td>' +
        '<td><div class="btn-group">' +
          '<button class="btn btn-outline btn-sm" onclick="openEditInvoice(\'' + inv._key + '\')">Edit</button>' +
          (status !== 'paid' ? '<button class="btn btn-success btn-sm" onclick="markInvoicePaid(\'' + inv._key + '\')">Mark Paid</button>' : '') +
          '<button class="btn btn-danger btn-sm" onclick="deleteInvoice(\'' + inv._key + '\')">Delete</button>' +
        '</div></td>' +
      '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    console.warn('[Invoices] Error:', err);
    container.className = '';
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>Error loading invoices</p></div>';
  }
}

function openNewInvoice() {
  editingInvoiceKey = null;
  invoiceItems = [{ description: '', quantity: 1, unit_price: 0, amount: 0 }];
  document.getElementById('invoice-builder-title').textContent = 'New Invoice';
  document.getElementById('invoiceForm').reset();
  document.getElementById('invoiceForm').dataset.clientKey = '';
  document.getElementById('inv-number').value = 'INV-' + shortId();
  document.getElementById('invoice-builder').style.display = 'block';
  document.getElementById('invoices-list').style.display = 'none';
  if (typeof populateClientSelect === 'function') populateClientSelect('inv-client-select');
  renderInvoiceItems();
  recalcInvoice();
}

function openEditInvoice(key) {
  const inv = invoicesCache.find(i => i._key === key);
  if (!inv) return;
  editingInvoiceKey = key;
  document.getElementById('invoice-builder-title').textContent = 'Edit: ' + (inv.invoice_number || inv._key.substring(0, 6));
  document.getElementById('inv-client-name').value = inv.client_name || '';
  document.getElementById('inv-client-email').value = inv.client_email || '';
  document.getElementById('inv-number').value = inv.invoice_number || '';
  document.getElementById('inv-due-date').value = inv.due_date || '';
  document.getElementById('inv-tax-rate').value = inv.tax_rate || 0;
  document.getElementById('inv-notes').value = inv.notes || '';
  invoiceItems = (inv.items && inv.items.length) ? inv.items.map(i => ({ ...i })) : [{ description: '', quantity: 1, unit_price: 0, amount: 0 }];
  document.getElementById('invoiceForm').dataset.clientKey = inv.client_key || '';
  document.getElementById('invoice-builder').style.display = 'block';
  document.getElementById('invoices-list').style.display = 'none';
  if (typeof populateClientSelect === 'function') populateClientSelect('inv-client-select', inv.client_key);
  renderInvoiceItems();
  recalcInvoice();
}

function closeInvoiceBuilder() {
  document.getElementById('invoice-builder').style.display = 'none';
  document.getElementById('invoices-list').style.display = 'block';
  editingInvoiceKey = null;
}

function renderInvoiceItems() {
  const container = document.getElementById('invoice-items');
  let html = '';
  invoiceItems.forEach((item, i) => {
    html += '<div class="invoice-item-row">' +
      '<input type="text" placeholder="Description" value="' + (item.description || '') + '" onchange="updateInvoiceItem(' + i + ',\'description\',this.value)">' +
      '<input type="number" min="0" value="' + (item.quantity || 1) + '" onchange="updateInvoiceItem(' + i + ',\'quantity\',this.value)">' +
      '<input type="number" min="0" step="0.01" value="' + (item.unit_price || 0) + '" onchange="updateInvoiceItem(' + i + ',\'unit_price\',this.value)">' +
      '<span style="text-align:right;color:var(--pink);font-weight:600;">' + formatCurrency(item.amount || 0) + '</span>' +
      '<button class="btn btn-danger btn-sm" style="padding:2px 6px;" onclick="removeInvoiceItem(' + i + ')">✕</button>' +
    '</div>';
  });
  container.innerHTML = html;
}

function addInvoiceItem() {
  invoiceItems.push({ description: '', quantity: 1, unit_price: 0, amount: 0 });
  renderInvoiceItems();
}

function removeInvoiceItem(index) {
  invoiceItems.splice(index, 1);
  renderInvoiceItems();
  recalcInvoice();
}

function updateInvoiceItem(index, field, value) {
  if (field === 'quantity' || field === 'unit_price') {
    invoiceItems[index][field] = parseFloat(value) || 0;
    invoiceItems[index].amount = invoiceItems[index].quantity * invoiceItems[index].unit_price;
  } else {
    invoiceItems[index][field] = value;
  }
  renderInvoiceItems();
  recalcInvoice();
}

function recalcInvoice() {
  const subtotal = invoiceItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const taxRate = (parseFloat(document.getElementById('inv-tax-rate').value) || 0) / 100;
  const tax = subtotal * taxRate;
  const total = subtotal + tax;
  document.getElementById('inv-subtotal').textContent = formatCurrency(subtotal);
  document.getElementById('inv-tax').textContent = formatCurrency(tax);
  document.getElementById('inv-total').textContent = formatCurrency(total);
}

// Recalc on tax rate change
document.getElementById('inv-tax-rate').addEventListener('input', recalcInvoice);

/* ── Save Invoice (shared logic) ── */
async function saveInvoiceData() {
  if (!firebaseReady) throw new Error('Firebase not connected');

  const subtotal = invoiceItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const taxRate = (parseFloat(document.getElementById('inv-tax-rate').value) || 0) / 100;
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  const invoiceData = {
    client_name: document.getElementById('inv-client-name').value,
    client_email: document.getElementById('inv-client-email').value,
    client_key: document.getElementById('invoiceForm').dataset.clientKey || '',
    invoice_number: document.getElementById('inv-number').value,
    due_date: document.getElementById('inv-due-date').value,
    items: invoiceItems,
    subtotal: subtotal,
    tax_rate: parseFloat(document.getElementById('inv-tax-rate').value) || 0,
    tax_amount: tax,
    total_amount: total,
    notes: document.getElementById('inv-notes').value,
    updated_at: new Date().toISOString()
  };

  if (editingInvoiceKey) {
    await fbUpdate('/invoices/' + editingInvoiceKey, invoiceData);
    logActivity('invoice_updated', 'Updated invoice ' + invoiceData.invoice_number + ' for ' + invoiceData.client_name, 'invoice');
    return editingInvoiceKey;
  } else {
    invoiceData.payment_status = 'unpaid';
    invoiceData.created_at = new Date().toISOString();
    const ref = await fbPush('/invoices', invoiceData);
    logActivity('invoice_created', 'Created invoice ' + invoiceData.invoice_number + ' for ' + invoiceData.client_name, 'invoice');
    return ref.key;
  }
}

/* ── Form submit handler ── */
document.getElementById('invoiceForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  try {
    await saveInvoiceData();
    closeInvoiceBuilder();
    refreshInvoices();
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
});

/* ── Mark Paid ── */
async function markInvoicePaid(key) {
  if (!confirm('Mark this invoice as paid?')) return;
  try {
    await fbUpdate('/invoices/' + key, { payment_status: 'paid', paid_at: new Date().toISOString() });
    logActivity('invoice_paid', 'Marked invoice as paid: ' + key, 'invoice');

    // Send payment receipt email
    const inv = invoicesCache.find(i => i._key === key);
    if (inv && inv.client_email && typeof sendBrandedEmail === 'function') {
      const invNum = inv.invoice_number || key.substring(0, 6).toUpperCase();
      const paidDate = formatDate(new Date().toISOString());
      const receiptBody = '<p style="font-size:15px;color:#333;">Hi ' + (inv.client_name || 'there') + ',</p>' +
        '<p style="color:#555;">This confirms that your payment has been received. Thank you!</p>' +
        '<div style="background:#f0fdf4;padding:16px;border-radius:8px;margin:16px 0;border:1px solid #bbf7d0;">' +
          '<table style="width:100%;font-size:14px;">' +
            '<tr><td style="font-weight:600;color:#166534;padding:4px 0;">Invoice #</td><td>' + invNum + '</td></tr>' +
            '<tr><td style="font-weight:600;color:#166534;padding:4px 0;">Amount Paid</td><td style="font-weight:700;color:#166534;">' + formatCurrency(inv.total_amount || 0) + '</td></tr>' +
            '<tr><td style="font-weight:600;color:#166534;padding:4px 0;">Date Paid</td><td>' + paidDate + '</td></tr>' +
          '</table>' +
        '</div>' +
        '<p style="color:#555;">No further action is needed. If you have any questions, feel free to reach out.</p>' +
        '<p style="color:#c44569;font-weight:600;">&mdash; Sanz</p>';
      sendBrandedEmail(inv.client_email, 'Payment Received - Invoice ' + invNum, 'Payment Received!', receiptBody, 'This is your payment confirmation.').catch(e => console.warn('Receipt email failed:', e));
    }

    refreshInvoices();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

/* ── Delete Invoice ── */
async function deleteInvoice(key) {
  if (!confirm('Delete this invoice?')) return;
  try {
    await fbRemove('/invoices/' + key);
    logActivity('invoice_deleted', 'Deleted invoice: ' + key, 'invoice');
    refreshInvoices();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

/* ── Send Invoice via Email ── */
async function sendInvoice() {
  const clientName = document.getElementById('inv-client-name').value;
  const clientEmail = document.getElementById('inv-client-email').value;
  if (!clientEmail) { alert('Client email is required'); return; }
  if (!clientName) { alert('Client name is required'); return; }

  const sendBtn = document.querySelector('[onclick="sendInvoice()"]');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending...'; }

  try {
    // Save first (no more dispatchEvent — proper await)
    const savedKey = await saveInvoiceData();
    editingInvoiceKey = savedKey;

    if (typeof sendBrandedEmail !== 'function') {
      alert('EmailJS not configured. Please set up EmailJS to send invoices.');
      return;
    }

    const total = parseFloat(document.getElementById('inv-total').textContent.replace(/[^0-9.]/g, '')) || 0;
    const dueDate = document.getElementById('inv-due-date').value;
    const invNumber = document.getElementById('inv-number').value;
    const paypalLink = getPayPalLink(total);

    // Build line items HTML for email
    let itemsHtml = '<table style="width:100%;border-collapse:collapse;font-size:14px;">' +
      '<tr style="background:#fff5f7;"><th style="padding:8px;text-align:left;border-bottom:2px solid #ff6b9d;">Description</th>' +
      '<th style="padding:8px;text-align:center;border-bottom:2px solid #ff6b9d;">Qty</th>' +
      '<th style="padding:8px;text-align:right;border-bottom:2px solid #ff6b9d;">Rate</th>' +
      '<th style="padding:8px;text-align:right;border-bottom:2px solid #ff6b9d;">Amount</th></tr>';
    invoiceItems.forEach(item => {
      itemsHtml += '<tr>' +
        '<td style="padding:8px;border-bottom:1px solid #eee;">' + (item.description || '\u2014') + '</td>' +
        '<td style="padding:8px;text-align:center;border-bottom:1px solid #eee;">' + (item.quantity || 0) + '</td>' +
        '<td style="padding:8px;text-align:right;border-bottom:1px solid #eee;">' + formatCurrency(item.unit_price || 0) + '</td>' +
        '<td style="padding:8px;text-align:right;border-bottom:1px solid #eee;">' + formatCurrency(item.amount || 0) + '</td>' +
      '</tr>';
    });
    itemsHtml += '</table>';

    // Build payment info HTML
    let paymentHtml = '<div style="margin-top:20px;padding:16px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">' +
      '<strong style="color:#166534;font-size:15px;">Payment Options</strong>' +
      '<div style="margin-top:10px;font-size:14px;color:#333;">' +
        '<p style="margin:6px 0;">&bull; <strong>Zelle:</strong> Send to <em>sanz.the.nanny@gmail.com</em></p>' +
        '<p style="margin:6px 0;">&bull; <strong>Cash:</strong> In person at time of service</p>' +
        '<p style="margin:6px 0;">&bull; <strong>Bank Transfer:</strong> Contact Sanz for bank details</p>';
    if (paypalLink !== '#') {
      paymentHtml += '<p style="margin:6px 0;">&bull; <strong>PayPal:</strong> <a href="' + paypalLink + '" style="color:#0070ba;">Click here to pay via PayPal</a></p>';
    } else {
      paymentHtml += '<p style="margin:6px 0;">&bull; <strong>PayPal:</strong> Coming soon</p>';
    }
    paymentHtml += '</div></div>';

    const subtotal = document.getElementById('inv-subtotal').textContent;
    const tax = document.getElementById('inv-tax').textContent;
    const notes = document.getElementById('inv-notes').value || '';

    const invoiceBody = '<p style="font-size:15px;color:#333;">Hi ' + clientName + ',</p>' +
      '<p style="color:#555;">Here is your invoice from Sanz the Nanny:</p>' +
      '<div style="background:#fff5f7;padding:14px;border-radius:8px;margin:16px 0;">' +
        '<table style="width:100%;font-size:14px;">' +
          '<tr><td style="font-weight:600;color:#c44569;">Invoice #</td><td>' + invNumber + '</td></tr>' +
          '<tr><td style="font-weight:600;color:#c44569;">Due Date</td><td>' + formatDate(dueDate) + '</td></tr>' +
        '</table>' +
      '</div>' +
      itemsHtml +
      '<table style="width:100%;font-size:14px;margin-top:12px;">' +
        '<tr><td style="text-align:right;padding:4px 8px;">Subtotal:</td><td style="text-align:right;padding:4px 8px;width:100px;">' + subtotal + '</td></tr>' +
        '<tr><td style="text-align:right;padding:4px 8px;">Tax:</td><td style="text-align:right;padding:4px 8px;">' + tax + '</td></tr>' +
        '<tr style="font-size:18px;font-weight:700;color:#c44569;"><td style="text-align:right;padding:8px;">Total:</td><td style="text-align:right;padding:8px;">' + formatCurrency(total) + '</td></tr>' +
      '</table>' +
      paymentHtml +
      (notes ? '<div style="margin-top:16px;padding:12px;background:#f9f9f9;border-radius:8px;"><strong>Notes:</strong> ' + notes + '</div>' : '');

    await sendBrandedEmail(clientEmail, 'Invoice ' + invNumber + ' from Sanz the Nanny', 'Invoice ' + invNumber, invoiceBody, 'Please remit payment by the due date. Thank you!');

    // Update invoice status to sent
    await fbUpdate('/invoices/' + savedKey, { status_sent: true, sent_at: new Date().toISOString() });

    alert('Invoice sent to ' + clientEmail + '!');
    logActivity('invoice_sent', 'Sent invoice ' + invNumber + ' to ' + clientName + ' (' + clientEmail + ')', 'invoice');
    closeInvoiceBuilder();
    refreshInvoices();
  } catch (err) {
    console.error('Send invoice error:', err);
    alert('Failed to send: ' + (err.text || err.message));
  } finally {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send to Client'; }
  }
}

/* ── Download Invoice PDF ── */
function downloadInvoicePDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const maxWidth = pageWidth - 2 * margin;
  let y = 20;

  // Header
  doc.setFillColor(255, 107, 157);
  doc.rect(0, 0, pageWidth, 35, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont(undefined, 'bold');
  doc.text('INVOICE', margin, 25);
  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');
  doc.text('#' + (document.getElementById('inv-number').value || '—'), pageWidth - margin, 25, { align: 'right' });

  y = 50;

  // From / To
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('From:', margin, y);
  doc.setFont(undefined, 'normal');
  doc.text('Sanskriti Chaulagain (Sanz)', margin, y + 6);
  doc.text('sanz.the.nanny@gmail.com', margin, y + 12);
  doc.text('Austin, TX', margin, y + 18);

  doc.setFont(undefined, 'bold');
  doc.text('To:', margin + 100, y);
  doc.setFont(undefined, 'normal');
  doc.text(document.getElementById('inv-client-name').value || '—', margin + 100, y + 6);
  doc.text(document.getElementById('inv-client-email').value || '—', margin + 100, y + 12);

  y += 30;
  doc.setFont(undefined, 'bold');
  doc.text('Due Date: ' + formatDate(document.getElementById('inv-due-date').value), margin, y);

  y += 15;

  // Line items table header
  doc.setFillColor(240, 230, 239);
  doc.rect(margin, y - 5, maxWidth, 10, 'F');
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(80, 60, 80);
  doc.text('Description', margin + 2, y);
  doc.text('Qty', margin + 100, y);
  doc.text('Rate', margin + 120, y);
  doc.text('Amount', margin + 145, y);
  y += 10;

  // Line items
  doc.setFont(undefined, 'normal');
  doc.setTextColor(60, 60, 60);
  invoiceItems.forEach(item => {
    doc.text(String(item.description || '—'), margin + 2, y);
    doc.text(String(item.quantity || 0), margin + 100, y);
    doc.text(formatCurrency(item.unit_price || 0), margin + 120, y);
    doc.text(formatCurrency(item.amount || 0), margin + 145, y);
    y += 8;
  });

  // Totals
  y += 5;
  doc.setDrawColor(200, 200, 200);
  doc.line(margin + 110, y, pageWidth - margin, y);
  y += 8;
  doc.setFontSize(10);
  doc.text('Subtotal:', margin + 110, y);
  doc.text(document.getElementById('inv-subtotal').textContent, margin + 155, y);
  y += 7;
  doc.text('Tax:', margin + 110, y);
  doc.text(document.getElementById('inv-tax').textContent, margin + 155, y);
  y += 10;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 107, 157);
  doc.text('Total:', margin + 110, y);
  doc.text(document.getElementById('inv-total').textContent, margin + 155, y);

  // PayPal link
  const total = parseFloat(document.getElementById('inv-total').textContent.replace('$', '')) || 0;
  if (total > 0 && !PAYPAL_ME.startsWith('__')) {
    y += 20;
    doc.setFontSize(10);
    doc.setTextColor(0, 112, 186);
    const paypalLink = getPayPalLink(total);
    doc.textWithLink('Pay via PayPal →', margin, y, { url: paypalLink });
  }

  // Notes
  const notes = document.getElementById('inv-notes').value;
  if (notes) {
    y += 20;
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(9);
    doc.setFont(undefined, 'italic');
    const noteLines = doc.splitTextToSize(notes, maxWidth);
    noteLines.forEach(line => {
      doc.text(line, margin, y);
      y += 5;
    });
  }

  const filename = 'Sanz-Invoice-' + (document.getElementById('inv-number').value || 'Draft') + '.pdf';
  doc.save(filename);
}
