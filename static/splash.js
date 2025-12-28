(() => {
  const splash = document.querySelector('.splash-screen');
  if (!splash) return;

  document.body.classList.add('has-splash');

  const cleanup = () => {
    splash.remove();
    document.body.classList.remove('has-splash');
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion) {
    splash.addEventListener('animationend', cleanup, { once: true });
  }

  const duration = reduceMotion ? 1200 : 3200;
  setTimeout(() => {
    if (document.body.contains(splash)) {
      cleanup();
    }
  }, duration);
})();
