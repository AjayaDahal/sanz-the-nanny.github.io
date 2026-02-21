/* ─────────────────────────────────────────────────
   calendar-admin.js — Admin calendar management
   ───────────────────────────────────────────────── */

let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let calEvents = [];
let calSelectedDay = null;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

async function refreshAdminCalendar() {
  if (!firebaseReady) return;
  await loadCalendarEvents();
  renderAdminCal();
}

async function loadCalendarEvents() {
  calEvents = [];
  try {
    // Load calendar events
    const evSnap = await fbOnce('/calendar_events/');
    const evData = evSnap.val() || {};
    Object.entries(evData).forEach(([k, v]) => calEvents.push({ _key: k, ...v }));

    // Also load accepted bookings as trial events
    const bkSnap = await fbOnce('/trial_bookings/');
    const bkData = bkSnap.val() || {};
    Object.entries(bkData).forEach(([k, v]) => {
      if (v.status === 'accepted' && v.selected_date) {
        calEvents.push({
          _key: 'booking-' + k,
          date: v.selected_date,
          title: 'Trial: ' + (v.parent_name || 'Unknown'),
          type: 'trial',
          start_time: v.preferred_time || '',
          end_time: '',
          notes: 'Children: ' + (v.children || []).map(c => c.name).join(', '),
          _source: 'booking'
        });
      }
    });

    // Load active client contract date ranges as "client" events
    const clSnap = await fbOnce('/clients/');
    const clData = clSnap.val() || {};
    Object.entries(clData).forEach(([k, v]) => {
      if (v.status === 'active' && v.contract_start) {
        const startDate = new Date(v.contract_start + 'T00:00:00');
        const endDate = v.contract_end ? new Date(v.contract_end + 'T00:00:00') : new Date(calYear, calMonth + 2, 0);
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
          const dateKey = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
          calEvents.push({
            _key: 'client-' + k + '-' + dateKey,
            date: dateKey,
            title: (v.family_name || v.parent_name || 'Client') + (v.availability_override ? ' (override)' : ''),
            type: v.availability_override ? 'override' : 'client',
            start_time: v.schedule || '',
            end_time: '',
            notes: (v.service_type || 'Nanny service') + (v.availability_override ? ' — trials allowed' : ''),
            _source: 'client'
          });
        }
      }
    });
  } catch (err) {
    console.warn('[Calendar] Load error:', err);
  }
}

function renderAdminCal() {
  const titleEl = document.getElementById('admin-cal-title');
  const daysEl = document.getElementById('admin-cal-days');
  titleEl.textContent = MONTHS[calMonth] + ' ' + calYear;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();

  let html = '';
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="admin-cal-day" style="opacity:0;"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = calYear + '-' + pad(calMonth + 1) + '-' + pad(d);
    const isToday = today.getFullYear() === calYear && today.getMonth() === calMonth && today.getDate() === d;
    const dayEvents = calEvents.filter(e => e.date === key);
    const hasTrials = dayEvents.some(e => e.type === 'trial');
    const hasSessions = dayEvents.some(e => e.type === 'session');
    const hasBlocked = dayEvents.some(e => e.type === 'blocked');
    const hasClient = dayEvents.some(e => e.type === 'client');
    const hasOverride = dayEvents.some(e => e.type === 'override');

    let cls = 'admin-cal-day';
    if (isToday) cls += ' today';
    if (dayEvents.length > 0) cls += ' has-events';

    let dots = '';
    if (hasTrials) dots += '<span class="event-dot trial"></span>';
    if (hasSessions) dots += '<span class="event-dot session"></span>';
    if (hasBlocked) dots += '<span class="event-dot blocked"></span>';
    if (hasClient) dots += '<span class="event-dot client"></span>';
    if (hasOverride) dots += '<span class="event-dot override"></span>';

    html += '<div class="' + cls + '" data-date="' + key + '" onclick="selectCalDay(\'' + key + '\')">' +
      '<span>' + d + '</span>' +
      (dots ? '<div class="event-dots">' + dots + '</div>' : '') +
      '</div>';
  }

  daysEl.innerHTML = html;
}

function selectCalDay(key) {
  calSelectedDay = key;
  const detailEl = document.getElementById('cal-day-details');
  const dayEvents = calEvents.filter(e => e.date === key);

  let html = '<h3>' + formatDate(key) + '</h3>';

  if (dayEvents.length === 0) {
    html += '<p style="color:var(--text-muted);padding:1rem 0;">No events for this day.</p>';
  } else {
    dayEvents.forEach(e => {
      const typeColors = { trial: 'var(--yellow)', session: 'var(--green)', blocked: 'var(--red)', client: 'var(--pink)', override: 'var(--blue)' };
      html += '<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border);">' +
        '<div style="width:8px;height:8px;border-radius:50%;background:' + (typeColors[e.type] || 'var(--pink)') + ';margin-top:6px;flex-shrink:0;"></div>' +
        '<div><strong>' + (e.title || e.type) + '</strong>' +
        (e.start_time ? '<br><span style="color:var(--text-muted);font-size:0.85rem;">' + e.start_time + (e.end_time ? ' – ' + e.end_time : '') + '</span>' : '') +
        (e.notes ? '<br><span style="color:var(--text-dim);font-size:0.85rem;">' + e.notes + '</span>' : '') +
        (e._source !== 'booking' && e._key ? '<br><button class="btn btn-danger btn-sm" style="margin-top:6px;" onclick="deleteCalEvent(\'' + e._key + '\')">Delete</button>' : '') +
        '</div></div>';
    });
  }

  detailEl.innerHTML = html;

  // Pre-fill the quick add form date
  document.getElementById('event-date').value = key;
}

/* ── Quick Add Event ── */
document.getElementById('quickEventForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  if (!firebaseReady) { alert('Firebase not connected'); return; }

  const eventData = {
    date: document.getElementById('event-date').value,
    type: document.getElementById('event-type').value,
    start_time: document.getElementById('event-start').value,
    end_time: document.getElementById('event-end').value,
    title: document.getElementById('event-title').value || document.getElementById('event-type').value,
    created_at: new Date().toISOString()
  };

  try {
    await fbPush('/calendar_events', eventData);
    logActivity('event_created', 'Added calendar event: ' + eventData.title + ' on ' + eventData.date, 'calendar');
    this.reset();
    resetTimePicker('tp-start');
    resetTimePicker('tp-end');
    await refreshAdminCalendar();
    if (calSelectedDay) selectCalDay(calSelectedDay);
  } catch (err) {
    alert('Failed to add event: ' + err.message);
  }
});

async function deleteCalEvent(key) {
  if (!confirm('Delete this event?')) return;
  try {
    await fbRemove('/calendar_events/' + key);
    logActivity('event_deleted', 'Deleted calendar event: ' + key, 'calendar');
    await refreshAdminCalendar();
    if (calSelectedDay) selectCalDay(calSelectedDay);
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

/* ── Set Availability (bulk) ── */
async function setAvailability() {
  if (!firebaseReady) { alert('Firebase not connected'); return; }
  const from = document.getElementById('avail-from').value;
  const to = document.getElementById('avail-to').value;
  const slotsStr = document.getElementById('avail-slots').value;

  if (!from || !to) { alert('Please set date range'); return; }

  const slots = slotsStr.split(',').map(s => s.trim()).filter(Boolean);
  if (slots.length === 0) slots.push('Flexible');

  const fromDate = new Date(from + 'T00:00:00');
  const toDate = new Date(to + 'T00:00:00');
  const updates = {};

  for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
    const key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    updates[key] = { slots: slots, updated_at: new Date().toISOString() };
  }

  try {
    await fbUpdate('/availability', updates);
    logActivity('availability_set', 'Set availability from ' + from + ' to ' + to, 'calendar');
    alert('Availability saved! These dates will show as available on the public booking calendar.');
    document.getElementById('avail-from').value = '';
    document.getElementById('avail-to').value = '';
    document.getElementById('avail-slots').value = '';
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
}

/* ── Nav ── */
document.getElementById('admin-cal-prev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderAdminCal();
});
document.getElementById('admin-cal-next').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderAdminCal();
});

/* ═══════════════ CLICKABLE TIME PICKER ═══════════════ */

function initTimePickers() {
  document.querySelectorAll('.time-picker').forEach(picker => {
    const hourScroll = picker.querySelector('[data-type="hour"]');
    const minScroll = picker.querySelector('[data-type="min"]');
    const ampmScroll = picker.querySelector('[data-type="ampm"]');
    if (!hourScroll || !minScroll || !ampmScroll) return;

    // Hours 1-12
    hourScroll.innerHTML = '';
    for (let h = 1; h <= 12; h++) {
      const opt = document.createElement('div');
      opt.className = 'tp-opt' + (h === 9 ? ' selected' : '');
      opt.textContent = h;
      opt.dataset.val = h;
      opt.onclick = function () { selectOpt(hourScroll, this); };
      hourScroll.appendChild(opt);
    }

    // Minutes 00-55 in 5-min steps
    minScroll.innerHTML = '';
    for (let m = 0; m < 60; m += 5) {
      const opt = document.createElement('div');
      opt.className = 'tp-opt' + (m === 0 ? ' selected' : '');
      opt.textContent = m < 10 ? '0' + m : m;
      opt.dataset.val = m;
      opt.onclick = function () { selectOpt(minScroll, this); };
      minScroll.appendChild(opt);
    }

    // AM / PM
    ampmScroll.innerHTML = '';
    ['AM', 'PM'].forEach((label, i) => {
      const opt = document.createElement('div');
      opt.className = 'tp-opt' + (i === 0 ? ' selected' : '');
      opt.textContent = label;
      opt.dataset.val = label;
      opt.onclick = function () { selectOpt(ampmScroll, this); };
      ampmScroll.appendChild(opt);
    });
  });
}

function selectOpt(container, el) {
  container.querySelectorAll('.tp-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

function toggleTimePicker(id) {
  const picker = document.getElementById(id);
  const dropdown = picker.querySelector('.tp-dropdown');
  const isOpen = dropdown.classList.contains('open');
  // Close all others
  document.querySelectorAll('.tp-dropdown.open').forEach(d => d.classList.remove('open'));
  if (!isOpen) {
    dropdown.classList.add('open');
    // Scroll selected into view
    dropdown.querySelectorAll('.tp-opt.selected').forEach(opt => {
      opt.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
  }
}

function closeTimePicker(id) {
  document.getElementById(id).querySelector('.tp-dropdown').classList.remove('open');
}

function resetTimePicker(id) {
  const picker = document.getElementById(id);
  if (!picker) return;
  picker.querySelector('input[type="hidden"]').value = '';
  const valueSpan = picker.querySelector('.tp-value');
  valueSpan.textContent = 'Select time';
  valueSpan.classList.remove('has-time');
  // Reset to defaults (9:00 AM)
  initTimePickers();
}

function confirmTimePicker(id) {
  const picker = document.getElementById(id);
  const hour = picker.querySelector('[data-type="hour"] .tp-opt.selected');
  const min = picker.querySelector('[data-type="min"] .tp-opt.selected');
  const ampm = picker.querySelector('[data-type="ampm"] .tp-opt.selected');

  if (!hour || !min || !ampm) { alert('Please select hour, minute, and AM/PM'); return; }

  const h = parseInt(hour.dataset.val);
  const m = parseInt(min.dataset.val);
  const period = ampm.dataset.val;

  // Display value (12h format)
  const displayH = h;
  const displayM = m < 10 ? '0' + m : '' + m;
  const display = displayH + ':' + displayM + ' ' + period;

  // 24h value for hidden input
  let h24 = h;
  if (period === 'AM' && h === 12) h24 = 0;
  else if (period === 'PM' && h !== 12) h24 += 12;
  const val24 = (h24 < 10 ? '0' + h24 : '' + h24) + ':' + displayM;

  const hiddenInput = picker.querySelector('input[type="hidden"]');
  hiddenInput.value = val24;

  const valueSpan = picker.querySelector('.tp-value');
  valueSpan.textContent = display;
  valueSpan.classList.add('has-time');

  closeTimePicker(id);
}

// Close time picker when clicking outside
document.addEventListener('click', function (e) {
  if (!e.target.closest('.time-picker')) {
    document.querySelectorAll('.tp-dropdown.open').forEach(d => d.classList.remove('open'));
  }
});

// Initialize on load
document.addEventListener('DOMContentLoaded', initTimePickers);
// Also init after a brief delay in case DOM isn't ready
setTimeout(initTimePickers, 500);
