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

/* ════ LOADER ════ */
const heroVideo = document.getElementById('hero-video');
const heroSource = document.getElementById('hero-video-source');

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

    if (heroVideo && manifest.main_video && manifest.main_video.length > 0) {
      const pick = manifest.main_video[Math.floor(Math.random() * manifest.main_video.length)];
      heroSource.src = pick.src;
      const seekRandom = () => {
        if (isFinite(heroVideo.duration) && heroVideo.duration > 5) {
          heroVideo.currentTime = Math.random() * (heroVideo.duration - 5);
          ['loadedmetadata', 'durationchange', 'canplay'].forEach(ev => heroVideo.removeEventListener(ev, seekRandom));
        }
      };
      ['loadedmetadata', 'durationchange', 'canplay'].forEach(ev => heroVideo.addEventListener(ev, seekRandom));
      heroVideo.load();
      heroVideo.play().catch(() => {});
    } else {
      hideLoader();
    }
  })
  .catch(() => { hideLoader(); });

/* ════ SECTION GRID ════ */
const SECTION_LABEL = { documentaries: 'Documentary', ngo_works: 'NGO Work', travel_films: 'Travel Film' };

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
    video.pause();
    document.getElementById('fm-source').src = '';
    video.load();
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
  const video = document.getElementById('fm-video');
  document.getElementById('fm-source').src = f.src;
  video.load();
  video.play().catch(() => {});
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
    if (e.key === 'Escape') closeFilmModal();
    if (e.key === 'ArrowLeft') { e.preventDefault(); const v = document.getElementById('fm-video'); v.currentTime = Math.max(0, v.currentTime - 10); }
    if (e.key === 'ArrowRight') { e.preventDefault(); const v = document.getElementById('fm-video'); v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); }
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
