(function initSecurityPage() {
  const { api, setText } = window.AccountCenter;
  document.getElementById('security-save')?.addEventListener('click', async () => {
    try {
      const currentPassword = document.getElementById('security-current').value;
      const newPassword = document.getElementById('security-new').value;
      await api('/api/account/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword })
      });
      setText('security-status', 'Password updated successfully.');
      document.getElementById('security-current').value = '';
      document.getElementById('security-new').value = '';
    } catch (error) {
      setText('security-status', error.message);
    }
  });
})();
