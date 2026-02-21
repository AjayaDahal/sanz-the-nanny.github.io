/* ─────────────────────────────────────────────────
   Booking Calendar — Sanz the Nanny
   Interactive calendar for trial session booking.
   Reads availability from Firebase RTDB, writes
   bookings back. Falls back gracefully if Firebase
   is not configured (all dates show as available).
   ───────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── State ── */
  let currentMonth = new Date().getMonth();
  let currentYear = new Date().getFullYear();
  let selectedDate = null;
  let availabilityCache = {};   // { 'YYYY-MM-DD': { slots: [...] } }
  let bookedDatesCache = {};    // { 'YYYY-MM-DD': true }
  let clientBlockedDates = {};  // { 'YYYY-MM-DD': true } — days an active client is under contract
  let childCount = 1;

  /* ── DOM refs ── */
  const calDays = document.getElementById('cal-days');
  const calMonthYear = document.getElementById('cal-month-year');
  const calPrev = document.getElementById('cal-prev');
  const calNext = document.getElementById('cal-next');
  const selectedDateText = document.getElementById('selectedDateText');
  const selectedDateInput = document.getElementById('selectedDateInput');
  const trialForm = document.getElementById('trialBookingForm');
  const trialStatus = document.getElementById('trial-form-status');
  const addChildBtn = document.getElementById('addChildBtn');
  const childrenFields = document.getElementById('children-fields');

  if (!calDays) return; // Section not on page

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  /* ── Helpers ── */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dateKey(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function isToday(y, m, d) {
    const t = new Date();
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  }
  function isPast(y, m, d) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return new Date(y, m, d) < t;
  }
  function formatDateNice(dateStr) {
    const [y, mo, da] = dateStr.split('-').map(Number);
    const d = new Date(y, mo - 1, da);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  /* ── Load availability from Firebase ── */
  async function loadMonthData(year, month) {
    if (!firebaseReady) return; // graceful fallback — all dates available
    try {
      // Load availability for this month
      const prefix = year + '-' + pad(month + 1);
      const availSnap = await fbOnce('/availability/', 8000);
      const availData = availSnap.val() || {};
      Object.entries(availData).forEach(([dateStr, data]) => {
        availabilityCache[dateStr] = data;
      });

      // Load booked dates for this month
      const bookingsSnap = await fbOnce('/trial_bookings/', 8000);
      const bookings = bookingsSnap.val() || {};
      Object.values(bookings).forEach(booking => {
        if (booking.selected_date && booking.status !== 'declined') {
          bookedDatesCache[booking.selected_date] = true;
        }
      });

      // Load blocked dates (synced by admin when clients are saved)
      try {
        const blockedSnap = await fbOnce('/blocked_dates/', 8000);
        clientBlockedDates = blockedSnap.val() || {};
      } catch (blockedErr) {
        console.warn('Could not load blocked dates:', blockedErr.message);
      }
    } catch (err) {
      console.warn('Could not load calendar data:', err.message);
    }
  }

  /* ── Render calendar ── */
  async function renderCalendar() {
    calMonthYear.textContent = MONTHS[currentMonth] + ' ' + currentYear;
    calDays.innerHTML = '<div class="cal-loading" style="grid-column:1/-1;text-align:center;padding:20px;color:#999;">Loading...</div>';

    await loadMonthData(currentYear, currentMonth);

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    let html = '';

    // Day-of-week labels (generated in JS to avoid display:contents — Safari compat)
    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 0; i < 7; i++) {
      html += '<div class="cal-day-label">' + DAY_LABELS[i] + '</div>';
    }

    // Empty cells before day 1
    for (let i = 0; i < firstDay; i++) {
      html += '<div class="cal-day empty"></div>';
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const key = dateKey(currentYear, currentMonth, d);
      const past = isPast(currentYear, currentMonth, d);
      const today = isToday(currentYear, currentMonth, d);
      const isBooked = bookedDatesCache[key];
      const isClientBlocked = clientBlockedDates[key];
      const isSelected = selectedDate === key;
      const hasAvailability = availabilityCache[key];

      let cls = 'cal-day';
      if (past) {
        cls += ' past';
      } else if (isSelected) {
        cls += ' selected';
      } else if (isBooked) {
        cls += ' booked';
      } else if (isClientBlocked) {
        cls += ' booked'; // show as booked/unavailable when an active client has this date
      } else {
        // If Firebase has availability data, check it. Otherwise default to available for future dates.
        if (firebaseReady && Object.keys(availabilityCache).length > 0) {
          cls += hasAvailability ? ' available' : ' past';
        } else {
          cls += ' available';
        }
      }
      if (today) cls += ' today';

      html += '<div class="' + cls + '" data-date="' + key + '">' + d + '</div>';
    }

    calDays.innerHTML = html;

    // Bind click events on available days
    calDays.querySelectorAll('.cal-day.available, .cal-day.selected').forEach(el => {
      el.addEventListener('click', function () {
        selectDate(this.dataset.date);
      });
    });
  }

  function selectDate(key) {
    selectedDate = key;
    selectedDateText.textContent = '📅 ' + formatDateNice(key);
    selectedDateInput.value = key;
    document.querySelector('.selected-date-display').classList.add('has-date');
    renderCalendar(); // re-render to update visual
  }

  /* ── Navigation ── */
  calPrev.addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
  });

  calNext.addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar();
  });

  /* ── Add child fields ── */
  addChildBtn.addEventListener('click', () => {
    childCount++;
    if (childCount > 6) return;
    const row = document.createElement('div');
    row.className = 'child-row';
    row.innerHTML = '<input type="text" name="child_name_' + childCount + '" placeholder="Child\'s Name" required>' +
      '<input type="number" name="child_age_' + childCount + '" placeholder="Age" min="0" max="17">';
    childrenFields.appendChild(row);
    if (childCount >= 6) addChildBtn.style.display = 'none';
  });

  /* ── Form submission ── */
  if (trialForm) {
    trialForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      if (!selectedDate) {
        trialStatus.textContent = '⚠️ Please select a date from the calendar first.';
        trialStatus.className = 'form-status error';
        return;
      }

      const btn = trialForm.querySelector('.trial-submit');
      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Submitting...';

      // Gather children data
      const children = [];
      for (let i = 1; i <= childCount; i++) {
        const name = trialForm.querySelector('[name="child_name_' + i + '"]');
        const age = trialForm.querySelector('[name="child_age_' + i + '"]');
        if (name && name.value) {
          children.push({ name: name.value, age: age ? age.value : '' });
        }
      }

      const bookingData = {
        parent_name: trialForm.parent_name.value,
        email: trialForm.email.value,
        phone: trialForm.phone.value,
        children: children,
        selected_date: selectedDate,
        preferred_time: trialForm.preferred_time.value,
        notes: trialForm.notes.value || '',
        status: 'pending',
        created_at: new Date().toISOString()
      };

      try {
        // Save to Firebase RTDB
        if (firebaseReady) {
          await fbPush('/trial_bookings', bookingData);

          // Auto-create client from trial booking
          await fbPush('/clients', {
            family_name: bookingData.parent_name,
            parent_name: bookingData.parent_name,
            email: bookingData.email,
            phone: bookingData.phone,
            children: children,
            notes: 'Auto-created from trial booking on ' + bookingData.selected_date,
            status: 'active',
            source: 'trial_booking',
            created_at: new Date().toISOString()
          });
        }

        // Send notification email to admin via EmailJS
        if (typeof sendBrandedEmail === 'function') {
          const childrenInfo = children.map(c => c.name + (c.age ? ' (age ' + c.age + ')' : '')).join(', ');
          const niceDate = formatDateNice(selectedDate);

          // Admin notification
          const adminBody = '<p style="font-size:15px;color:#333;">Hi Sanz,</p>' +
            '<p style="color:#555;">A new trial booking request has been submitted:</p>' +
            '<table style="width:100%;font-size:14px;margin:16px 0;">' +
              '<tr><td style="padding:6px 12px;font-weight:600;color:#c44569;width:100px;">Parent</td><td style="padding:6px 12px;">' + bookingData.parent_name + '</td></tr>' +
              '<tr style="background:#fff5f7;"><td style="padding:6px 12px;font-weight:600;color:#c44569;">Email</td><td style="padding:6px 12px;"><a href="mailto:' + bookingData.email + '">' + bookingData.email + '</a></td></tr>' +
              '<tr><td style="padding:6px 12px;font-weight:600;color:#c44569;">Phone</td><td style="padding:6px 12px;">' + bookingData.phone + '</td></tr>' +
              '<tr style="background:#fff5f7;"><td style="padding:6px 12px;font-weight:600;color:#c44569;">Date</td><td style="padding:6px 12px;">' + niceDate + '</td></tr>' +
              '<tr><td style="padding:6px 12px;font-weight:600;color:#c44569;">Time</td><td style="padding:6px 12px;">' + bookingData.preferred_time + '</td></tr>' +
              '<tr style="background:#fff5f7;"><td style="padding:6px 12px;font-weight:600;color:#c44569;">Children</td><td style="padding:6px 12px;">' + childrenInfo + '</td></tr>' +
              '<tr><td style="padding:6px 12px;font-weight:600;color:#c44569;">Notes</td><td style="padding:6px 12px;">' + (bookingData.notes || 'None') + '</td></tr>' +
            '</table>';
          await sendBrandedEmail('sanz.the.nanny@gmail.com', 'New Trial Booking - ' + bookingData.parent_name, 'New Trial Booking', adminBody, null, bookingData.email);

          // Auto-reply to parent
          const replyBody = '<p style="font-size:15px;color:#333;">Hi ' + bookingData.parent_name + ',</p>' +
            '<p style="color:#555;">Thank you for requesting a trial session! Here are the details I received:</p>' +
            '<div style="background:#fff5f7;padding:16px;border-radius:8px;margin:16px 0;">' +
              '<p style="margin:4px 0;"><strong>Date:</strong> ' + niceDate + '</p>' +
              '<p style="margin:4px 0;"><strong>Time:</strong> ' + bookingData.preferred_time + '</p>' +
              '<p style="margin:4px 0;"><strong>Children:</strong> ' + childrenInfo + '</p>' +
            '</div>' +
            '<p style="color:#555;">I\'ll review your request and confirm your booking soon. Looking forward to meeting your family!</p>' +
            '<p style="color:#c44569;font-weight:600;">&mdash; Sanz</p>';
          sendBrandedEmail(bookingData.email, 'Trial Booking Received! - Sanz the Nanny', 'Booking Received!', replyBody, 'This is an automated confirmation. Sanz will follow up shortly.').catch(e => console.warn('Booking auto-reply failed:', e));
        }

        trialStatus.textContent = '✓ Trial session requested! Sanz will review and confirm your booking soon. Check your email!';
        trialStatus.className = 'form-status success';
        trialForm.reset();
        selectedDate = null;
        selectedDateText.textContent = 'Please select a date from the calendar';
        selectedDateInput.value = '';
        document.querySelector('.selected-date-display').classList.remove('has-date');
        childCount = 1;
        childrenFields.innerHTML = '<div class="child-row"><input type="text" name="child_name_1" placeholder="Child\'s Name *" required><input type="number" name="child_age_1" placeholder="Age" min="0" max="17"></div>';
        renderCalendar();

        setTimeout(() => { trialStatus.textContent = ''; trialStatus.className = 'form-status'; }, 8000);
      } catch (err) {
        console.error('Booking error:', err);
        trialStatus.textContent = '✗ Could not submit booking. Please try again or contact Sanz directly.';
        trialStatus.className = 'form-status error';
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
  }

  /* ── Init ── */
  // Wait for Firebase to be ready (if available), then render
  if (typeof initFirebase === 'function') {
    initFirebase();
  }

  // Check if trial bookings are enabled
  checkTrialAvailability();

  async function checkTrialAvailability() {
    try {
      if (!firebaseReady) {
        // If Firebase isn't ready yet, wait and retry
        await new Promise(function(resolve) {
          var tries = 0;
          var iv = setInterval(function() {
            tries++;
            if (firebaseReady || tries > 20) { clearInterval(iv); resolve(); }
          }, 500);
        });
      }
      if (firebaseReady) {
        var snap = await fbOnce('/settings/trial_bookings_enabled');
        var enabled = snap.val();
        if (enabled === false) {
          // Trial bookings disabled by admin
          var banner = document.getElementById('trial-unavailable');
          var content = document.getElementById('trial-content-wrap');
          var subtitle = document.querySelector('.trial-subtitle');
          if (banner) banner.style.display = 'block';
          if (content) content.style.display = 'none';
          if (subtitle) subtitle.style.display = 'none';
          return; // Don't render the calendar
        }
      }
    } catch (e) {
      console.warn('[Booking] Could not check trial availability:', e.message);
    }
    renderCalendar();
  }

})();
