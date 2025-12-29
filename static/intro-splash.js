(() => {
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const overlay = document.createElement('div');
  overlay.className = 'intro-splash';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('role', 'presentation');

  const logoWrap = document.createElement('div');
  logoWrap.className = 'intro-splash__logo';
  overlay.appendChild(logoWrap);

  const mountOverlay = () => {
    document.body.appendChild(overlay);
  };

  if (document.body) {
    mountOverlay();
  } else {
    window.addEventListener('DOMContentLoaded', mountOverlay, { once: true });
  }

  const finalizeIntro = (delayMs) => {
    window.setTimeout(() => {
      overlay.remove();
    }, delayMs);
  };

  if (prefersReducedMotion) {
    logoWrap.innerHTML = '<img src="/static/brand/veracity-logo.svg" alt="" class="intro-splash__img" />';
    overlay.classList.add('intro-splash--reduced');
    finalizeIntro(550);
    return;
  }

  fetch('/static/brand/veracity-logo.svg')
    .then((response) => response.text())
    .then((svgMarkup) => {
      logoWrap.innerHTML = svgMarkup;
      overlay.classList.add('intro-splash--animate');
      // Adjust totalDurationMs + CSS keyframes together to tweak the full intro timing.
      const totalDurationMs = 2100;
      finalizeIntro(totalDurationMs);
    })
    .catch((error) => {
      console.warn('Unable to load intro logo:', error);
      overlay.classList.add('intro-splash--reduced');
      finalizeIntro(400);
    });
})();
