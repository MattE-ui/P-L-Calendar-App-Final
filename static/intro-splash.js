(() => {
  const storageKey = 'vts_intro_shown';
  if (sessionStorage.getItem(storageKey) === 'true') {
    return;
  }

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.getElementById('vts-intro')) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'vts-intro';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('role', 'presentation');

  const inner = document.createElement('div');
  inner.className = 'vts-intro-inner';

  const logo = document.createElement('img');
  logo.className = 'vts-logo';
  logo.src = '/static/brand/veracity-logo.svg';
  logo.alt = 'Veracity Trading Suite';

  const fallback = document.createElement('div');
  fallback.className = 'vts-logo-fallback';
  fallback.textContent = 'VERACITY\nTRADING SUITE';
  fallback.setAttribute('aria-hidden', 'true');

  const wipe = document.createElement('div');
  wipe.className = 'vts-wipe';
  wipe.setAttribute('aria-hidden', 'true');

  inner.appendChild(logo);
  inner.appendChild(fallback);
  inner.appendChild(wipe);
  overlay.appendChild(inner);

  const mount = () => {
    if (!document.body.contains(overlay)) {
      document.body.appendChild(overlay);
    }
  };

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }

  const removeOverlay = () => {
    overlay.classList.add('out');
    window.setTimeout(() => {
      overlay.remove();
    }, 350);
  };

  const startAnimation = () => {
    overlay.classList.add('play');
    try {
      sessionStorage.setItem(storageKey, 'true');
    } catch (error) {
      console.warn('Intro splash session storage unavailable:', error);
    }

    const exitDelayMs = 1700;
    window.setTimeout(() => {
      overlay.classList.add('out');
      window.setTimeout(() => {
        overlay.remove();
      }, 350);
    }, exitDelayMs);
  };

  const safetyTimeoutMs = 3000;
  window.setTimeout(() => {
    if (document.body.contains(overlay)) {
      removeOverlay();
    }
  }, safetyTimeoutMs);

  logo.addEventListener('error', () => {
    overlay.classList.add('logo-missing');
  });

  if (prefersReducedMotion) {
    overlay.classList.add('reduced');
    window.requestAnimationFrame(() => startAnimation());
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(startAnimation);
  });
})();
