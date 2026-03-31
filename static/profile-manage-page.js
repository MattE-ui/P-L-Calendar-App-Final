(async function initManageProfile() {
  const { api, setText } = window.AccountCenter;

  function setAvatar(profile) {
    const slot = document.getElementById('manage-avatar-preview');
    if (!slot) return;
    if (profile?.avatarUrl) {
      slot.innerHTML = `<img src="${profile.avatarUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      const initials = (profile?.avatarInitials || profile?.nickname || profile?.username || 'VT').slice(0, 2).toUpperCase();
      slot.textContent = initials;
    }
  }

  async function load() {
    const profile = await api('/api/profile');
    document.getElementById('manage-username').value = profile.username || '';
    document.getElementById('manage-email').value = profile.username || '';
    document.getElementById('manage-nickname').value = profile.nickname || '';
    document.getElementById('manage-portfolio').value = Number(profile.portfolio || 0).toFixed(2);
    document.getElementById('manage-net').value = Number(profile.netDepositsTotal || profile.initialNetDeposits || 0).toFixed(2);
    setAvatar(profile);
  }

  document.getElementById('manage-save-nickname')?.addEventListener('click', async () => {
    try {
      const nickname = document.getElementById('manage-nickname').value.trim();
      await api('/api/account/nickname', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname }) });
      setText('manage-identity-status', 'Nickname updated.');
    } catch (error) { setText('manage-identity-status', error.message); }
  });

  document.getElementById('manage-avatar-upload')?.addEventListener('click', () => document.getElementById('manage-avatar-input')?.click());
  document.getElementById('manage-avatar-input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api('/api/profile/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: reader.result }) });
        setText('manage-avatar-status', 'Avatar updated.');
        await load();
      } catch (error) { setText('manage-avatar-status', error.message); }
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('manage-avatar-remove')?.addEventListener('click', async () => {
    try {
      await api('/api/profile/avatar', { method: 'DELETE' });
      setText('manage-avatar-status', 'Avatar removed.');
      await load();
    } catch (error) { setText('manage-avatar-status', error.message); }
  });

  document.getElementById('manage-save-baseline')?.addEventListener('click', async () => {
    try {
      const portfolio = Number(document.getElementById('manage-portfolio').value);
      const netDeposits = Number(document.getElementById('manage-net').value);
      await api('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portfolio, netDeposits }) });
      setText('manage-baseline-status', 'Portfolio baseline saved.');
    } catch (error) { setText('manage-baseline-status', error.message); }
  });

  load().catch((error) => setText('manage-baseline-status', error.message));
})();
