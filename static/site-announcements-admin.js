(function initSiteAnnouncementsAdmin() {
  const $ = (selector) => document.querySelector(selector);
  const listEl = $('#announcement-admin-list');
  const feedbackEl = $('#announcement-admin-feedback');
  const form = $('#announcement-admin-form');

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'include', ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function toDatetimeLocal(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function toIsoOrNull(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function setFeedback(message, tone = 'info') {
    if (!feedbackEl) return;
    feedbackEl.textContent = message || '';
    feedbackEl.classList.remove('error', 'success');
    if (tone === 'error') feedbackEl.classList.add('error');
    if (tone === 'success') feedbackEl.classList.add('success');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderPreview() {
    const type = $('#announcement-type')?.value || 'info';
    $('#announcement-preview-badge').textContent = type.toUpperCase();
    $('#announcement-preview-badge').className = `site-announcement-badge site-announcement-badge--${type}`;
    $('#announcement-preview-title').textContent = $('#announcement-title')?.value || 'Announcement title';
    $('#announcement-preview-body').textContent = $('#announcement-body')?.value || 'Preview text.';
  }

  function formPayload() {
    return {
      title: $('#announcement-title').value.trim(),
      body: $('#announcement-body').value.trim(),
      type: $('#announcement-type').value,
      priority: Number($('#announcement-priority').value || 0),
      isPublished: $('#announcement-published').checked,
      startsAt: toIsoOrNull($('#announcement-starts').value),
      endsAt: toIsoOrNull($('#announcement-ends').value),
      requireAcknowledgement: $('#announcement-require-ack').checked,
      ctaLabel: $('#announcement-cta-label').value.trim() || null,
      ctaUrl: $('#announcement-cta-url').value.trim() || null
    };
  }

  function resetForm() {
    $('#announcement-id').value = '';
    form.reset();
    $('#announcement-priority').value = '0';
    $('#announcement-type').value = 'info';
    renderPreview();
  }

  function hydrateForm(item) {
    $('#announcement-id').value = item.id;
    $('#announcement-title').value = item.title || '';
    $('#announcement-body').value = item.body || '';
    $('#announcement-type').value = item.type || 'info';
    $('#announcement-priority').value = String(item.priority ?? 0);
    $('#announcement-published').checked = !!item.isPublished;
    $('#announcement-require-ack').checked = !!item.requireAcknowledgement;
    $('#announcement-starts').value = toDatetimeLocal(item.startsAt);
    $('#announcement-ends').value = toDatetimeLocal(item.endsAt);
    $('#announcement-cta-label').value = item.ctaLabel || '';
    $('#announcement-cta-url').value = item.ctaUrl || '';
    renderPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function removeAnnouncement(id) {
    if (!window.confirm('Delete this announcement?')) return;
    await api(`/api/admin/site-announcements/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setFeedback('Announcement deleted.', 'success');
    await loadAnnouncements();
  }

  function renderList(items) {
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = '<p class="helper">No announcements yet.</p>';
      return;
    }
    listEl.innerHTML = '';
    items.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'card';
      card.style.marginTop = '10px';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
          <div>
            <span class="site-announcement-badge site-announcement-badge--${escapeHtml(item.type)}">${escapeHtml(String(item.type || 'info').toUpperCase())}</span>
            <h3 style="margin-top:8px;">${escapeHtml(item.title)}</h3>
            <p class="helper">Priority ${item.priority || 0} • ${item.isPublished ? 'Published' : 'Draft'}${item.requireAcknowledgement ? ' • Ack required' : ''}</p>
            <p style="white-space:pre-wrap;">${escapeHtml(item.body)}</p>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;min-width:120px;">
            <button class="ghost" data-action="edit" data-id="${item.id}">Edit</button>
            <button class="ghost" data-action="toggle" data-id="${item.id}">${item.isPublished ? 'Unpublish' : 'Publish'}</button>
            <button class="ghost" data-action="delete" data-id="${item.id}">Delete</button>
          </div>
        </div>`;
      listEl.appendChild(card);
    });
  }

  async function loadAnnouncements() {
    try {
      const payload = await api('/api/admin/site-announcements');
      const items = Array.isArray(payload.announcements) ? payload.announcements : [];
      renderList(items);
      listEl.onclick = async (event) => {
        const btn = event.target.closest('button[data-action]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        const target = items.find((item) => item.id === id);
        if (!target) return;
        try {
          if (action === 'edit') hydrateForm(target);
          if (action === 'toggle') {
            await api(`/api/admin/site-announcements/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ isPublished: !target.isPublished })
            });
            setFeedback('Announcement updated.', 'success');
            await loadAnnouncements();
          }
          if (action === 'delete') {
            await removeAnnouncement(id);
          }
        } catch (error) {
          setFeedback(error.message || 'Action failed.', 'error');
        }
      };
    } catch (error) {
      setFeedback(error.message || 'Unable to load announcements.', 'error');
    }
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = $('#announcement-id').value;
    const payload = formPayload();
    try {
      await api(id ? `/api/admin/site-announcements/${encodeURIComponent(id)}` : '/api/admin/site-announcements', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setFeedback('Announcement saved.', 'success');
      resetForm();
      await loadAnnouncements();
    } catch (error) {
      setFeedback(error.message || 'Unable to save announcement.', 'error');
    }
  });

  $('#announcement-form-reset')?.addEventListener('click', resetForm);
  form?.addEventListener('input', renderPreview);
  resetForm();
  loadAnnouncements();
})();
