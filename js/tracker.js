/* ─────────────────────────────────────────────────
   Site Analytics Tracker — Sanz the Nanny
   Writes pageViews, sessions, presence, scroll depth,
   and performance metrics to Firebase RTDB.
   Pattern adapted from magnetmomentsco tracker.
   ───────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── Skip bots & admin ── */
  if (navigator.userAgent.match(/bot|crawl|spider|slurp|facebookexternalhit|prerender/i)) return;

  /* ── Wait for Firebase ── */
  function waitForFirebase(cb, tries) {
    tries = tries || 0;
    // Self-initialise Firebase if available but not yet ready
    if (!firebaseReady && typeof initFirebase === 'function') {
      initFirebase();
    }
    if (typeof firebaseReady !== 'undefined' && firebaseReady && typeof fbRef === 'function') { cb(); return; }
    if (tries > 20) { console.warn('[Tracker] Firebase not available after 10 s — tracking disabled'); return; }
    setTimeout(function () { waitForFirebase(cb, tries + 1); }, 500);
  }

  waitForFirebase(function () {
    const now = new Date();
    const dateStr = now.getFullYear() + '-' +
      (now.getMonth() + 1 < 10 ? '0' : '') + (now.getMonth() + 1) + '-' +
      (now.getDate() < 10 ? '0' : '') + now.getDate();

    /* ── Session & visitor IDs ── */
    function uid() { return Math.random().toString(36).substring(2, 10) + Date.now().toString(36); }

    let visitorId = localStorage.getItem('sanz_vid');
    if (!visitorId) { visitorId = uid(); localStorage.setItem('sanz_vid', visitorId); }

    let sessionId = sessionStorage.getItem('sanz_sid');
    let isNewSession = false;
    if (!sessionId) { sessionId = uid(); sessionStorage.setItem('sanz_sid', sessionId); isNewSession = true; }

    /* ── Device detection ── */
    const ua = navigator.userAgent;
    const device = /Mobi|Android/i.test(ua) ? 'mobile' : /Tablet|iPad/i.test(ua) ? 'tablet' : 'desktop';

    /* ── Current page slug ── */
    const slug = location.pathname.replace(/\/$/, '').split('/').pop() || 'index';

    /* ── Referrer ── */
    const referrer = document.referrer || 'Direct';
    let source = 'direct';
    if (referrer !== 'Direct') {
      try {
        const h = new URL(referrer).hostname;
        if (h.includes('google')) source = 'google';
        else if (h.includes('facebook') || h.includes('fb.')) source = 'facebook';
        else if (h.includes('instagram')) source = 'instagram';
        else if (h.includes('twitter') || h.includes('x.com')) source = 'twitter';
        else if (h.includes('linkedin')) source = 'linkedin';
        else if (h.includes('tiktok')) source = 'tiktok';
        else source = 'referral';
      } catch (e) { source = 'referral'; }
    }
    // Check UTM params
    const params = new URLSearchParams(location.search);
    if (params.get('utm_source')) source = params.get('utm_source');

    /* ── 1. Page View ── */
    var pvRef = fbRef('/site_analytics/pageViews/' + dateStr + '/' + slug);
    if (pvRef) {
      pvRef.push({
        timestamp: Date.now(),
        sessionId: sessionId,
        visitorId: visitorId,
        referrer: referrer,
        source: source,
        device: device
      }).then(function () {
        console.log('[Tracker] ✓ pageView written — ' + slug);
      }).catch(function (err) {
        console.error('[Tracker] ✗ pageView write failed:', err.message || err);
      });
    }

    /* ── 2. Session tracking ── */
    const sessionRef = fbRef('/site_analytics/sessions/' + dateStr + '/' + sessionId);
    if (!sessionRef) { console.warn('[Tracker] Firebase ref unavailable for sessions'); }
    if (sessionRef && isNewSession) {
      sessionRef.set({
        visitorId: visitorId,
        device: device,
        referrer: referrer,
        source: source,
        pages: 1,
        duration: 0,
        startedAt: Date.now(),
        lastActivity: Date.now()
      }).catch(function (err) { console.error('[Tracker] session write failed:', err.message); });
    } else if (sessionRef) {
      sessionRef.once('value').then(function (snap) {
        const data = snap.val();
        if (data) {
          sessionRef.update({
            pages: (data.pages || 0) + 1,
            lastActivity: Date.now(),
            duration: Math.round((Date.now() - (data.startedAt || Date.now())) / 1000)
          });
        }
      });
    }

    // Update duration periodically
    setInterval(function () {
      sessionRef.once('value').then(function (snap) {
        const data = snap.val();
        if (data && data.startedAt) {
          sessionRef.update({
            duration: Math.round((Date.now() - data.startedAt) / 1000),
            lastActivity: Date.now()
          });
        }
      });
    }, 30000); // every 30s

    /* ── 3. Presence (live visitors) ── */
    const presenceRef = fbRef('/site_analytics/presence/' + visitorId);
    if (presenceRef) {
      presenceRef.set({
        page: slug,
        device: device,
        timestamp: Date.now()
      }).catch(function (err) { console.error('[Tracker] presence write failed:', err.message); });
    }

    // Heartbeat
    const heartbeat = setInterval(function () {
      if (presenceRef) presenceRef.update({ timestamp: Date.now(), page: slug }).catch(function () {});
    }, 25000);

    // Cleanup on leave
    if (presenceRef) presenceRef.onDisconnect().remove();
    window.addEventListener('beforeunload', function () {
      clearInterval(heartbeat);
      if (presenceRef) presenceRef.remove();
      // Final session duration update
      var endTime = Date.now();
      sessionRef.once('value').then(function (snap) {
        var data = snap.val();
        if (data && data.startedAt) {
          sessionRef.update({
            duration: Math.round((endTime - data.startedAt) / 1000),
            endedAt: endTime
          });
        }
      });
    });

    /* ── 4. Scroll Depth ── */
    var maxScroll = 0;
    var scrollThresholds = [25, 50, 75, 100];
    var scrollReported = {};
    window.addEventListener('scroll', function () {
      var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;
      var pct = Math.round((scrollTop / docHeight) * 100);
      if (pct > maxScroll) maxScroll = pct;
      scrollThresholds.forEach(function (t) {
        if (pct >= t && !scrollReported[t]) {
          scrollReported[t] = true;
          var countRef = fbRef('/site_analytics/scrollDepth/' + dateStr + '/' + slug + '/' + t);
          countRef.transaction(function (current) { return (current || 0) + 1; });
        }
      });
    }, { passive: true });

    /* ── 5. Performance (once per page) ── */
    if (window.PerformanceObserver) {
      setTimeout(function () {
        try {
          var nav = performance.getEntriesByType('navigation')[0];
          var perf = {
            device: device,
            timestamp: Date.now()
          };
          if (nav) {
            perf.ttfb = Math.round(nav.responseStart - nav.requestStart);
            perf.domLoad = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
            perf.fullLoad = Math.round(nav.loadEventEnd - nav.startTime);
          }
          // Web Vitals via PerformanceObserver if ready
          var lcp = performance.getEntriesByType('largest-contentful-paint');
          if (lcp && lcp.length) perf.lcp = Math.round(lcp[lcp.length - 1].startTime);

          fbRef('/site_analytics/performance/' + dateStr).push(perf);
        } catch (e) { /* noop */ }
      }, 5000);
    }
  });
})();
