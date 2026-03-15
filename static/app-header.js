(function initGlobalHeader() {
  if (document.getElementById('global-app-header')) return;

  const path = window.location.pathname || '/';
  const isDashboardRoute = path === '/' || path.endsWith('/index.html');
  const activeKey = (() => {
    if (path.endsWith('/analytics.html')) return 'analytics';
    if (path.endsWith('/trades.html')) return 'trades';
    if (path.endsWith('/transactions.html')) return 'portfolio';
    if (path.endsWith('/social.html')) return 'social';
    if (path.endsWith('/profile.html')) return 'profile';
    if (isDashboardRoute) return 'dashboard';
    return '';
  })();

  const navItems = [
    { key: 'dashboard', label: 'Dashboard', href: '/' },
    { key: 'trades', label: 'Trades', href: '/trades.html' },
    { key: 'analytics', label: 'Analytics', href: '/analytics.html' },
    { key: 'portfolio', label: 'Transactions', href: '/transactions.html' },
    { key: 'social', label: 'Social', href: '/social.html' },
    { key: 'profile', label: 'Profile', href: '/profile.html' }
  ];

  const header = document.createElement('header');
  header.id = 'global-app-header';
  header.className = 'app-shell-header';

  header.innerHTML = `
    <div class="app-shell-header__inner">
      <a class="app-shell-brand" href="/" aria-label="Veracity dashboard home">
        <img class="app-shell-brand__logo" src="static/veracity-logo.png" alt="Veracity Trading Suite">
      </a>
      <nav class="app-shell-nav" aria-label="Primary">
        ${navItems.map((item) => `<a id="${item.key}-btn" class="app-shell-nav__link ${activeKey === item.key ? 'is-active' : ''}" href="${item.href}">${item.label}</a>`).join('')}
      </nav>
      <div class="app-shell-actions">
        <button id="quick-settings-btn" class="ghost app-shell-action-btn" type="button">Settings</button>
        <button id="devtools-btn" class="ghost app-shell-action-btn is-hidden" type="button">Devtools</button>
        <button id="logout-btn" class="ghost app-shell-action-btn" type="button">Logout</button>
      </div>
    </div>
  `;

  document.body.prepend(header);
  document.body.classList.add('with-app-shell-header');
})();
