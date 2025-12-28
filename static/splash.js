(() => {
  const splash = document.querySelector('.splash-screen');
  if (!splash) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    splash.remove();
    return;
  }

  document.body.classList.add('has-splash');

  const cleanup = () => {
    splash.remove();
    document.body.classList.remove('has-splash');
  };

  splash.addEventListener('animationend', cleanup, { once: true });

  setTimeout(() => {
    if (document.body.contains(splash)) {
      cleanup();
    }
  }, 3200);
})();
