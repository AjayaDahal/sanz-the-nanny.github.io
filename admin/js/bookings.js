/* ─────────────────────────────────────────────────
   bookings.js — Trial booking management
   ───────────────────────────────────────────────── */

let bookingsCache = [];

async function refreshBookings(filter) {
  filter = filter || 'all';
  const container = document.getElementById('bookings-list');
  container.className = 'loading';
  container.textContent = 'Loading bookings...';
  if (!firebaseReady) { container.className = ''; container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Firebase not connected</p></div>'; return; }

  try {
    const snap = await fbOnce('/trial_bookings/');
    const data = snap.val() || {};
    bookingsCache = Object.entries(data).map(([k, v]) => ({ _key: k, ...v }));
    bookingsCache.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    let filtered = bookingsCache;
    if (filter !== 'all') filtered = bookingsCache.filter(b => b.status === filter);

    container.className = '';
    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No ' + (filter === 'all' ? '' : filter + ' ') + 'bookings found</p></div>';
      return;
    }

    let html = '';
    filtered.forEach(b => {
      const badgeCls = b.status === 'pending' ? 'badge-pending' : b.status === 'accepted' ? 'badge-accepted' : 'badge-declined';
      const children = (b.children || []).map(c => c.name + (c.age ? ' (age ' + c.age + ')' : '')).join(', ') || '—';

      html += '<div class="booking-card">' +
        '<div class="booking-card-header">' +
          '<h4>' + (b.parent_name || 'Unknown') + '</h4>' +
          '<span class="badge ' + badgeCls + '">' + (b.status || 'pending') + '</span>' +
        '</div>' +
        '<div class="booking-card-details">' +
          '<div><strong>Date:</strong> ' + formatDate(b.selected_date) + '</div>' +
          '<div><strong>Time:</strong> ' + (b.preferred_time || '—') + '</div>' +
          '<div><strong>Email:</strong> ' + (b.email || '—') + '</div>' +
          '<div><strong>Phone:</strong> ' + (b.phone || '—') + '</div>' +
          '<div><strong>Children:</strong> ' + children + '</div>' +
          '<div><strong>Submitted:</strong> ' + formatDateTime(b.created_at) + '</div>' +
          (b.notes ? '<div style="grid-column:1/-1;"><strong>Notes:</strong> ' + b.notes + '</div>' : '') +
        '</div>';

      if (b.status === 'pending') {
        html += '<div class="booking-card-actions"><div class="btn-group">' +
          '<button class="btn btn-success btn-sm" onclick="acceptBooking(\'' + b._key + '\')">✓ Accept</button>' +
          '<button class="btn btn-danger btn-sm" onclick="declineBooking(\'' + b._key + '\')">✗ Decline</button>' +
          '<button class="btn btn-outline btn-sm" onclick="convertToClient(\'' + b._key + '\')">→ Add as Client</button>' +
          '</div></div>';
      } else if (b.status === 'accepted') {
        html += '<div class="booking-card-actions"><div class="btn-group">' +
          '<button class="btn btn-outline btn-sm" onclick="convertToClient(\'' + b._key + '\')">→ Add as Client</button>' +
          '<button class="btn btn-danger btn-sm" onclick="cancelBooking(\'' + b._key + '\')">✗ Cancel</button>' +
          '</div></div>';
      } else if (b.status === 'declined' || b.status === 'cancelled') {
        html += '<div class="booking-card-actions"><div class="btn-group">' +
          '<button class="btn btn-outline btn-sm" onclick="deleteBooking(\'' + b._key + '\')">🗑️ Delete</button>' +
          '</div></div>';
      }

      html += '</div>';
    });

    container.innerHTML = html;
  } catch (err) {
    console.warn('[Bookings] Error:', err);
    container.className = '';
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>Error loading bookings</p></div>';
  }
}

async function acceptBooking(key) {
  if (!firebaseReady) return;
  try {
    await fbUpdate('/trial_bookings/' + key, { status: 'accepted', updated_at: new Date().toISOString() });
    logActivity('booking_accepted', 'Accepted trial booking: ' + key, 'booking');

    // Send confirmation email via branded email
    const snap = await fbOnce('/trial_bookings/' + key);
    const booking = snap.val();
    if (booking && booking.email && typeof sendBrandedEmail === 'function') {
      const body = '<p style="font-size:15px;color:#333;">Hi ' + (booking.parent_name || '') + ',</p>' +
        '<p style="color:#555;">Great news! Your trial session has been <strong style="color:#4caf50;">confirmed</strong>! 🎉</p>' +
        '<div style="background:#fff5f7;padding:16px;border-radius:8px;margin:16px 0;">' +
          '<p style="margin:4px 0;"><strong>Date:</strong> ' + (booking.selected_date || '—') + '</p>' +
          '<p style="margin:4px 0;"><strong>Time:</strong> ' + (booking.preferred_time || '—') + '</p>' +
        '</div>' +
        '<p style="color:#555;">Looking forward to meeting your family!</p>' +
        '<p style="color:#c44569;font-weight:600;">&mdash; Sanz</p>';
      sendBrandedEmail(booking.email, 'Trial Session Confirmed! - Sanz the Nanny', 'Session Confirmed! ✅', body, 'If you need to reschedule, please reply to this email.').catch(e => console.warn('Email send failed:', e));
    }

    refreshBookings();
  } catch (err) {
    console.error('Accept booking error:', err);
    alert('Failed to accept booking: ' + err.message);
  }
}

async function declineBooking(key) {
  const reason = prompt('Reason for declining (optional):');
  if (reason === null) return; // cancelled
  try {
    await fbUpdate('/trial_bookings/' + key, {
      status: 'declined',
      decline_reason: reason || '',
      updated_at: new Date().toISOString()
    });
    logActivity('booking_declined', 'Declined trial booking: ' + key, 'booking');

    // Send decline email via branded email
    const snap = await fbOnce('/trial_bookings/' + key);
    const booking = snap.val();
    if (booking && booking.email && typeof sendBrandedEmail === 'function') {
      const declineMsg = reason ? 'Unfortunately, this time slot is not available. Reason: ' + reason : 'Unfortunately, this time slot is not available. Please try another date.';
      const body = '<p style="font-size:15px;color:#333;">Hi ' + (booking.parent_name || '') + ',</p>' +
        '<p style="color:#555;">' + declineMsg + '</p>' +
        '<div style="background:#fff5f7;padding:16px;border-radius:8px;margin:16px 0;">' +
          '<p style="margin:4px 0;"><strong>Requested Date:</strong> ' + (booking.selected_date || '—') + '</p>' +
          '<p style="margin:4px 0;"><strong>Requested Time:</strong> ' + (booking.preferred_time || '—') + '</p>' +
        '</div>' +
        '<p style="color:#555;">Please feel free to request a different date — I\'d love to find a time that works for your family!</p>' +
        '<p style="color:#c44569;font-weight:600;">&mdash; Sanz</p>';
      sendBrandedEmail(booking.email, 'Booking Update - Sanz the Nanny', 'Booking Update', body, 'Reply to this email if you\'d like to try another date.').catch(e => console.warn('Email send failed:', e));
    }

    refreshBookings();
  } catch (err) {
    console.error('Decline booking error:', err);
    alert('Failed to decline booking: ' + err.message);
  }
}

async function cancelBooking(key) {
  const reason = prompt('Reason for cancelling (optional):');
  if (reason === null) return; // user pressed Cancel on prompt
  try {
    await fbUpdate('/trial_bookings/' + key, {
      status: 'cancelled',
      cancel_reason: reason || '',
      updated_at: new Date().toISOString()
    });
    logActivity('booking_cancelled', 'Cancelled trial booking: ' + key, 'booking');

    // Send cancellation email
    const snap = await fbOnce('/trial_bookings/' + key);
    const booking = snap.val();
    if (booking && booking.email && typeof sendBrandedEmail === 'function') {
      const body = '<p style="font-size:15px;color:#333;">Hi ' + (booking.parent_name || '') + ',</p>' +
        '<p style="color:#555;">Unfortunately, your trial session has been <strong style="color:#e53935;">cancelled</strong>.</p>' +
        '<div style="background:#fff5f7;padding:16px;border-radius:8px;margin:16px 0;">' +
          '<p style="margin:4px 0;"><strong>Date:</strong> ' + (booking.selected_date || '—') + '</p>' +
          '<p style="margin:4px 0;"><strong>Time:</strong> ' + (booking.preferred_time || '—') + '</p>' +
          (reason ? '<p style="margin:4px 0;"><strong>Reason:</strong> ' + reason + '</p>' : '') +
        '</div>' +
        '<p style="color:#555;">I apologize for the inconvenience. Please feel free to book another trial session at a time that works for you!</p>' +
        '<p style="color:#c44569;font-weight:600;">&mdash; Sanz</p>';
      sendBrandedEmail(booking.email, 'Trial Session Cancelled - Sanz the Nanny', 'Session Cancelled', body, 'Reply to this email to reschedule.').catch(e => console.warn('Cancel email failed:', e));
    }

    refreshBookings();
  } catch (err) {
    console.error('Cancel booking error:', err);
    alert('Failed to cancel booking: ' + err.message);
  }
}

async function deleteBooking(key) {
  if (!confirm('Delete this booking permanently? This cannot be undone.')) return;
  try {
    await fbRemove('/trial_bookings/' + key);
    logActivity('booking_deleted', 'Deleted trial booking: ' + key, 'booking');
    refreshBookings();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

async function convertToClient(bookingKey) {
  const booking = bookingsCache.find(b => b._key === bookingKey);
  if (!booking) { alert('Booking not found. Please refresh and try again.'); return; }
  if (!firebaseReady) { alert('Firebase not connected'); return; }
  if (!confirm('Add "' + (booking.parent_name || 'this family') + '" as a client?')) return;

  try {
    // Build children array
    const children = (booking.children || []).map(c => ({
      name: c.name || '', age: c.age || '', allergies: c.allergies || '', notes: c.notes || ''
    }));

    // Create client record directly
    const clientData = {
      family_name: booking.parent_name || '',
      parent_name: booking.parent_name || '',
      email: booking.email || '',
      phone: booking.phone || '',
      children: children,
      notes: 'Converted from trial booking on ' + (booking.selected_date || '—') +
        (booking.notes ? '. Notes: ' + booking.notes : ''),
      status: 'active',
      source: 'trial_booking',
      created_at: new Date().toISOString()
    };
    await fbPush('/clients', clientData);

    // Mark booking as converted
    await fbUpdate('/trial_bookings/' + bookingKey, {
      status: 'accepted',
      converted_to_client: true,
      updated_at: new Date().toISOString()
    });

    logActivity('client_created', 'Created client from trial booking: ' + (booking.parent_name || ''), 'client');

    alert('✅ ' + (booking.parent_name || 'Family') + ' has been added as a client!');

    // Navigate to clients tab
    switchTab('clients');
  } catch (err) {
    console.error('[Bookings] Convert to client error:', err);
    alert('Failed to create client: ' + err.message);
  }
}

/* ── Trial Availability Toggle ── */
async function loadTrialToggleState() {
  try {
    const snap = await fbOnce('/settings/trial_bookings_enabled');
    const enabled = snap.val() !== false; // default to true if not set
    const toggle = document.getElementById('trial-enabled-toggle');
    const label = document.getElementById('trial-toggle-label');
    if (toggle) toggle.checked = enabled;
    if (label) label.innerHTML = 'Trial bookings: <strong style="color:' + (enabled ? 'var(--green,#2ecc71)' : 'var(--red,#e74c3c)') + '">' + (enabled ? 'Enabled' : 'Disabled') + '</strong>';
  } catch (e) {
    console.warn('[Bookings] Could not load trial toggle state:', e);
  }
}

async function toggleTrialAvailability(enabled) {
  if (!firebaseReady) { alert('Firebase not connected'); return; }
  try {
    await fbSet('/settings/trial_bookings_enabled', enabled);
    const label = document.getElementById('trial-toggle-label');
    if (label) label.innerHTML = 'Trial bookings: <strong style="color:' + (enabled ? 'var(--green,#2ecc71)' : 'var(--red,#e74c3c)') + '">' + (enabled ? 'Enabled' : 'Disabled') + '</strong>';
    logActivity('settings_updated', 'Trial bookings ' + (enabled ? 'enabled' : 'disabled'), 'settings');
  } catch (err) {
    alert('Failed to update setting: ' + err.message);
    // Revert toggle
    const toggle = document.getElementById('trial-enabled-toggle');
    if (toggle) toggle.checked = !enabled;
  }
}
