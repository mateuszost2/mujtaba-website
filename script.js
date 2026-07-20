(function() {
'use strict';

history.scrollRestoration = 'manual';

const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:8001' : '';

let PHOTOS = [];
let MANIFEST = {};
let currentFilmList = [];
let currentFilm = 0;
let filmPrevFocus = null;
let filmOriginEl = null;
let scrollY = 0;

function lockScroll() {
  scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = '-' + scrollY + 'px';
  document.body.style.width = '100%';
}
function unlockScroll() {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0, scrollY);
  setTimeout(() => { document.documentElement.style.scrollBehavior = ''; }, 0);
}

function titleFromFile(filename) {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/* ════ HLS PLAYER ════ */
let heroHls = null;
let filmHls = null;

function setupHeroVideo(src) {
  if (heroHls) { heroHls.destroy(); heroHls = null; }
  if (!src) return;
  if (src.endsWith('.m3u8') && typeof Hls !== 'undefined' && Hls.isSupported()) {
    heroHls = new Hls({
      startLevel: -1,
      capLevelToPlayerSize: true,
      autoStartLoad: true,
      maxBufferLength: 30,
      maxMaxBufferLength: 90,
      maxBufferSize: 60 * 1000 * 1000,
      abrBandWidthFactor: 0.9,
      abrBandWidthUpFactor: 0.6,
      abrEwmaDefaultEstimate: 1000000,
      nudgeMaxRetry: 5,
    });
    heroHls.loadSource(src);
    heroHls.attachMedia(heroVideo);
    heroHls.on(Hls.Events.MANIFEST_PARSED, () => heroVideo.play().catch(() => {}));
  } else if (src.endsWith('.m3u8') && heroVideo.canPlayType('application/vnd.apple.mpegurl')) {
    heroVideo.src = src;
    heroVideo.load();
    heroVideo.play().catch(() => {});
  } else {
    heroVideo.src = src;
    heroVideo.load();
    heroVideo.play().catch(() => {});
  }
}

function setFilmVideo(src) {
  const video = document.getElementById('fm-video');
  if (filmHls) { filmHls.destroy(); filmHls = null; }
  const qWrap = document.getElementById('fm-quality-wrap');
  if (qWrap) qWrap.style.display = 'none';
  if (!src) { video.src = ''; video.load(); return; }
  if (src.endsWith('.m3u8') && typeof Hls !== 'undefined' && Hls.isSupported()) {
    filmHls = new Hls({
      startLevel: -1,
      capLevelToPlayerSize: true,
      maxBufferLength: 30,
      maxMaxBufferLength: 90,
      maxBufferSize: 60 * 1000 * 1000,
      abrBandWidthFactor: 0.9,
      abrBandWidthUpFactor: 0.6,
      abrEwmaDefaultEstimate: 1000000,
      nudgeMaxRetry: 5,
    });
    filmHls.loadSource(src);
    filmHls.attachMedia(video);
    filmHls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      if (filmHls.levels && filmHls.levels.length > 1 && qWrap) {
        qWrap.style.display = 'flex';
        updateQualityMenu();
      }
    });
    filmHls.on(Hls.Events.LEVEL_SWITCHED, updateQualityMenu);
  } else if (src.endsWith('.m3u8') && video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
    video.load();
    video.play().catch(() => {});
  } else {
    video.src = src;
    video.load();
    video.play().catch(() => {});
  }
}

function updateQualityMenu() {
  const menu = document.getElementById('fm-quality-menu');
  if (!menu || !filmHls) return;
  const cur = filmHls.currentLevel;
  const levels = filmHls.levels || [];
  let html = `<button class="quality-opt${cur === -1 ? ' active' : ''}" data-lvl="-1">Auto</button>`;
  for (let i = levels.length - 1; i >= 0; i--) {
    const l = levels[i];
    html += `<button class="quality-opt${cur === i ? ' active' : ''}" data-lvl="${i}">${l.height}p</button>`;
  }
  menu.innerHTML = html;
}

document.addEventListener('click', e => {
  const gearBtn = document.getElementById('fm-quality-btn');
  const menu = document.getElementById('fm-quality-menu');
  if (!gearBtn || !menu) return;

  if (e.target === gearBtn || gearBtn.contains(e.target)) {
    if (!filmHls) return;
    updateQualityMenu();
    menu.classList.toggle('open');
    return;
  }

  const opt = e.target.closest('.quality-opt');
  if (opt && menu.contains(opt)) {
    const lvl = parseInt(opt.dataset.lvl, 10);
    filmHls.nextLevel = lvl;
    menu.classList.remove('open');
    setTimeout(updateQualityMenu, 200);
    return;
  }

  menu.classList.remove('open');
});

function vcInit() {
  const wrap = document.getElementById('fm-video-wrap');
  const video = document.getElementById('fm-video');
  const vc = document.getElementById('fm-vc');
  const playBtn = document.getElementById('vc-play');
  const muteBtn = document.getElementById('vc-mute');
  const volSlider = document.getElementById('vc-vol');
  const fsBtn = document.getElementById('vc-fs');
  const prog = document.getElementById('vc-prog');
  const fill = document.getElementById('vc-fill');
  const thumb = document.getElementById('vc-thumb');
  const timeEl = document.getElementById('vc-time');

  const SVG = {
    play:   `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`,
    pause:  `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`,
    vol:    `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`,
    muted:  `<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`,
    gear:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    expand: `<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`,
    shrink: `<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`,
  };

  playBtn.innerHTML = SVG.play;
  muteBtn.innerHTML = SVG.vol;
  fsBtn.innerHTML = SVG.expand;
  document.getElementById('fm-quality-btn').innerHTML = SVG.gear;

  let hideTimer;
  function showVC() {
    vc.classList.add('visible');
    wrap.classList.add('show-cursor');
    clearTimeout(hideTimer);
    if (!video.paused) {
      hideTimer = setTimeout(() => {
        const qMenu = document.getElementById('fm-quality-menu');
        if (qMenu && qMenu.classList.contains('open')) return;
        vc.classList.remove('visible');
        wrap.classList.remove('show-cursor');
      }, 2500);
    }
  }

  function fmtTime(s) {
    s = Math.floor(s || 0);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  let showRemaining = false;
  timeEl.style.cursor = 'pointer';
  timeEl.addEventListener('click', () => { showRemaining = !showRemaining; updateProg(); });

  function updateProg() {
    const pct = video.duration ? video.currentTime / video.duration : 0;
    fill.style.width = (pct * 100) + '%';
    thumb.style.left = (pct * 100) + '%';
    if (showRemaining) {
      const rem = (video.duration || 0) - (video.currentTime || 0);
      timeEl.textContent = '-' + fmtTime(rem) + ' / ' + fmtTime(video.duration);
    } else {
      timeEl.textContent = fmtTime(video.currentTime) + ' / ' + fmtTime(video.duration);
    }
  }

  video.addEventListener('play',        () => { playBtn.innerHTML = SVG.pause; showVC(); });
  video.addEventListener('pause',       () => { playBtn.innerHTML = SVG.play;  showVC(); });
  video.addEventListener('timeupdate',  updateProg);
  function updateVol() {
    const vol = (video.muted || video.volume === 0) ? 0 : video.volume;
    muteBtn.innerHTML = vol === 0 ? SVG.muted : SVG.vol;
    volSlider.value = vol;
    volSlider.style.setProperty('--vp', (vol * 100) + '%');
  }
  video.addEventListener('volumechange', updateVol);
  video.addEventListener('click',       () => { video.paused ? video.play() : video.pause(); });

  wrap.addEventListener('mousemove',  showVC);
  wrap.addEventListener('mouseleave', () => {
    if (!video.paused) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        vc.classList.remove('visible');
        wrap.classList.remove('show-cursor');
      }, 600);
    }
  });
  wrap.addEventListener('touchstart', showVC, { passive: true });

  playBtn.addEventListener('click', () => { video.paused ? video.play() : video.pause(); });
  muteBtn.addEventListener('click', () => { video.muted = !video.muted; });
  volSlider.addEventListener('input', () => {
    video.volume = parseFloat(volSlider.value);
    video.muted = video.volume === 0;
  });;

  prog.addEventListener('click', e => {
    const r = prog.getBoundingClientRect();
    video.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (video.duration || 0);
  });

  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    fsBtn.innerHTML = document.fullscreenElement ? SVG.shrink : SVG.expand;
  });

  window._vcShowControls = showVC;
}
vcInit();

const _osdVolSVG  = `<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
const _osdMuteSVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;

function vcPulseCtrl(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('ctrl-pulse');
  void el.offsetWidth;
  el.classList.add('ctrl-pulse');
}

let vcOsdTimer;
let vcSeekAccum = 0;
function vcShowOSD(type, value) {
  const osd = document.getElementById('vc-osd');
  if (!osd) return;
  osd.style.background = 'none';
  osd.style.padding = '0';
  osd.style.filter = 'drop-shadow(0 2px 10px rgba(0,0,0,1))';
  if (type === 'vol') {
    osd.style.left = '50%';
    osd.style.right = '';
    osd.style.transform = 'translate(-50%, -50%)';
    const pct = Math.round(value * 100);
    osd.innerHTML =
      `<div class="osd-seek-row" style="flex-direction:column;gap:6px;align-items:center">` +
        `<div style="display:flex;align-items:center;gap:7px">${pct === 0 ? _osdMuteSVG : _osdVolSVG}<span style="font-size:15px;font-weight:400">${pct}%</span></div>` +
        `<div style="width:84px;height:3px;background:rgba(255,255,255,0.28);border-radius:2px">` +
          `<div style="width:${pct}%;height:100%;background:#fff;border-radius:2px"></div></div>` +
      `</div>`;
  } else {
    if (vcSeekAccum === 0 || Math.sign(value) === Math.sign(vcSeekAccum)) {
      vcSeekAccum += value;
    } else {
      vcSeekAccum = value;
    }
    const secs = Math.abs(vcSeekAccum);
    const fwd = vcSeekAccum > 0;
    osd.style.transform = 'translateY(-50%)';
    if (fwd) { osd.style.left = ''; osd.style.right = '24px'; }
    else      { osd.style.left = '24px'; osd.style.right = ''; }
    const ch = fwd ? '›' : '‹';
    osd.innerHTML =
      `<div class="osd-seek-row">` +
        `<div class="osd-chevrons ${fwd ? 'fwd' : 'bwd'}"><span class="osd-c2">${ch}</span><span class="osd-c1">${ch}</span></div>` +
        `<span class="osd-stime">${fwd ? '+' : '−'}${secs}s</span>` +
      `</div>`;
  }
  osd.style.opacity = '1';
  clearTimeout(vcOsdTimer);
  vcOsdTimer = setTimeout(() => { osd.style.opacity = '0'; vcSeekAccum = 0; }, 900);
}

/* ════ LOADER ════ */
const heroVideo = document.getElementById('hero-video');

function hideLoader() {
  const loader = document.getElementById('loader');
  if (!loader) return;
  loader.classList.add('open');
  setTimeout(() => loader.classList.add('gone'), 1200);
}

let loaderPct = 0;
let loaderRAF = null;

function setLoaderDisplay(pct) {
  const count = document.getElementById('loader-count');
  const circle = document.querySelector('.loader-ring-progress');
  if (count) count.textContent = Math.round(pct) + '%';
  if (circle) circle.style.strokeDashoffset = 188.5 - (188.5 * pct / 100);
}

function animateLoaderTo(target, duration) {
  target = Math.max(target, loaderPct); // progress never moves backward
  if (loaderRAF) cancelAnimationFrame(loaderRAF);
  const start = loaderPct;
  const startTime = performance.now();
  function step(now) {
    const t = duration > 0 ? Math.min((now - startTime) / duration, 1) : 1;
    loaderPct = start + (target - start) * t;
    setLoaderDisplay(loaderPct);
    if (t < 1) loaderRAF = requestAnimationFrame(step);
  }
  loaderRAF = requestAnimationFrame(step);
}

// Minimum time the loader stays on screen — even if the video is ready
// instantly, the ring still takes this long to visibly sweep 0% → 100%.
const LOADER_MIN_DURATION = 1200;
const loaderStartTime = performance.now();
let loaderDone = false;

function completeLoader() {
  if (loaderDone) return;
  loaderDone = true;
  animateLoaderTo(100, 400);
  setTimeout(hideLoader, 600);
}

function finishLoader() {
  const elapsed = performance.now() - loaderStartTime;
  const remaining = Math.max(LOADER_MIN_DURATION - elapsed, 0);
  animateLoaderTo(99, remaining);
  setTimeout(completeLoader, remaining);
}

// Creep toward 90% while the page actually loads, so the ring always visibly
// sweeps up instead of jumping in sparse buffered-progress increments.
animateLoaderTo(90, LOADER_MIN_DURATION * 0.85);

setTimeout(completeLoader, 6000);

if (heroVideo) {
  heroVideo.style.opacity = '0';
  heroVideo.style.transition = 'opacity 1.2s ease';

  heroVideo.addEventListener('playing', () => {
    finishLoader();
    heroVideo.style.opacity = '1';
  }, { once: true });

  let muted = true;
  document.getElementById('unmute-btn').addEventListener('click', e => {
    e.stopPropagation();
    muted = !muted;
    heroVideo.muted = muted;
    document.getElementById('icon-sound').style.display = muted ? 'none' : 'block';
    document.getElementById('icon-muted').style.display = muted ? 'block' : 'none';
  });
}

/* ════ MANIFEST ════ */
fetch('manifest.json')
  .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
  .then(manifest => {
    MANIFEST = manifest;

    if (manifest.about_img && manifest.about_img.length > 0) {
      const img = document.getElementById('about-img');
      img.src = 'pictures/about_me_pic/' + manifest.about_img[0];
      img.style.display = '';
    }

    if (manifest.about_text && manifest.about_text.length > 0) {
      const bio = document.getElementById('about-bio');
      bio.innerHTML = manifest.about_text.map(p => `<p>${p}</p>`).join('');
    }

    PHOTOS = (manifest.photos || []).map(item => {
      const filename = typeof item === 'object' ? item.filename : item;
      const src = (typeof item === 'object' && item.src) ? item.src : 'pictures/documentary_photography/compressed/' + filename.replace(/\.[^.]+$/, '.jpg');
      return {
        title: (item.title && item.title.trim()) ? item.title : titleFromFile(filename),
        description: (typeof item === 'object' && item.description) ? item.description : '',
        src,
      };
    });
    buildPhotoGrid();

    buildSectionGrid('documentaries', manifest.documentaries || [], 'docs-grid');
    buildSectionGrid('ngo_works', manifest.ngo_works || [], 'ngo-grid');
    buildSectionGrid('travel_films', manifest.travel_films || [], 'travel-grid');

    if (manifest.hero_position) heroVideo.style.objectPosition = manifest.hero_position;

    if (heroVideo && manifest.main_video && manifest.main_video.length > 0) {
      const pick = manifest.main_video[Math.floor(Math.random() * manifest.main_video.length)];
      const seekRandom = () => {
        if (isFinite(heroVideo.duration) && heroVideo.duration > 5) {
          heroVideo.currentTime = Math.random() * (heroVideo.duration - 5);
          ['loadedmetadata', 'durationchange', 'canplay'].forEach(ev => heroVideo.removeEventListener(ev, seekRandom));
        }
      };
      ['loadedmetadata', 'durationchange', 'canplay'].forEach(ev => heroVideo.addEventListener(ev, seekRandom));
      setupHeroVideo(pick.src);
    } else {
      hideLoader();
    }
  })
  .catch(() => { hideLoader(); });

/* ════ SECTION GRID ════ */
const SECTION_LABEL = { documentaries: 'Documentary', ngo_works: 'NGO Work', travel_films: 'Travel Vlog' };

function buildSectionGrid(cat, rawItems, gridId) {
  const catLabel = SECTION_LABEL[cat];

  const sorted = rawItems.map(item => ({
    title: item.title || titleFromFile(item.filename),
    year: item.year || '',
    role: item.role || '',
    description: item.description || '',
    catLabel,
    src: item.src,
    thumb: item.thumb,
  }));

  const grid = document.getElementById(gridId);
  grid.innerHTML = '';

  const cards = sorted.map((f, i) => {
    const card = document.createElement('div');
    card.className = 'film-card fade-up';
    card.style.transitionDelay = (i % 3 * 80) + 'ms';
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', f.title);

    if (i >= 6) card.style.display = 'none';

    card.innerHTML = `
      <div class="film-thumb">
        <img src="${f.thumb}" alt="${f.title}" loading="lazy" decoding="async" onerror="this.style.display='none'">
        <div class="film-overlay" aria-hidden="true">
          <div class="play-ring">
            <svg viewBox="0 0 10 10" aria-hidden="true"><polygon points="2,1 9,5 2,9"/></svg>
          </div>
        </div>
      </div>
      <div class="film-info">
        <div class="film-title">${f.title}</div>
        <div class="film-meta">${f.year ? f.year + ' · ' : ''}${cat === 'ngo_works' && f.role ? f.role : catLabel}</div>
      </div>`;
    card.addEventListener('click', () => openFilmModal(sorted, i, card));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFilmModal(sorted, i); }
    });
    grid.appendChild(card);
    observer.observe(card);
    return card;
  });

  if (sorted.length > 6) {
    addSeeMoreToggle(grid, cards.slice(6));
  }
}

/* ════ FILM MODAL ════ */
const filmModal = document.getElementById('film-modal');

function openFilmModal(filmList, i, originEl) {
  currentFilmList = filmList;
  currentFilm = i;
  filmPrevFocus = document.activeElement;
  filmOriginEl = originEl || null;
  updateFilmModal();

  // Backdrop fade
  filmModal.style.opacity = '0';
  filmModal.classList.add('open');
  lockScroll();
  requestAnimationFrame(() => {
    filmModal.style.transition = 'opacity 0.25s ease';
    filmModal.style.opacity = '1';
    setTimeout(() => { filmModal.style.transition = ''; filmModal.style.opacity = ''; }, 300);
    document.getElementById('film-modal-close').focus();
  });

  // FLIP zoom from thumbnail
  if (originEl) {
    const thumbEl = originEl.querySelector('.film-thumb') || originEl;
    const thumbRect = thumbEl.getBoundingClientRect();
    const videoWrap = document.querySelector('.film-modal-video');
    videoWrap.style.opacity = '0';
    videoWrap.style.transform = '';
    videoWrap.style.transformOrigin = '';
    let retries = 0;

    function runFlip() {
      requestAnimationFrame(() => {
        const vRect = videoWrap.getBoundingClientRect();
        if ((!vRect.width || !vRect.height) && retries++ < 10) { runFlip(); return; }
        const thumbCX = thumbRect.left + thumbRect.width  / 2;
        const thumbCY = thumbRect.top  + thumbRect.height / 2;
        const vCX     = vRect.left     + vRect.width      / 2;
        const vCY     = vRect.top      + vRect.height     / 2;
        const scale   = Math.min(thumbRect.width / (vRect.width || 1), thumbRect.height / (vRect.height || 1));
        const tx = thumbCX - vCX;
        const ty = thumbCY - vCY;

        videoWrap.style.transition = 'none';
        videoWrap.style.transformOrigin = 'center center';
        videoWrap.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
        videoWrap.style.opacity = '1';

        requestAnimationFrame(() => {
          videoWrap.style.transition = 'transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94)';
          videoWrap.style.transform = 'translate(0,0) scale(1)';
          setTimeout(() => {
            videoWrap.style.transition = '';
            videoWrap.style.transform = '';
            videoWrap.style.transformOrigin = '';
          }, 350);
        });
      });
    }
    runFlip();
  }
}
function closeFilmModal() {
  const videoWrap = document.querySelector('.film-modal-video');
  const thumbEl = filmOriginEl ? (filmOriginEl.querySelector('.film-thumb') || filmOriginEl) : null;
  const thumbRect = thumbEl ? thumbEl.getBoundingClientRect() : null;
  const vRect = videoWrap.getBoundingClientRect();
  const canAnimate = thumbRect && thumbRect.width > 0 && vRect.width > 0;

  function finalizeClose() {
    filmModal.classList.remove('open');
    filmModal.style.opacity = '';
    filmModal.style.transition = '';
    videoWrap.style.transition = '';
    videoWrap.style.transform = '';
    videoWrap.style.transformOrigin = '';
    videoWrap.style.opacity = '';
    const video = document.getElementById('fm-video');
    if (filmHls) { filmHls.destroy(); filmHls = null; }
    video.pause();
    video.src = '';
    video.load();
    const qWrap = document.getElementById('fm-quality-wrap');
    if (qWrap) qWrap.style.display = 'none';
    const qMenu = document.getElementById('fm-quality-menu');
    if (qMenu) qMenu.classList.remove('open');
    const vc = document.getElementById('fm-vc');
    if (vc) vc.classList.remove('visible');
    const vcWrap = document.getElementById('fm-video-wrap');
    if (vcWrap) vcWrap.classList.remove('show-cursor');
    unlockScroll();
    if (filmPrevFocus) filmPrevFocus.focus();
  }

  if (canAnimate) {
    const thumbCX = thumbRect.left + thumbRect.width  / 2;
    const thumbCY = thumbRect.top  + thumbRect.height / 2;
    const vCX     = vRect.left     + vRect.width      / 2;
    const vCY     = vRect.top      + vRect.height     / 2;
    const scale   = Math.min(thumbRect.width / vRect.width, thumbRect.height / vRect.height);
    const tx = thumbCX - vCX;
    const ty = thumbCY - vCY;

    videoWrap.style.transformOrigin = 'center center';
    videoWrap.style.transition = 'transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.25s ease';
    videoWrap.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    videoWrap.style.opacity = '0';

    filmModal.style.transition = 'opacity 0.25s ease';
    filmModal.style.opacity = '0';

    setTimeout(finalizeClose, 320);
  } else {
    finalizeClose();
  }
}
function updateFilmModal() {
  const f = currentFilmList[currentFilm];
  document.getElementById('fm-title').textContent = f.title;
  document.getElementById('fm-meta').textContent = [f.year, f.catLabel].filter(Boolean).join(' · ');
  const roleEl = document.getElementById('fm-role');
  const roleRow = document.getElementById('fm-role-row');
  const descEl = document.getElementById('fm-description');
  const descRow = document.getElementById('fm-desc-row');
  document.querySelector('#fm-role-row .film-modal-detail-label').textContent = f.catLabel === 'NGO Work' ? 'NGO' : 'My Role';
  roleEl.textContent = f.role || '';
  descEl.textContent = f.description || '';
  roleRow.style.display = f.role ? 'flex' : 'none';
  descRow.style.display = f.description ? 'flex' : 'none';
  document.getElementById('fm-details').style.display = (f.role || f.description) ? 'flex' : 'none';
  document.getElementById('fm-counter').textContent = (currentFilm + 1) + ' / ' + currentFilmList.length;
  setFilmVideo(f.src);
}
function prevFilm() { currentFilm = (currentFilm - 1 + currentFilmList.length) % currentFilmList.length; updateFilmModal(); }
function nextFilm() { currentFilm = (currentFilm + 1) % currentFilmList.length; updateFilmModal(); }

document.getElementById('film-modal-close').addEventListener('click', closeFilmModal);
document.getElementById('prev-film-btn').addEventListener('click', prevFilm);
document.getElementById('next-film-btn').addEventListener('click', nextFilm);
filmModal.addEventListener('click', e => { if (e.target === filmModal) closeFilmModal(); });

/* ════ SEE MORE / SEE LESS TOGGLE ════ */
function addSeeMoreToggle(grid, hiddenItems) {
  let expanded = false;
  const btn = document.createElement('div');
  btn.className = 'see-more-btn';
  btn.style.cssText = 'grid-column:1/-1;display:flex;flex-direction:column;align-items:center;gap:10px;padding:24px 0;cursor:pointer;';
  const label = document.createElement('span');
  label.style.cssText = 'font-size:9px;letter-spacing:0.22em;text-transform:uppercase;color:var(--accent);opacity:0.7;font-family:\'DM Sans\',sans-serif;';
  label.textContent = 'See more';
  btn.appendChild(label);

  btn.addEventListener('click', () => {
    expanded = !expanded;
    if (expanded) {
      hiddenItems.forEach((item, i) => {
        item.style.display = '';
        item.style.opacity = '0';
        item.style.transform = 'translateY(16px)';
        item.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        setTimeout(() => {
          item.style.opacity = '1';
          item.style.transform = 'translateY(0)';
          setTimeout(() => {
            item.style.opacity = '';
            item.style.transform = '';
            item.style.transition = '';
          }, 500);
        }, i * 60);
      });
      label.textContent = 'See less';
      grid.appendChild(btn);
    } else {
      hiddenItems.forEach(item => { item.style.display = 'none'; });
      label.textContent = 'See more';
      grid.appendChild(btn);
      const section = grid.closest('section') || grid;
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  grid.appendChild(btn);
}

/* ════ PHOTO GRID ════ */
let currentPhoto = 0;

function buildPhotoGrid() {
  const grid = document.getElementById('photo-grid');
  grid.innerHTML = '';

  const items = PHOTOS.map((p, fi) => {
    const item = document.createElement('div');
    item.className = 'photo-item';
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', p.title);

    if (fi >= 6) item.style.display = 'none';

    item.innerHTML = `
      <img src="${p.src}" alt="${p.title}" loading="lazy" decoding="async" onerror="this.style.display='none'">
      <div class="photo-item-overlay" aria-hidden="true"><span>${p.title}</span></div>`;

    item.addEventListener('click', () => openLightbox(fi, item));
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(fi); }
    });
    grid.appendChild(item);
    return item;
  });

  if (PHOTOS.length > 6) {
    addSeeMoreToggle(grid, items.slice(6));
  }
}

/* ════ PHOTO LIGHTBOX ════ */
const lightbox = document.getElementById('photo-lightbox');
let lightboxPrevFocus = null;

function openLightbox(fi, originEl) {
  currentPhoto = fi;
  lightboxPrevFocus = document.activeElement;
  const imgEl = document.getElementById('lb-img');
  imgEl.style.transition = 'none';
  imgEl.style.transform = 'translateX(0)';
  imgEl.style.opacity = '';
  imgEl.style.transformOrigin = '';
  lbAnimating = false;
  document.querySelectorAll('.lb-img-wrap img:not(#lb-img)').forEach(el => el.remove());
  updateLightbox();

  // Fade-in backdrop
  lightbox.style.opacity = '0';
  lightbox.classList.add('open');
  lockScroll();
  requestAnimationFrame(() => {
    lightbox.style.transition = 'opacity 0.25s ease';
    lightbox.style.opacity = '1';
    setTimeout(() => { lightbox.style.transition = ''; lightbox.style.opacity = ''; }, 300);
    document.getElementById('lb-close-btn').focus();
  });

  // Zoom from thumbnail using FLIP
  if (originEl) {
    const thumbRect = originEl.getBoundingClientRect();
    imgEl.style.opacity = '0';
    let retries = 0;

    function runFlip() {
      requestAnimationFrame(() => {
        const imgRect = imgEl.getBoundingClientRect();
        if ((!imgRect.width || !imgRect.height) && retries++ < 10) {
          runFlip();
          return;
        }
        const thumbCX = thumbRect.left + thumbRect.width / 2;
        const thumbCY = thumbRect.top  + thumbRect.height / 2;
        const imgCX   = imgRect.left   + imgRect.width  / 2;
        const imgCY   = imgRect.top    + imgRect.height / 2;
        const scale   = Math.min(thumbRect.width / (imgRect.width || 1), thumbRect.height / (imgRect.height || 1));
        const tx = thumbCX - imgCX;
        const ty = thumbCY - imgCY;

        imgEl.style.transition = 'none';
        imgEl.style.transformOrigin = 'center center';
        imgEl.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
        imgEl.style.opacity = '1';

        requestAnimationFrame(() => {
          imgEl.style.transition = 'transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94)';
          imgEl.style.transform = 'translate(0,0) scale(1)';
          setTimeout(() => {
            imgEl.style.transition = '';
            imgEl.style.transform = '';
            imgEl.style.transformOrigin = '';
          }, 350);
        });
      });
    }

    if (imgEl.complete && imgEl.naturalWidth) {
      runFlip();
    } else {
      imgEl.addEventListener('load', runFlip, { once: true });
      // Safety: if image never fires load (e.g. error), show it after delay
      setTimeout(() => { if (imgEl.style.opacity === '0') { imgEl.style.opacity = ''; } }, 800);
    }
  }
}
function closeLightbox() {
  const imgEl = document.getElementById('lb-img');

  function finalizeClose() {
    lightbox.classList.remove('open');
    lightbox.style.opacity = '';
    lightbox.style.transition = '';
    imgEl.style.transition = '';
    imgEl.style.transform = '';
    imgEl.style.transformOrigin = '';
    imgEl.style.opacity = '';
    unlockScroll();
    if (lightboxPrevFocus) lightboxPrevFocus.focus();
  }

  const thumbEl = document.querySelectorAll('#photo-grid .photo-item')[currentPhoto];
  const thumbRect = thumbEl ? thumbEl.getBoundingClientRect() : null;
  const imgRect = imgEl.getBoundingClientRect();
  const canAnimate = thumbRect && thumbRect.width > 0 && imgRect.width > 0;

  if (canAnimate) {
    const thumbCX = thumbRect.left + thumbRect.width  / 2;
    const thumbCY = thumbRect.top  + thumbRect.height / 2;
    const imgCX   = imgRect.left   + imgRect.width    / 2;
    const imgCY   = imgRect.top    + imgRect.height   / 2;
    const scale   = Math.min(thumbRect.width / imgRect.width, thumbRect.height / imgRect.height);
    const tx = thumbCX - imgCX;
    const ty = thumbCY - imgCY;

    imgEl.style.transformOrigin = 'center center';
    imgEl.style.transition = 'transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.25s ease';
    imgEl.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    imgEl.style.opacity = '0';

    lightbox.style.transition = 'opacity 0.25s ease';
    lightbox.style.opacity = '0';

    setTimeout(finalizeClose, 320);
  } else {
    finalizeClose();
  }
}
function updateLightbox() {
  const p = PHOTOS[currentPhoto];
  document.getElementById('lb-img').src = p.src;
  document.getElementById('lb-img').alt = p.title;
  document.getElementById('lb-title').textContent = p.title;
  document.getElementById('lb-meta').textContent = 'Documentary Photography';
  document.getElementById('lb-counter').textContent = (currentPhoto + 1) + ' / ' + PHOTOS.length;
  const descEl = document.getElementById('lb-desc');
  const descRow = document.getElementById('lb-desc-row');
  const details = document.getElementById('lb-details');
  descEl.textContent = p.description || '';
  descRow.style.display = p.description ? 'flex' : 'none';
  details.style.display = p.description ? 'flex' : 'none';
}
let lbAnimating = false;
function slidePhoto(newIndex, direction) {
  if (lbAnimating) return;
  lbAnimating = true;
  const wrap = document.querySelector('.lb-img-wrap');
  const imgEl = document.getElementById('lb-img');
  const distance = window.innerWidth;

  const clone = imgEl.cloneNode(true);
  clone.removeAttribute('id');
  clone.style.position = 'absolute';
  clone.style.top = '0';
  clone.style.left = '0';
  clone.style.right = '0';
  clone.style.bottom = '0';
  clone.style.margin = 'auto';
  clone.style.transition = 'transform 0.4s ease';
  clone.style.transform = 'translateX(0)';
  wrap.appendChild(clone);

  currentPhoto = newIndex;
  updateLightbox();
  imgEl.style.transition = 'none';
  imgEl.style.transform = `translateX(${direction * distance}px)`;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      clone.style.transform = `translateX(${direction * -distance}px)`;
      imgEl.style.transition = 'transform 0.4s ease';
      imgEl.style.transform = 'translateX(0)';
    });
  });

  setTimeout(() => {
    clone.remove();
    lbAnimating = false;
  }, 400);
}
function prevPhoto() { slidePhoto((currentPhoto - 1 + PHOTOS.length) % PHOTOS.length, -1); }
function nextPhoto() { slidePhoto((currentPhoto + 1) % PHOTOS.length, 1); }

document.getElementById('lb-close-btn').addEventListener('click', closeLightbox);
document.getElementById('prev-photo-btn').addEventListener('click', prevPhoto);
document.getElementById('next-photo-btn').addEventListener('click', nextPhoto);
lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });

/* ════ PRIVACY MODAL ════ */
const privacyModal = document.getElementById('privacy-modal');
function openPrivacyModal() {
  privacyModal.classList.add('open');
  lockScroll();
}
function closePrivacyModal() {
  privacyModal.classList.remove('open');
  unlockScroll();
}
document.getElementById('privacy-open').addEventListener('click', e => { e.preventDefault(); openPrivacyModal(); });
document.getElementById('privacy-close').addEventListener('click', closePrivacyModal);
privacyModal.addEventListener('click', e => { if (e.target === privacyModal) closePrivacyModal(); });

/* ════ KEYBOARD ════ */
document.addEventListener('keydown', e => {
  if (filmModal.classList.contains('open')) {
    const v = document.getElementById('fm-video');
    const tag = e.target.tagName;
    const noInput = tag !== 'BUTTON' && tag !== 'INPUT';
    const dur = v.duration || 0;

    switch (e.key) {
      case 'Escape': closeFilmModal(); break;

      case ' ':
      case 'k': case 'K':
        if (noInput) { e.preventDefault(); v.paused ? v.play() : v.pause(); }
        break;

      case 'ArrowLeft':
        e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5);
        if (v.currentTime === 0) vcSeekAccum = 0;
        vcShowOSD('seek', -5); if (window._vcShowControls) window._vcShowControls(); break;
      case 'ArrowRight':
        e.preventDefault(); v.currentTime = Math.min(dur, v.currentTime + 5);
        if (v.currentTime === dur) vcSeekAccum = 0;
        vcShowOSD('seek', 5); if (window._vcShowControls) window._vcShowControls(); break;

      case 'j': case 'J':
        e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 10);
        if (v.currentTime === 0) vcSeekAccum = 0;
        vcShowOSD('seek', -10); if (window._vcShowControls) window._vcShowControls(); break;
      case 'l': case 'L':
        e.preventDefault(); v.currentTime = Math.min(dur, v.currentTime + 10);
        if (v.currentTime === dur) vcSeekAccum = 0;
        vcShowOSD('seek', 10); if (window._vcShowControls) window._vcShowControls(); break;

      case ',':
        e.preventDefault(); v.pause(); v.currentTime = Math.max(0, v.currentTime - 1 / 30);
        if (window._vcShowControls) window._vcShowControls(); break;
      case '.':
        e.preventDefault(); v.pause(); v.currentTime = Math.min(dur, v.currentTime + 1 / 30);
        if (window._vcShowControls) window._vcShowControls(); break;

      case 'Home':
        e.preventDefault(); v.currentTime = 0; if (window._vcShowControls) window._vcShowControls(); break;
      case 'End':
        e.preventDefault(); v.currentTime = dur; if (window._vcShowControls) window._vcShowControls(); break;

      case 'ArrowUp':
        e.preventDefault();
        v.volume = Math.min(1, Math.round((v.volume + 0.05) * 100) / 100);
        v.muted = false; vcShowOSD('vol', v.volume); if (window._vcShowControls) window._vcShowControls(); break;
      case 'ArrowDown':
        e.preventDefault();
        v.volume = Math.max(0, Math.round((v.volume - 0.05) * 100) / 100);
        vcShowOSD('vol', v.volume); if (window._vcShowControls) window._vcShowControls(); break;

      case 'm': case 'M':
        v.muted = !v.muted; vcShowOSD('vol', v.muted ? 0 : v.volume); break;

      case 'f': case 'F': {
        const wrap = document.getElementById('fm-video-wrap');
        if (document.fullscreenElement) document.exitFullscreen();
        else wrap.requestFullscreen().catch(() => {});
        break;
      }
      case 't': case 'T':
        filmModal.classList.toggle('theater'); break;

      case 'i': case 'I':
        if (document.pictureInPictureEnabled) {
          if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
          else v.requestPictureInPicture().catch(() => {});
        }
        break;

      default:
        if (noInput && e.key >= '0' && e.key <= '9') {
          e.preventDefault();
          v.currentTime = dur * parseInt(e.key) / 10;
        }
    }
    return;
  }
  if (lightbox.classList.contains('open')) {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') prevPhoto();
    if (e.key === 'ArrowRight') nextPhoto();
  }
  if (privacyModal.classList.contains('open')) {
    if (e.key === 'Escape') closePrivacyModal();
  }
});

/* ════ CONTACT FORM ════ */
document.getElementById('contact-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const status = document.getElementById('form-status');
  const btn = document.getElementById('form-btn');
  const name = this.name.value.trim();
  const email = this.email.value.trim();
  const message = this.message.value.trim();
  status.className = 'form-status';

  if (!name || name.length < 2) { status.textContent = 'Please enter your name.'; status.className = 'form-status error'; this.name.focus(); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status.textContent = 'Please enter a valid email address.'; status.className = 'form-status error'; this.email.focus(); return; }
  if (!message || message.length < 10) { status.textContent = 'Please write a message (at least 10 characters).'; status.className = 'form-status error'; this.message.focus(); return; }

  btn.disabled = true;
  status.textContent = 'Sending\u2026';

  try {
    const res = await fetch(`${API_BASE}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message }),
    });
    if (res.ok) { status.textContent = "Message sent. I'll be in touch soon."; this.reset(); }
    else { throw new Error('server'); }
  } catch {
    status.textContent = 'Something went wrong. Please email: contact@mujtabamanzoor.com';
    status.className = 'form-status error';
  } finally { btn.disabled = false; }
});

/* ════ THEME ════ */
const html = document.documentElement;
const themePref = localStorage.getItem('theme') || 'light';
html.setAttribute('data-theme', themePref);
updateThemeIcons(themePref);
updateFavicon(themePref);

document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcons(next);
  updateFavicon(next);
});
function updateThemeIcons(theme) {
  document.getElementById('icon-moon').style.display = theme === 'dark' ? 'block' : 'none';
  document.getElementById('icon-sun').style.display = theme === 'light' ? 'block' : 'none';
}
function updateFavicon(theme) {
  const bg   = theme === 'dark' ? '%230C0C0B' : '%23EDE8DF';
  const fill = theme === 'dark' ? '%23C9A96E' : '%239E7A3F';
  document.querySelector("link[rel='icon']").href = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='${bg}'/><text x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='Georgia,serif' font-size='20' fill='${fill}'>M</text></svg>`;
}

/* ════ NAVBAR ════ */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
  updateScrollSpy();
}, { passive: true });

function updateScrollSpy() {
  const ids = ['documentaries', 'ngo', 'travel-films', 'photography', 'about', 'contact'];
  let active = '';
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el && window.scrollY >= el.offsetTop - 120) active = id;
  });
  document.querySelectorAll('.nav-links a[data-section]').forEach(a => {
    a.classList.toggle('active', a.dataset.section === active);
  });
}

/* ════ HAMBURGER ════ */
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');

hamburger.addEventListener('click', () => {
  const open = mobileMenu.classList.toggle('open');
  hamburger.classList.toggle('open', open);
  hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
  hamburger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  mobileMenu.setAttribute('aria-hidden', open ? 'false' : 'true');
  document.body.style.overflow = open ? 'hidden' : '';
});

document.querySelectorAll('.mobile-link').forEach(a => {
  a.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
    hamburger.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-label', 'Open menu');
    mobileMenu.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  });
});

/* ════ FADE-UP ════ */
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));
})();
