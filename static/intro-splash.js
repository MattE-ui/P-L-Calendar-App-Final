(() => {
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
      <g class="intro-splash__logo-full">
        <g id="vts-chart">
          <path
            d="M420 86 L515 56 L600 80 C628 88 655 86 685 72 L718 56 M718 56 L710 78 L734 70 Z"
            fill="#7fc969"
            stroke="#7fc969"
            stroke-width="10"
            stroke-linecap="round"
            stroke-linejoin="round"
            pathLength="1"
          ></path>
        </g>
        <g id="vts-candles" fill="#7fc969">
          <g>
            <rect x="585" y="52" width="36" height="54" rx="3"></rect>
            <rect x="601" y="40" width="4" height="18" rx="2"></rect>
            <rect x="601" y="102" width="4" height="16" rx="2"></rect>
          </g>
          <g>
            <rect x="646" y="32" width="38" height="68" rx="3"></rect>
            <rect x="663" y="18" width="4" height="18" rx="2"></rect>
            <rect x="663" y="100" width="4" height="18" rx="2"></rect>
          </g>
        </g>
        <g id="vts-wordmark" fill="#ffffff">
          <text
            x="410"
            y="160"
            text-anchor="middle"
            font-family="'Montserrat', 'Poppins', 'Segoe UI', Arial, sans-serif"
            font-size="72"
            font-weight="700"
            letter-spacing="8"
          >
            VERACITY
          </text>
        </g>
        <g id="vts-subtitle">
          <rect x="180" y="176" width="460" height="40" rx="6" fill="#2b313b"></rect>
          <text
            x="410"
            y="203"
            text-anchor="middle"
            font-family="'Montserrat', 'Poppins', 'Segoe UI', Arial, sans-serif"
            font-size="26"
            font-weight="600"
            letter-spacing="6"
            fill="#ffffff"
          >
            TRADING SUITE
          </text>
        </g>
      </g>
      <g class="intro-splash__logo-reveal" mask="url(#vts-logo-mask)">
        <use href="#vts-chart"></use>
        <use href="#vts-candles"></use>
        <use href="#vts-wordmark"></use>
        <use href="#vts-subtitle"></use>
      </g>
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
    }, delayMs);
  };

  if (prefersReducedMotion) {
    overlay.classList.add('intro-splash--reduced');
    finalizeIntro(200);
    return;
  }

  // Adjust totalDurationMs + CSS keyframes together to tweak the full intro timing.
  const totalDurationMs = 2300;
  requestAnimationFrame(() => {
    overlay.classList.add('intro-splash--animate');
    finalizeIntro(totalDurationMs);
  });
})();
