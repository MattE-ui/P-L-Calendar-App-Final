(() => {
  const storageKey = 'vts_intro_shown';
  if (sessionStorage.getItem(storageKey) === 'true') {
    return;
  }

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const overlay = document.createElement('div');
  overlay.className = 'intro-splash';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('role', 'presentation');

  const logoSvg = `
    <svg class="intro-splash__logo-svg" viewBox="0 0 820 240" role="img" aria-label="Veracity Trading Suite">
      <defs>
        <mask id="vts-logo-mask" maskUnits="userSpaceOnUse">
          <rect width="820" height="240" fill="black"></rect>
          <path class="intro-splash__v-mask" d="M120 20 L260 220 L400 20 L470 20 L260 240 L50 20 Z" fill="white"></path>
        </mask>
      </defs>
      <rect width="820" height="240" fill="transparent"></rect>
      <image class="intro-splash__logo-full" href="/static/brand/veracity-logo.svg" width="820" height="240"></image>
      <image class="intro-splash__logo-reveal" href="/static/brand/veracity-logo.svg" width="820" height="240" mask="url(#vts-logo-mask)"></image>
    </svg>
  `;

  const cutoutSvg = `
    <svg class="intro-splash__cutout" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <mask id="vts-cutout-mask" maskUnits="userSpaceOnUse">
          <rect width="100" height="100" fill="white"></rect>
          <path class="intro-splash__cutout-v" d="M18 5 L50 95 L82 5 L95 5 L50 98 L5 5 Z" fill="black"></path>
        </mask>
      </defs>
      <rect width="100" height="100" fill="#0b1320" mask="url(#vts-cutout-mask)"></rect>
    </svg>
  `;

  const logoWrap = document.createElement('div');
  logoWrap.className = 'intro-splash__logo';
  logoWrap.innerHTML = logoSvg;
  overlay.appendChild(logoWrap);

  const cutoutWrap = document.createElement('div');
  cutoutWrap.className = 'intro-splash__cutout-wrap';
  cutoutWrap.innerHTML = cutoutSvg;
  overlay.appendChild(cutoutWrap);

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
      try {
        sessionStorage.setItem(storageKey, 'true');
      } catch (error) {
        console.warn('Intro splash session storage unavailable:', error);
      }
    }, delayMs);
  };

  if (prefersReducedMotion) {
    overlay.classList.add('intro-splash--reduced');
    finalizeIntro(300);
    return;
  }

  overlay.classList.add('intro-splash--animate');
  // Adjust totalDurationMs + CSS keyframes together to tweak the full intro timing.
  const totalDurationMs = 2400;
  finalizeIntro(totalDurationMs);
})();
