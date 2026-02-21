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

function convertToClient(bookingKey) {
  const booking = bookingsCache.find(b => b._key === bookingKey);
  if (!booking) return;
  // Switch to clients tab and prefill form
  switchTab('clients');
  openNewClientForm();
  document.getElementById('cl-parent-name').value = booking.parent_name || '';
  document.getElementById('cl-email').value = booking.email || '';
  document.getElementById('cl-phone').value = booking.phone || '';
  if (booking.children && booking.children.length) {
    document.getElementById('cl-children').value = JSON.stringify(booking.children, null, 2);
  }
}
