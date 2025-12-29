(() => {
  const storageKey = 'vts_intro_shown';
  if (sessionStorage.getItem(storageKey) === 'true') {
    return;
  }

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const overlay = document.createElement('div');
  overlay.id = 'vts-intro';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('role', 'presentation');

  const logo = document.createElement('img');
  logo.className = 'vts-intro__logo';
  logo.src = '/static/brand/veracity-logo.svg';
  logo.alt = 'Veracity Trading Suite';

  const fallback = document.createElement('div');
  fallback.className = 'vts-intro__fallback';
  fallback.textContent = 'VERACITY\nTRADING SUITE';
  fallback.setAttribute('aria-hidden', 'true');

  const wipe = document.createElement('div');
  wipe.className = 'vts-intro__wipe';

  overlay.appendChild(logo);
  overlay.appendChild(fallback);
  overlay.appendChild(wipe);

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

    const totalDurationMs = 2300;
    window.setTimeout(removeOverlay, totalDurationMs);
  };

  const safetyTimeoutMs = 2600;
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
