(function () {
  'use strict';

  // ============================================
  // Sidebar Scroll Tracking
  // ============================================
  const navItems = document.querySelectorAll('.nav-item');
  const sections = [];

  navItems.forEach(item => {
    const id = item.dataset.section;
    const el = document.getElementById(id);
    if (el) sections.push({ id, el, nav: item });
  });

  const observerOptions = {
    root: null,
    rootMargin: '-20% 0px -60% 0px',
    threshold: 0
  };

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navItems.forEach(n => n.classList.remove('active'));
        const match = sections.find(s => s.el === entry.target);
        if (match) match.nav.classList.add('active');
      }
    });
  }, observerOptions);

  sections.forEach(s => observer.observe(s.el));

  // Sidebar click navigation
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.section;
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
        // Close mobile sidebar
        document.getElementById('sidebar').classList.remove('open');
      }
    });
  });

  // ============================================
  // Mobile Sidebar Toggle
  // ============================================
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');

  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  // ============================================
  // Single Video Play/Pause
  // ============================================
  let currentlyPlaying = null;

  function stopCurrent(except) {
    if (currentlyPlaying && currentlyPlaying !== except) {
      currentlyPlaying.pause();
      const card = currentlyPlaying.closest('.video-card, .comparison-card, .pair-video-wrap');
      if (card) card.classList.remove('playing');
    }
  }

  // Add controls to all non-background videos and manage state via play/pause events
  document.querySelectorAll('.video-card video, .comparison-card video, .pair-video-wrap video').forEach(video => {
    video.controls = true;

    video.addEventListener('play', () => {
      const syncRow = video.closest('[data-sync-group]');
      const pairCard = video.closest('.pair-card');
      const inSyncMode = (syncRow && syncRow.dataset.syncActive === 'true') ||
                         (pairCard && pairCard.dataset.pairActive === 'true');

      const card = video.closest('.video-card, .comparison-card, .pair-video-wrap');
      if (card) card.classList.add('playing');

      if (inSyncMode) {
        // Group playback handles its own state; do not interrupt siblings.
        return;
      }

      stopCurrent(video);
      video.muted = false;
      currentlyPlaying = video;
    });

    video.addEventListener('pause', () => {
      const card = video.closest('.video-card, .comparison-card, .pair-video-wrap');
      if (card) card.classList.remove('playing');
      if (currentlyPlaying === video) currentlyPlaying = null;
    });

    video.addEventListener('ended', () => {
      const card = video.closest('.video-card, .comparison-card, .pair-video-wrap');
      if (card) card.classList.remove('playing');
      if (currentlyPlaying === video) currentlyPlaying = null;
    });
  });

  // ============================================
  // Sync Play (Sections 4, 5, 6)
  // ============================================
  document.querySelectorAll('.sync-play-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupName = btn.dataset.group;
      const row = document.querySelector(`[data-sync-group="${groupName}"]`);
      const videos = Array.from(row.querySelectorAll('video'));
      const isPlaying = row.dataset.syncActive === 'true';

      // Always clear any pending end-listeners from a previous session.
      if (row._syncCleanup) row._syncCleanup();

      if (isPlaying) {
        row.dataset.syncActive = 'false';
        videos.forEach(v => v.pause());
        btn.textContent = '▶ Play All';
        currentlyPlaying = null;
        return;
      }

      stopCurrent(null);
      currentlyPlaying = null;

      // Mark sync active BEFORE play() so the async play events skip stopCurrent.
      row.dataset.syncActive = 'true';
      videos.forEach((v, i) => {
        v.currentTime = 0;
        v.muted = (i !== 0);
        v.play();
      });
      btn.textContent = '⏸ Pause All';

      // When videos have different durations, wait for ALL of them to finish
      // before resetting — shorter baselines should NOT truncate the longer ones.
      let endedCount = 0;
      const onEnded = () => {
        endedCount += 1;
        if (endedCount >= videos.length) {
          row.dataset.syncActive = 'false';
          btn.textContent = '▶ Play All';
          if (row._syncCleanup) row._syncCleanup();
        }
      };
      videos.forEach(v => v.addEventListener('ended', onEnded));
      row._syncCleanup = () => {
        videos.forEach(v => v.removeEventListener('ended', onEnded));
        row._syncCleanup = null;
      };
    });
  });

  // ============================================
  // Pair Play (Section 7)
  // ============================================
  document.querySelectorAll('.pair-play-btn').forEach(btn => {
    const pairCard = btn.closest('.pair-card');
    const videos = pairCard.querySelectorAll('video');

    btn.addEventListener('click', () => {
      const isPlaying = pairCard.dataset.pairActive === 'true';

      if (isPlaying) {
        pairCard.dataset.pairActive = 'false';
        videos.forEach(v => v.pause());
        btn.textContent = '▶ Play Pair';
      } else {
        stopCurrent(null);
        currentlyPlaying = null;

        // Mark pair active BEFORE play() so the async play events skip stopCurrent.
        pairCard.dataset.pairActive = 'true';
        videos.forEach(v => {
          v.currentTime = 0;
          v.muted = false;
          v.play();
        });
        btn.textContent = '⏸ Pause';

        const onEnded = () => {
          videos.forEach(v => v.pause());
          pairCard.dataset.pairActive = 'false';
          btn.textContent = '▶ Play Pair';
          videos.forEach(v => v.removeEventListener('ended', onEnded));
        };
        videos.forEach(v => v.addEventListener('ended', onEnded));
      }
    });
  });


  // ============================================
  // Progressive Video Preload
  // ============================================
  // Sections 1 & 2: eagerly pull full video data in a throttled queue so that
  // playback is instant whenever the user eventually clicks, regardless of
  // scroll position.
  // Sections 3-7: stay lazy — only warm metadata as the card approaches the
  // viewport, and only fetch video data on user click, to save bandwidth.
  const eagerSectionIds = new Set(['section-1', 'section-2']);
  const isInEagerSection = (v) => {
    const sec = v.closest('.section, #hero');
    return sec && eagerSectionIds.has(sec.id);
  };

  // --- Lazy path for sections 3-7 ---
  const preloadObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const v = entry.target;
        if (v.preload === 'none') {
          v.preload = 'metadata';
          v.load(); // nudge the browser
        }
        preloadObserver.unobserve(v);
      }
    });
  }, { rootMargin: '400px 0px', threshold: 0 });

  document.querySelectorAll(
    '.video-card video, .comparison-card video, .pair-video-wrap video'
  ).forEach(v => {
    if (!isInEagerSection(v)) preloadObserver.observe(v);
  });

  // --- Eager path for sections 1 & 2 ---
  // Concurrency-limited queue: at most N videos downloading at once; each slot
  // advances as soon as canplaythrough (or error/stall) fires for its current
  // target. This keeps playback instant without saturating the connection.
  const eagerVideos = Array.from(document.querySelectorAll(
    '#section-1 video, #section-2 video'
  ));
  const EAGER_CONCURRENCY = 2;

  function runEagerQueue() {
    let cursor = 0;
    let inflight = 0;

    const pumpNext = () => {
      while (inflight < EAGER_CONCURRENCY && cursor < eagerVideos.length) {
        const v = eagerVideos[cursor++];
        inflight += 1;

        const done = () => {
          v.removeEventListener('canplaythrough', done);
          v.removeEventListener('error', done);
          v.removeEventListener('stalled', onStalled);
          inflight -= 1;
          pumpNext();
        };
        // If the network stalls for a while, release the slot so a sibling
        // can progress instead of blocking the queue indefinitely.
        let stallTimer = null;
        const onStalled = () => {
          if (stallTimer) return;
          stallTimer = setTimeout(done, 4000);
        };

        v.addEventListener('canplaythrough', done, { once: true });
        v.addEventListener('error', done, { once: true });
        v.addEventListener('stalled', onStalled);

        v.preload = 'auto';
        try { v.load(); } catch (_) { done(); }
      }
    };

    pumpNext();
  }

  // Defer until the initial page load settles so hero bg videos, fonts, and
  // first-screen CSS finish before we start pulling Section 1/2 payloads.
  if (document.readyState === 'complete') {
    runEagerQueue();
  } else {
    window.addEventListener('load', runEagerQueue, { once: true });
  }

  // ============================================
  // Duration Badges (any card with a .duration-badge child)
  // ============================================
  document.querySelectorAll('.duration-badge').forEach(badge => {
    const card = badge.closest('.video-card, .comparison-card');
    const video = card && card.querySelector('video');
    if (!video) return;
    const setDuration = () => {
      const dur = video.duration;
      if (!isFinite(dur) || dur <= 0) return;
      const min = Math.floor(dur / 60);
      const sec = Math.floor(dur % 60).toString().padStart(2, '0');
      badge.textContent = `${min}:${sec}`;
    };
    if (video.readyState >= 1) setDuration();
    else video.addEventListener('loadedmetadata', setDuration);
  });

  // BibTeX copy
  const bibCopyBtn = document.querySelector('.bibtex-copy');
  if (bibCopyBtn) {
    bibCopyBtn.addEventListener('click', () => {
      const code = document.querySelector('.bibtex-block code');
      if (!code) return;
      navigator.clipboard.writeText(code.innerText).then(() => {
        bibCopyBtn.textContent = 'Copied!';
        bibCopyBtn.classList.add('copied');
        setTimeout(() => {
          bibCopyBtn.textContent = 'Copy';
          bibCopyBtn.classList.remove('copied');
        }, 1800);
      });
    });
  }

})();
