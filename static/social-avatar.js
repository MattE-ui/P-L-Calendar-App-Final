(function initSocialAvatarHelpers() {
  const FALLBACK_INITIAL = 'V';

  // 9 colour ramps — avoids red/danger so avatars never read as errors.
  const AVATAR_COLORS = [
    { bg: 'rgba(88,166,255,0.18)',  border: 'rgba(88,166,255,0.35)',  text: '#a8ccff' }, // info blue
    { bg: 'rgba(16,185,129,0.18)',  border: 'rgba(16,185,129,0.35)',  text: '#7de8c0' }, // success green
    { bg: 'rgba(227,179,65,0.18)',  border: 'rgba(227,179,65,0.35)',  text: '#f0cf78' }, // warning amber
    { bg: 'rgba(6,182,212,0.18)',   border: 'rgba(6,182,212,0.35)',   text: '#7de8f8' }, // teal
    { bg: 'rgba(139,92,246,0.18)',  border: 'rgba(139,92,246,0.35)',  text: '#c4b5fd' }, // purple
    { bg: 'rgba(245,158,11,0.18)',  border: 'rgba(245,158,11,0.35)',  text: '#fcd34d' }, // orange
    { bg: 'rgba(14,165,233,0.18)',  border: 'rgba(14,165,233,0.35)',  text: '#7dd3fc' }, // sky
    { bg: 'rgba(52,211,153,0.18)',  border: 'rgba(52,211,153,0.35)',  text: '#6ee7b7' }, // emerald
    { bg: 'rgba(99,102,241,0.18)',  border: 'rgba(99,102,241,0.35)',  text: '#a5b4fc' }, // indigo
  ];

  // djb2-style hash — stable across calls for the same string.
  function hashString(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(h, 33) ^ str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  // Public: returns one of the 9 colour objects for a given seed string (nickname or user ID).
  function getAvatarColor(seed) {
    if (!seed) return AVATAR_COLORS[0];
    return AVATAR_COLORS[hashString(String(seed)) % AVATAR_COLORS.length];
  }

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
    const color = getAvatarColor(data.nickname || data.initials);

    const node = document.createElement('span');
    node.className = `social-avatar social-avatar--${size}`;
    node.setAttribute('aria-label', data.nickname ? `${data.nickname} avatar` : 'Trader avatar');
    // Seeded colour overrides the static green gradient from CSS.
    node.style.background = color.bg;
    node.style.borderColor = color.border;
    node.style.color = color.text;

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
      image.addEventListener('load', () => { node.classList.add('has-image'); });
      image.addEventListener('error', () => {
        image.remove();
        node.classList.remove('has-image');
      });
      node.appendChild(image);
      if (image.complete && image.naturalWidth > 0) {
        node.classList.add('has-image');
      }
    }

    return node;
  }

  // Thin wrapper — seed can be a string (name/id) or an identity object.
  // Delegates to createAvatar so the two code paths never drift.
  function createSeededAvatar(seed, size = 'md') {
    const identity = typeof seed === 'string' ? { nickname: seed } : (seed || {});
    return createAvatar(identity, size);
  }

  window.VeracitySocialAvatar = {
    deriveInitials,
    createAvatar,
    createSeededAvatar,
    readAvatarData,
    getAvatarColor,
    hashString,
  };
})();
