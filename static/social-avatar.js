(function initSocialAvatarHelpers() {
  const FALLBACK_INITIAL = 'V';

  function deriveInitials(nickname) {
    if (typeof nickname !== 'string') return FALLBACK_INITIAL;
    const cleaned = nickname.trim().replace(/\s+/g, ' ');
    if (!cleaned) return FALLBACK_INITIAL;
    const parts = cleaned.split(' ').filter(Boolean);
    if (!parts.length) return FALLBACK_INITIAL;
    const chars = parts.slice(0, 2).map(part => part[0]?.toUpperCase()).filter(Boolean);
    return chars.length ? chars.join('').slice(0, 2) : FALLBACK_INITIAL;
  }

  function readAvatarData(identity = {}) {
    const nickname = identity.nickname || identity.counterparty_nickname || '';
    const avatarUrl = identity.avatar_url || identity.counterparty_avatar_url || identity.avatarUrl || '';
    const initials = identity.avatar_initials || identity.counterparty_avatar_initials || deriveInitials(nickname);
    return { nickname, avatarUrl, initials: initials || FALLBACK_INITIAL };
  }

  function createAvatar(identity = {}, size = 'md') {
    const data = readAvatarData(identity);
    const node = document.createElement('span');
    node.className = `social-avatar social-avatar--${size}`;
    node.setAttribute('aria-label', data.nickname ? `${data.nickname} avatar` : 'Trader avatar');

    const fallback = document.createElement('span');
    fallback.className = 'social-avatar__fallback';
    fallback.textContent = data.initials;
    node.appendChild(fallback);

    if (data.avatarUrl) {
      const image = document.createElement('img');
      image.className = 'social-avatar__image';
      image.src = data.avatarUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('load', () => {
        node.classList.add('has-image');
      });
      image.addEventListener('error', () => {
        image.remove();
        node.classList.remove('has-image');
      });
      node.appendChild(image);
    }

    return node;
  }

  window.VeracitySocialAvatar = {
    deriveInitials,
    createAvatar,
    readAvatarData
  };
})();
