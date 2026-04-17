(() => {
  'use strict';

  const PAGE_ROUTES = {
    dashboard: '/',
    trades: '/trades',
    calendar: '/calendar',
    profile: '/profile',
    leaderboard: '/social/leaderboard',
    groups: '/social/groups'
  };

  // ── STATE ─────────────────────────────────────────────────────────────────
  const state = {
    currentUser: null,
    chats: [],
    activeGroupId: null,
    messages: [],
    chatInfo: null,
    pinnedMessage: null,
    typingUsers: [],
    suggestions: null,
    replyTo: null,
    sending: false,
    renderedMsgIds: new Set(),   // tracks which msg IDs are in the DOM
    msgPollTimer: null,
    sidebarPollTimer: null,
    typingTimer: null,
    isTypingActive: false,
    ac: {
      visible: false,
      items: [],
      selected: 0,
      trigger: null,
      triggerIndex: 0
    }
  };

  // ── DOM REFS ──────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const sidebarEl       = $('gc-sidebar');
  const sidebarOverlay  = $('gc-sidebar-overlay');
  const sidebarList     = $('gc-sidebar-list');
  const noGroupEl       = $('gc-no-group');
  const chatViewEl      = $('gc-chat-view');
  const headerNameEl    = $('gc-header-name');
  const headerMetaEl    = $('gc-header-meta');
  const headerActionsEl = $('gc-header-actions');
  const pinnedEl        = $('gc-pinned');
  const pinnedTextEl    = $('gc-pinned-text');
  const pinnedUnpinBtn  = $('gc-pinned-unpin');
  const messagesEl      = $('gc-messages');
  const typingEl        = $('gc-typing');
  const replyBarEl      = $('gc-reply-bar');
  const replyBarNameEl  = $('gc-reply-bar-name');
  const replyBarPreview = $('gc-reply-bar-preview');
  const replyCancelBtn  = $('gc-reply-cancel');
  const inputArea       = $('gc-input-area');
  const inputWrap       = $('gc-input-wrap');
  const textarea        = $('gc-textarea');
  const sendBtn         = $('gc-send-btn');
  const shareTradeBtn   = $('gc-share-trade-btn');
  const lockedNotice    = $('gc-locked-notice');
  const autocompleteEl  = $('gc-autocomplete');
  const menuBtn         = $('gc-menu-btn');

  // ── UTILS ─────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const today    = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today - 86400000);
    const msgDay   = new Date(d); msgDay.setHours(0,0,0,0);
    if (msgDay.getTime() === today.getTime()) return 'Today';
    if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function sameDay(a, b) {
    const da = new Date(a), db = new Date(b);
    return da.getFullYear() === db.getFullYear() &&
           da.getMonth() === db.getMonth() &&
           da.getDate() === db.getDate();
  }

  function withinWindow(a, b) {
    return Math.abs(new Date(a) - new Date(b)) < 5 * 60 * 1000;
  }

  function fmtPrice(val) {
    if (val == null || !isFinite(Number(val))) return '—';
    return '$' + Number(val).toFixed(2);
  }

  // Render message text: highlight @mentions and #page-links using entity data
  function renderText(rawText, mentions, pageLinks, entities) {
    if (!rawText) return '';

    // Build spans from all entities
    const allSpans = [];
    (mentions || []).forEach(m => {
      if (m.start != null && m.end != null)
        allSpans.push({ start: m.start, end: m.end, kind: 'mention', data: m });
    });
    (pageLinks || []).forEach(p => {
      if (p.start != null && p.end != null)
        allSpans.push({ start: p.start, end: p.end, kind: 'page', data: p });
    });
    (entities || []).filter(e => e.type === 'mention' || e.type === 'page_link').forEach(e => {
      if (e.start != null && e.end != null)
        allSpans.push({ start: e.start, end: e.end, kind: e.type === 'page_link' ? 'page' : 'mention', data: e });
    });

    if (!allSpans.length) return renderTextSimple(rawText);

    allSpans.sort((a, b) => a.start - b.start);
    let result = '', cursor = 0;
    for (const span of allSpans) {
      if (span.start < cursor) continue;
      result += esc(rawText.slice(cursor, span.start));
      const chunk = rawText.slice(span.start, span.end + 1);
      if (span.kind === 'mention') {
        const isEveryone = span.data.type === 'everyone' || span.data.mentionType === 'everyone';
        result += `<span class="gc-mention${isEveryone ? ' gc-mention--everyone' : ''}">${esc(chunk)}</span>`;
      } else {
        const route = PAGE_ROUTES[span.data.slug] || '#';
        result += `<a class="gc-page-link" href="${esc(route)}">${esc(chunk)}</a>`;
      }
      cursor = span.end + 1;
    }
    result += esc(rawText.slice(cursor));
    return result;
  }

  function renderTextSimple(rawText) {
    let html = esc(rawText);
    html = html.replace(/@everyone\b/g, '<span class="gc-mention gc-mention--everyone">@everyone</span>');
    html = html.replace(/@(\w+)/g, '<span class="gc-mention">@$1</span>');
    const pageRe = new RegExp(`#(${Object.keys(PAGE_ROUTES).join('|')})\\b`, 'g');
    html = html.replace(pageRe, (_, slug) =>
      `<a class="gc-page-link" href="${esc(PAGE_ROUTES[slug] || '#')}">#${slug}</a>`
    );
    return html;
  }

  function hexAlpha(hex, a) {
    hex = hex.replace('#','');
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function makeAvatar(msg) {
    if (window.VeracitySocialAvatar) {
      return window.VeracitySocialAvatar.createAvatar({
        nickname: msg.senderNickname,
        avatarUrl: msg.senderAvatarUrl,
        avatar_initials: msg.senderAvatarInitials
      }, 'sm');
    }
    const s = document.createElement('span');
    s.className = 'social-avatar social-avatar--sm';
    s.textContent = (msg.senderAvatarInitials || msg.senderNickname || '?')[0].toUpperCase();
    return s;
  }

  // ── API ───────────────────────────────────────────────────────────────────
  async function api(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
    return data;
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  async function init() {
    try {
      const me = await api('/api/social/me');
      const p = me.profile || {};
      state.currentUser = {
        userId: p.user_id || '',
        nickname: me.nickname || p.user_id || '',
        avatarUrl: p.avatar_url || '',
        avatarInitials: p.avatar_initials || ''
      };
    } catch { return; }

    const urlParams = new URLSearchParams(location.search);
    const target = urlParams.get('group') || localStorage.getItem('gc_last_group');

    await loadSidebar();

    if (target && state.chats.some(c => c.groupId === target)) {
      selectGroup(target);
    }

    state.sidebarPollTimer = setInterval(loadSidebar, 12000);
    bindEvents();
  }

  // ── SIDEBAR ───────────────────────────────────────────────────────────────
  async function loadSidebar() {
    try {
      const data = await api('/api/group-chats');
      state.chats = data.chats || [];
      renderSidebar();
    } catch {}
  }

  function renderSidebar() {
    sidebarList.innerHTML = '';
    if (!state.chats.length) {
      sidebarList.innerHTML = '<div style="padding:16px 14px;font-size:13px;color:var(--text-dim);">No groups yet. <a href="/social/groups" style="color:var(--accent);">Create one</a></div>';
      return;
    }
    state.chats.forEach(chat => {
      const item = document.createElement('div');
      item.className = 'gc-sidebar-item' +
        (chat.groupId === state.activeGroupId ? ' is-active' : '') +
        (chat.unreadCount > 0 ? ' has-unread' : '');
      item.dataset.groupId = chat.groupId;
      const lock = chat.isLocked ? '<span class="gc-sidebar-lock-icon">🔒</span>' : '';
      const preview = chat.latestMessage
        ? `${chat.latestMessage.senderNickname}: ${(chat.latestMessage.rawText || chat.latestMessage.content || '').slice(0, 55)}`
        : 'No messages yet';
      item.innerHTML = `
        <div class="gc-sidebar-item-info">
          <div class="gc-sidebar-item-name"># ${esc(chat.groupName)} ${lock}</div>
          <div class="gc-sidebar-item-preview">${esc(preview)}</div>
        </div>
        ${chat.unreadCount > 0 ? `<span class="gc-sidebar-item-badge">${chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span>` : ''}
      `;
      item.addEventListener('click', () => { closeMobileSidebar(); selectGroup(chat.groupId); });
      sidebarList.appendChild(item);
    });
  }

  // ── SELECT GROUP ──────────────────────────────────────────────────────────
  async function selectGroup(groupId) {
    if (state.activeGroupId === groupId) return;
    stopPoll();
    state.activeGroupId = groupId;
    state.messages = [];
    state.chatInfo = null;
    state.replyTo = null;
    state.typingUsers = [];
    state.renderedMsgIds.clear();

    const url = new URL(location.href);
    url.searchParams.set('group', groupId);
    history.replaceState(null, '', url.toString());
    localStorage.setItem('gc_last_group', groupId);

    noGroupEl.style.display = 'none';
    chatViewEl.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
    messagesEl.innerHTML = '<div style="padding:24px 16px;color:var(--text-dim);font-size:13px;">Loading…</div>';
    replyBarEl.style.display = 'none';
    state.replyTo = null;
    hideAutocomplete();
    renderSidebar();

    await loadMessages(true);
    startPoll();
  }

  // ── LOAD MESSAGES ─────────────────────────────────────────────────────────
  async function loadMessages(initial = false) {
    if (!state.activeGroupId) return;
    try {
      const data = await api(`/api/group-chats/${state.activeGroupId}/messages`);
      state.chatInfo = data.chat;
      state.pinnedMessage = data.pinnedMessage || null;
      state.typingUsers = data.typingUsers || [];
      state.suggestions = data.suggestionsSeed || null;

      renderHeader();
      renderPinned();
      renderTyping();

      const incoming = data.messages || [];

      if (initial || state.renderedMsgIds.size === 0) {
        // First load: full render
        state.messages = incoming;
        renderMessages(true);
      } else {
        const atBottom = isNearBottom();
        // Update any deleted messages that are already rendered
        incoming.forEach(m => {
          if (m.deletedAt && state.renderedMsgIds.has(m.id)) {
            const el = messagesEl.querySelector(`[data-msg-id="${m.id}"]`);
            if (el) {
              const contentEl = el.querySelector('.gc-msg-content');
              if (contentEl && !contentEl.classList.contains('is-deleted')) {
                contentEl.textContent = 'This message was deleted.';
                contentEl.className = 'gc-msg-content is-deleted';
                el.querySelector('.gc-msg-actions')?.remove();
              }
            }
          }
        });

        // Append truly new messages (not already in DOM, not our own optimistic ones)
        const newMsgs = incoming.filter(m =>
          !state.renderedMsgIds.has(m.id) &&
          !state.messages.some(x => x._optimistic && x.rawText === m.rawText &&
            Math.abs(new Date(x.createdAt) - new Date(m.createdAt)) < 10000)
        );

        if (newMsgs.length) {
          state.messages = [...state.messages.filter(m => !m._optimistic), ...incoming];
          // Remove replaced optimistic nodes
          messagesEl.querySelectorAll('[data-msg-id^="optimistic-"]').forEach(el => el.remove());
          appendMessages(newMsgs, incoming);
          if (atBottom) scrollToBottom();
        } else {
          // Keep our optimistic messages but update state
          const realMsgs = incoming.filter(m => !m._optimistic);
          if (realMsgs.length !== state.messages.filter(m => !m._optimistic).length) {
            state.messages = [...state.messages.filter(m => m._optimistic), ...incoming];
          }
        }
      }

      markRead();
      const entry = state.chats.find(c => c.groupId === state.activeGroupId);
      if (entry && entry.unreadCount > 0) { entry.unreadCount = 0; renderSidebar(); }
    } catch (e) {
      if (e.status === 403 || e.status === 404) {
        messagesEl.innerHTML = '<div style="padding:24px 16px;color:var(--text-dim);font-size:13px;">Access lost. <a href="/social/groups" style="color:var(--accent);">Go to groups</a></div>';
        stopPoll();
      }
    }
  }

  // ── POLLING ───────────────────────────────────────────────────────────────
  function startPoll() {
    stopPoll();
    state.msgPollTimer = setInterval(() => loadMessages(false), 3000);
  }
  function stopPoll() {
    clearInterval(state.msgPollTimer);
    state.msgPollTimer = null;
  }

  function isNearBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;
  }
  function scrollToBottom(smooth = false) {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  }

  // ── RENDER HEADER ─────────────────────────────────────────────────────────
  function renderHeader() {
    const info = state.chatInfo;
    if (!info) return;
    headerNameEl.textContent = info.groupName;
    headerMetaEl.textContent = `${info.participantCount} member${info.participantCount !== 1 ? 's' : ''}`;
    document.title = `#${info.groupName} · Chat`;
    textarea.placeholder = `Message #${info.groupName}`;

    headerActionsEl.innerHTML = '';
    if (info.canModerate) {
      const lockBtn = document.createElement('button');
      lockBtn.className = 'gc-header-btn' + (info.isLocked ? ' is-locked' : '');
      lockBtn.textContent = info.isLocked ? '🔒 Locked' : '🔓 Lock chat';
      lockBtn.addEventListener('click', toggleLock);
      headerActionsEl.appendChild(lockBtn);
    }

    const canSend = info.canSend !== false;
    inputWrap.style.display = canSend ? 'flex' : 'none';
    lockedNotice.style.display = canSend ? 'none' : 'block';
  }

  // ── RENDER PINNED ─────────────────────────────────────────────────────────
  function renderPinned() {
    const pm = state.pinnedMessage;
    pinnedEl.style.display = pm ? 'flex' : 'none';
    if (!pm) return;
    pinnedTextEl.textContent = `${pm.senderNickname}: ${pm.rawText || pm.content || ''}`;
    pinnedUnpinBtn.style.display = state.chatInfo?.canModerate ? 'inline-flex' : 'none';
  }

  // ── RENDER TYPING ─────────────────────────────────────────────────────────
  function renderTyping() {
    const users = state.typingUsers || [];
    if (!users.length) { typingEl.innerHTML = ''; return; }
    let label = users.length === 1 ? `${esc(users[0].nickname)} is typing`
      : users.length === 2 ? `${esc(users[0].nickname)} and ${esc(users[1].nickname)} are typing`
      : `${users.length} people are typing`;
    typingEl.innerHTML = `
      <span class="gc-typing-dots"><span class="gc-typing-dot"></span><span class="gc-typing-dot"></span><span class="gc-typing-dot"></span></span>
      <span>${label}…</span>`;
  }

  // ── FULL MESSAGE RENDER ───────────────────────────────────────────────────
  function renderMessages(scrollToEnd = false) {
    messagesEl.innerHTML = '';
    state.renderedMsgIds.clear();
    if (!state.messages.length) {
      messagesEl.innerHTML = '<div style="padding:32px 16px;color:var(--text-dim);font-size:13px;text-align:center;">No messages yet. Start the conversation! 👋</div>';
      return;
    }
    let lastDate = null, lastSenderId = null, lastTs = null;
    state.messages.forEach((msg, i) => {
      const msgDate = msg.createdAt ? fmtDate(msg.createdAt) : null;
      if (msgDate && msgDate !== lastDate) {
        messagesEl.appendChild(makeDateDivider(msgDate));
        lastDate = msgDate;
        lastSenderId = null; lastTs = null;
      }
      const groupable = !['system','trade_event_system'].includes(msg.messageType);
      const isCont = groupable && lastSenderId === msg.senderUserId && lastTs && withinWindow(lastTs, msg.createdAt);
      const node = buildMsgNode(msg, isCont, state.messages);
      messagesEl.appendChild(node);
      state.renderedMsgIds.add(msg.id);
      if (groupable) { lastSenderId = msg.senderUserId; lastTs = msg.createdAt; }
      else { lastSenderId = null; lastTs = null; }
    });
    if (scrollToEnd) scrollToBottom();
  }

  // Append only new messages without rebuilding existing ones
  function appendMessages(newMsgs, allMsgs) {
    const msgs = allMsgs || state.messages;
    newMsgs.forEach(msg => {
      const idx = msgs.indexOf(msg);
      const prev = msgs[idx - 1];
      // Date divider if needed
      if (prev && !sameDay(prev.createdAt, msg.createdAt)) {
        messagesEl.appendChild(makeDateDivider(fmtDate(msg.createdAt)));
      } else if (!prev) {
        messagesEl.appendChild(makeDateDivider(fmtDate(msg.createdAt)));
      }
      const groupable = !['system','trade_event_system'].includes(msg.messageType);
      const isCont = groupable && prev &&
        prev.senderUserId === msg.senderUserId &&
        withinWindow(prev.createdAt, msg.createdAt);
      const node = buildMsgNode(msg, isCont, msgs);
      messagesEl.appendChild(node);
      state.renderedMsgIds.add(msg.id);
    });
  }

  function makeDateDivider(label) {
    const el = document.createElement('div');
    el.className = 'gc-date-divider';
    el.textContent = label;
    return el;
  }

  // ── BUILD MESSAGE NODE ────────────────────────────────────────────────────
  function buildMsgNode(msg, isCont, allMsgs) {
    const isMe = state.currentUser && msg.senderUserId === state.currentUser.userId;
    const canDel = state.chatInfo?.canModerate || state.chatInfo?.permissions?.canDeleteMessages || (isMe && msg.messageType === 'user_message');
    const canPin = state.chatInfo?.canModerate || state.chatInfo?.permissions?.canPinMessages;
    const isDeleted = !!msg.deletedAt;
    const isPending = !!msg._optimistic;

    // ── System ──────────────────────────────────────────────
    if (msg.messageType === 'system') {
      const el = document.createElement('div');
      el.className = 'gc-msg gc-msg--system';
      el.dataset.msgId = msg.id;
      el.innerHTML = `<span class="gc-msg-system-text">${esc(msg.content || '')}</span>`;
      return el;
    }

    // ── Trade event ─────────────────────────────────────────
    if (msg.messageType === 'trade_event_system') {
      const meta = msg.metadata || {};
      const icon = meta.eventType === 'TRADE_CLOSED' ? '📉' : meta.eventType === 'TRADE_TRIMMED' ? '✂️' : '📈';
      const price = meta.fillPrice || meta.entryPrice;
      const el = document.createElement('div');
      el.className = 'gc-msg gc-msg--trade-event';
      el.dataset.msgId = msg.id;
      el.innerHTML = `
        <div class="gc-trade-event-pill">
          <span class="gc-trade-event-icon">${icon}</span>
          <span class="gc-trade-event-content">
            ${meta.ticker ? `<strong>${esc(meta.ticker)}</strong> ` : ''}${esc(msg.content || '')}${price ? ` · ${fmtPrice(price)}` : ''}
          </span>
          <span class="gc-trade-event-time">${fmtTime(msg.createdAt)}</span>
        </div>`;
      return el;
    }

    // ── Regular / announcement / trade share ─────────────────
    const isAnnouncement = msg.messageType === 'leader_announcement';
    const isMentioned = !isDeleted && state.currentUser &&
      (msg.mentions || []).some(m => m.userId === state.currentUser.userId || m.type === 'everyone' || m.mentionType === 'everyone');

    const el = document.createElement('div');
    el.className = 'gc-msg' +
      (!isCont ? ' gc-msg--gap-before' : ' gc-msg--continuation') +
      (isAnnouncement ? ' gc-msg--announcement' : '') +
      (isMentioned ? ' gc-msg--mentioned' : '') +
      (isPending ? ' gc-msg--pending' : '');
    el.dataset.msgId = msg.id;
    if (isPending) el.style.opacity = '0.65';

    // Avatar column
    const avatarCol = document.createElement('div');
    avatarCol.className = 'gc-msg-avatar-col';
    if (isCont) {
      const mini = document.createElement('span');
      mini.className = 'gc-msg-time-mini';
      mini.textContent = fmtTime(msg.createdAt);
      avatarCol.appendChild(mini);
    } else {
      avatarCol.appendChild(makeAvatar(msg));
    }

    // Body
    const body = document.createElement('div');
    body.className = 'gc-msg-body';

    // Announcement label
    if (isAnnouncement && !isCont) {
      const lbl = document.createElement('div');
      lbl.className = 'gc-announce-label';
      lbl.textContent = '📢 Announcement';
      body.appendChild(lbl);
    }

    // Meta row
    if (!isCont) {
      const meta = document.createElement('div');
      meta.className = 'gc-msg-meta';
      const name = document.createElement('span');
      name.className = 'gc-msg-name' + (isAnnouncement ? ' gc-msg-name--leader' : '');
      name.textContent = msg.senderNickname || 'Unknown';
      meta.appendChild(name);
      (msg.senderRoleBadges || []).forEach(badge => {
        const b = document.createElement('span');
        b.className = 'gc-msg-role-badge';
        b.textContent = badge.name;
        b.style.background = hexAlpha(badge.color || '#3cb982', 0.15);
        b.style.color = badge.color || '#3cb982';
        meta.appendChild(b);
      });
      const ts = document.createElement('span');
      ts.className = 'gc-msg-time';
      ts.textContent = fmtTime(msg.createdAt);
      meta.appendChild(ts);
      body.appendChild(meta);
    }

    // Reply quote
    if (msg.replyToMessageId && !isDeleted) {
      const replied = allMsgs.find(m => m.id === msg.replyToMessageId);
      if (replied) {
        const q = document.createElement('div');
        q.className = 'gc-reply-quote';
        q.innerHTML = `<span class="gc-reply-quote-name">${esc(replied.senderNickname || 'Unknown')}</span>
          <span class="gc-reply-quote-text">${esc((replied.rawText || replied.content || '').slice(0, 120))}</span>`;
        q.addEventListener('click', () => scrollToMsg(replied.id));
        body.appendChild(q);
      }
    }

    // Content
    const content = document.createElement('div');
    content.className = 'gc-msg-content' + (isDeleted ? ' is-deleted' : '');
    if (isDeleted) {
      content.textContent = 'This message was deleted.';
    } else {
      content.innerHTML = renderText(msg.rawText || msg.content || '', msg.mentions, msg.pageLinks, msg.entities);
    }
    body.appendChild(content);

    // Trade card
    if (msg.messageType === 'trade_share' && !isDeleted) {
      const card = buildTradeCard(msg.metadata);
      if (card) body.appendChild(card);
    }

    // Hover actions
    if (!isDeleted && !isPending) {
      const actions = document.createElement('div');
      actions.className = 'gc-msg-actions';

      const mkBtn = (icon, title, cls, cb) => {
        const b = document.createElement('button');
        b.className = 'gc-msg-action-btn' + (cls ? ' ' + cls : '');
        b.title = title; b.textContent = icon;
        b.addEventListener('click', e => { e.stopPropagation(); cb(); });
        actions.appendChild(b);
      };

      mkBtn('↩', 'Reply', '', () => setReplyTo(msg));

      if (canPin && msg.messageType !== 'system') {
        const isPinned = state.chatInfo?.pinnedMessageId === msg.id;
        mkBtn('📌', isPinned ? 'Unpin' : 'Pin message', '', () =>
          isPinned ? unpinMessage() : pinMessage(msg.id)
        );
      }
      if (canDel) mkBtn('🗑', 'Delete', 'gc-msg-action-btn--danger', () => deleteMessage(msg.id));

      el.appendChild(actions);
    }

    el.appendChild(avatarCol);
    el.appendChild(body);
    return el;
  }

  function buildTradeCard(meta = {}) {
    if (!meta.ticker) return null;
    const dir = meta.direction === 'short' ? 'short' : 'long';
    const card = document.createElement('div');
    card.className = 'gc-trade-card';
    card.innerHTML = `
      <div class="gc-trade-card-head">
        <span class="gc-trade-card-ticker">${esc(meta.ticker)}</span>
        <span class="gc-trade-card-dir gc-trade-card-dir--${dir}">${dir.toUpperCase()}</span>
        <span class="gc-trade-card-status">${esc(meta.status || 'open')}</span>
      </div>
      <div class="gc-trade-card-grid">
        ${meta.entryPrice != null ? `<div class="gc-trade-card-field"><span class="gc-trade-card-label">Entry</span><span class="gc-trade-card-value">${fmtPrice(meta.entryPrice)}</span></div>` : ''}
        ${meta.stopPrice  != null ? `<div class="gc-trade-card-field"><span class="gc-trade-card-label">Stop</span><span class="gc-trade-card-value">${fmtPrice(meta.stopPrice)}</span></div>` : ''}
        ${meta.riskPercent != null ? `<div class="gc-trade-card-field"><span class="gc-trade-card-label">Risk</span><span class="gc-trade-card-value">${Number(meta.riskPercent).toFixed(1)}%</span></div>` : ''}
      </div>`;
    return card;
  }

  function scrollToMsg(id) {
    const el = messagesEl.querySelector(`[data-msg-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.background = 'rgba(88,166,255,0.1)';
    setTimeout(() => el.style.background = '', 1400);
  }

  // ── OPTIMISTIC SEND ───────────────────────────────────────────────────────
  async function sendMessage() {
    const text = textarea.value.trim();
    if (!text || state.sending) return;
    if (!state.chatInfo?.canSend) return;

    const savedText  = text;
    const savedReply = state.replyTo;
    state.sending    = true;

    // ── 1. Clear input immediately — feels instant
    textarea.value = '';
    resizeTextarea();
    sendBtn.disabled = true;
    clearReplyTo();
    hideAutocomplete();
    textarea.focus();

    // ── 2. Optimistic insert
    const tempId = 'optimistic-' + Date.now();
    const optimistic = {
      id: tempId, _optimistic: true,
      senderUserId:      state.currentUser?.userId || '',
      senderNickname:    state.currentUser?.nickname || 'You',
      senderAvatarUrl:   state.currentUser?.avatarUrl || '',
      senderAvatarInitials: state.currentUser?.avatarInitials || '',
      senderRoleBadges: [],
      messageType: 'user_message',
      content: savedText, rawText: savedText,
      entities: [], mentions: [], pageLinks: [], attachments: [],
      replyToMessageId: savedReply?.id || null,
      createdAt: new Date().toISOString(),
      deletedAt: null
    };

    const lastReal = state.messages.filter(m => !m._optimistic).slice(-1)[0];
    const isCont = lastReal &&
      lastReal.senderUserId === optimistic.senderUserId &&
      withinWindow(lastReal.createdAt, optimistic.createdAt);

    state.messages.push(optimistic);
    state.renderedMsgIds.add(tempId);

    const node = buildMsgNode(optimistic, isCont, state.messages);
    messagesEl.appendChild(node);
    scrollToBottom();

    // ── 3. Send to server (textarea already re-enabled for next msg)
    sendBtn.disabled = false;

    try {
      const resp = await api(`/api/group-chats/${state.activeGroupId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: savedText, rawText: savedText,
          replyToMessageId: savedReply?.id ?? undefined
        })
      });

      // ── 4. Replace optimistic with confirmed message
      const real = resp.message;
      if (real) {
        state.messages = state.messages.map(m => m.id === tempId ? real : m);
        state.renderedMsgIds.delete(tempId);
        state.renderedMsgIds.add(real.id);
        const domNode = messagesEl.querySelector(`[data-msg-id="${tempId}"]`);
        if (domNode) {
          const newNode = buildMsgNode(real, isCont, state.messages);
          domNode.replaceWith(newNode);
        }
      }
    } catch (e) {
      // ── 5. Rollback optimistic on error
      state.messages = state.messages.filter(m => m.id !== tempId);
      state.renderedMsgIds.delete(tempId);
      messagesEl.querySelector(`[data-msg-id="${tempId}"]`)?.remove();
      // Restore text
      textarea.value = savedText;
      resizeTextarea();
      if (savedReply) setReplyTo(savedReply);
      showInputError(typeof e.data?.error === 'string' ? e.data.error : 'Failed to send. Try again.');
    } finally {
      state.sending = false;
      sendBtn.disabled = textarea.value.trim().length === 0;
    }
  }

  function showInputError(msg) {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:12px;color:var(--danger);padding:3px 2px;animation:fadeIn .2s;';
    el.textContent = msg;
    inputArea.insertBefore(el, inputArea.firstChild);
    setTimeout(() => el.remove(), 4000);
  }

  // ── ACTIONS ───────────────────────────────────────────────────────────────
  async function deleteMessage(id) {
    if (!confirm('Delete this message?')) return;
    try {
      await api(`/api/group-chats/${state.activeGroupId}/messages/${id}`, { method: 'DELETE' });
      const el = messagesEl.querySelector(`[data-msg-id="${id}"]`);
      if (el) {
        const c = el.querySelector('.gc-msg-content');
        if (c) { c.textContent = 'This message was deleted.'; c.className = 'gc-msg-content is-deleted'; }
        el.querySelector('.gc-msg-actions')?.remove();
      }
      const m = state.messages.find(x => x.id === id);
      if (m) m.deletedAt = new Date().toISOString();
    } catch (e) { alert(e.data?.error || 'Failed to delete.'); }
  }

  async function pinMessage(id) {
    try {
      await api(`/api/group-chats/${state.activeGroupId}/pin/${id}`, { method: 'POST' });
      const data = await api(`/api/group-chats/${state.activeGroupId}/messages`);
      state.chatInfo = data.chat;
      state.pinnedMessage = data.pinnedMessage || null;
      renderPinned();
    } catch (e) { alert(e.data?.error || 'Failed to pin.'); }
  }

  async function unpinMessage() {
    try {
      await api(`/api/group-chats/${state.activeGroupId}/unpin`, { method: 'POST' });
      state.chatInfo.pinnedMessageId = null;
      state.pinnedMessage = null;
      renderPinned();
    } catch (e) { alert(e.data?.error || 'Failed to unpin.'); }
  }

  async function toggleLock() {
    if (!state.chatInfo) return;
    const action = state.chatInfo.isLocked ? 'unlock' : 'lock';
    try {
      await api(`/api/group-chats/${state.activeGroupId}/${action}`, { method: 'POST' });
      await loadMessages(false);
    } catch (e) { alert(e.data?.error || 'Failed.'); }
  }

  // ── TYPING ────────────────────────────────────────────────────────────────
  function onTypingInput() {
    if (!state.activeGroupId) return;
    if (!state.isTypingActive) { state.isTypingActive = true; postTyping(); }
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => { state.isTypingActive = false; }, 5000);
  }
  function postTyping() {
    if (!state.activeGroupId || !state.isTypingActive) return;
    api(`/api/group-chats/${state.activeGroupId}/typing`, { method: 'POST' }).catch(() => {});
    if (state.isTypingActive) setTimeout(postTyping, 4000);
  }
  function markRead() {
    if (state.activeGroupId)
      api(`/api/group-chats/${state.activeGroupId}/read`, { method: 'POST' }).catch(() => {});
  }

  // ── REPLY ─────────────────────────────────────────────────────────────────
  function setReplyTo(msg) {
    state.replyTo = msg;
    replyBarNameEl.textContent = msg.senderNickname || 'Unknown';
    replyBarPreview.textContent = (msg.rawText || msg.content || '').slice(0, 80);
    replyBarEl.style.display = 'flex';
    textarea.focus();
  }
  function clearReplyTo() {
    state.replyTo = null;
    replyBarEl.style.display = 'none';
  }

  // ── AUTOCOMPLETE ──────────────────────────────────────────────────────────
  function checkAutocomplete() {
    if (!state.suggestions) { hideAutocomplete(); return; }
    const val = textarea.value;
    const cur = textarea.selectionStart;
    const before = val.slice(0, cur);
    const atM = before.match(/@(\w*)$/);
    const hashM = before.match(/#(\w*)$/);

    if (atM) {
      const q = atM[1].toLowerCase();
      state.ac.trigger = '@';
      state.ac.triggerIndex = cur - atM[0].length;
      const items = [];
      (state.suggestions.users || []).forEach(u => {
        if (!q || u.nickname.toLowerCase().startsWith(q))
          items.push({ icon: '👤', label: u.nickname, type: 'user', insert: `@${u.nickname}` });
      });
      (state.suggestions.roles || []).forEach(r => {
        if (!q || r.name.toLowerCase().startsWith(q))
          items.push({ icon: '🏷', label: r.name, type: 'role', insert: `@${r.name}`, color: r.color });
      });
      if (state.suggestions.systemMentions?.length && (!q || 'everyone'.startsWith(q)))
        items.push({ icon: '📢', label: '@everyone', type: 'everyone', insert: '@everyone' });
      items.length ? showAutocomplete(items) : hideAutocomplete();
      return;
    }
    if (hashM) {
      const q = hashM[1].toLowerCase();
      state.ac.trigger = '#';
      state.ac.triggerIndex = cur - hashM[0].length;
      const items = (state.suggestions.pageTags || [])
        .filter(p => !q || p.slug.startsWith(q))
        .map(p => ({ icon: '🔗', label: `#${p.slug}`, type: 'page', insert: `#${p.slug}` }));
      items.length ? showAutocomplete(items) : hideAutocomplete();
      return;
    }
    hideAutocomplete();
  }

  function showAutocomplete(items) {
    state.ac.visible = true;
    state.ac.items = items;
    if (state.ac.selected >= items.length) state.ac.selected = 0;
    autocompleteEl.style.display = 'block';
    autocompleteEl.innerHTML = items.map((item, i) => `
      <div class="gc-autocomplete-item ${i === state.ac.selected ? 'is-selected' : ''}" data-index="${i}">
        <span class="gc-autocomplete-icon">${item.icon}</span>
        <span class="gc-autocomplete-name"${item.color ? ` style="color:${item.color}"` : ''}>${esc(item.label)}</span>
        <span class="gc-autocomplete-type">${item.type}</span>
      </div>`).join('');
    autocompleteEl.querySelectorAll('.gc-autocomplete-item').forEach(el => {
      el.addEventListener('mousedown', e => { e.preventDefault(); applyAC(parseInt(el.dataset.index)); });
    });
  }
  function hideAutocomplete() {
    state.ac.visible = false; state.ac.items = [];
    autocompleteEl.style.display = 'none'; autocompleteEl.innerHTML = '';
  }
  function applyAC(i) {
    const item = state.ac.items[i]; if (!item) return;
    const val = textarea.value;
    const before = val.slice(0, state.ac.triggerIndex);
    const after  = val.slice(textarea.selectionStart);
    textarea.value = before + item.insert + ' ' + after;
    const pos = before.length + item.insert.length + 1;
    textarea.setSelectionRange(pos, pos);
    hideAutocomplete();
    sendBtn.disabled = !textarea.value.trim();
    textarea.focus();
  }
  function moveAC(dir) {
    if (!state.ac.visible) return false;
    state.ac.selected = (state.ac.selected + dir + state.ac.items.length) % state.ac.items.length;
    showAutocomplete(state.ac.items);
    return true;
  }

  // ── TRADE SHARE PICKER ────────────────────────────────────────────────────
  function openTradeSharePicker() {
    if (!state.activeGroupId) return;
    const groupId = state.activeGroupId;

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;';
      overlay.innerHTML = `
        <div class="modal-card" style="width:min(520px,96vw);max-height:90vh;display:flex;flex-direction:column;">
          <header class="modal-header">
            <h2 class="modal-title">Share a Trade</h2>
            <button class="modal-close" data-action="cancel">✕</button>
          </header>
          <div style="padding:10px 20px;display:flex;gap:8px;">
            <input id="gc-tp-search" type="search" placeholder="Search ticker…" style="flex:1;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--text);font:inherit;font-size:13px;">
            <select id="gc-tp-status" style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:6px 8px;color:var(--text);font:inherit;font-size:13px;">
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div id="gc-tp-list" style="flex:1;overflow-y:auto;padding:0 12px 12px;"></div>
          <footer style="padding:10px 16px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;">
            <button class="ghost" data-action="cancel">Cancel</button>
            <button class="primary" id="gc-tp-confirm" disabled>Share selected</button>
          </footer>
        </div>`;

      let selectedId = '', rows = [], done = false;
      const searchEl = overlay.querySelector('#gc-tp-search');
      const statusEl = overlay.querySelector('#gc-tp-status');
      const listEl   = overlay.querySelector('#gc-tp-list');
      const confirmBtn = overlay.querySelector('#gc-tp-confirm');

      const finish = val => { if (done) return; done = true; overlay.remove(); resolve(val); };

      const renderList = () => {
        if (!rows.length) {
          listEl.innerHTML = '<p style="color:var(--text-dim);font-size:13px;padding:12px;">No trades found.</p>';
          confirmBtn.disabled = true; return;
        }
        listEl.innerHTML = rows.map(t => `
          <button type="button" data-tid="${t.tradeId}" style="width:100%;text-align:left;padding:10px 12px;margin-bottom:6px;border-radius:8px;border:1px solid ${selectedId === t.tradeId ? 'var(--accent)' : 'var(--border)'};background:${selectedId === t.tradeId ? 'var(--accent-soft)' : 'var(--surface-2)'};cursor:pointer;transition:all .12s;">
            <strong style="color:var(--text);font-size:14px;">${esc(t.ticker || '—')}</strong>
            <span style="color:var(--text-muted);font-size:12px;margin-left:8px;">${t.direction === 'short' ? '📉 Short' : '📈 Long'}</span>
            <span style="color:var(--text-dim);font-size:11px;margin-left:6px;">${t.status === 'closed' ? 'Closed' : 'Open'}${t.entryDate ? ' · ' + new Date(t.entryDate).toLocaleDateString() : ''}${t.account ? ' · ' + t.account : ''}</span>
          </button>`).join('');
        confirmBtn.disabled = !selectedId;
      };

      let searchTimer;
      const loadTrades = async () => {
        listEl.innerHTML = '<p style="color:var(--text-dim);font-size:13px;padding:12px;">Loading…</p>';
        const q = encodeURIComponent(String(searchEl.value || '').trim());
        const s = encodeURIComponent(statusEl.value || 'all');
        try {
          const d = await api(`/api/group-chats/${groupId}/shareable-trades?q=${q}&status=${s}`);
          rows = Array.isArray(d.trades) ? d.trades : [];
          if (selectedId && !rows.some(r => r.tradeId === selectedId)) selectedId = '';
          renderList();
        } catch {
          listEl.innerHTML = '<p style="color:var(--danger);font-size:13px;padding:12px;">Failed to load trades.</p>';
        }
      };

      overlay.addEventListener('click', e => {
        const t = e.target;
        if (t.dataset.action === 'cancel' || t === overlay) { finish(null); return; }
        if (t.id === 'gc-tp-confirm') { if (!selectedId) return; finish(rows.find(r => r.tradeId === selectedId) || null); return; }
        const btn = t.closest('[data-tid]');
        if (btn) { selectedId = btn.dataset.tid; renderList(); }
      });
      searchEl.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadTrades, 150); });
      statusEl.addEventListener('change', loadTrades);
      overlay.addEventListener('keydown', e => { if (e.key === 'Escape') finish(null); });

      document.body.appendChild(overlay);
      loadTrades();
      searchEl.focus();
    });
  }

  async function handleShareTrade() {
    const picked = await openTradeSharePicker();
    if (!picked?.tradeId || !state.activeGroupId) return;
    try {
      await api(`/api/group-chats/${state.activeGroupId}/share-trade/${encodeURIComponent(picked.tradeId)}`, { method: 'POST' });
      await loadMessages(false);
      scrollToBottom();
    } catch (e) { alert(e.data?.error || 'Failed to share trade.'); }
  }

  // ── TEXTAREA AUTO-RESIZE ──────────────────────────────────────────────────
  function resizeTextarea() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
  }

  // ── MOBILE SIDEBAR ────────────────────────────────────────────────────────
  function closeMobileSidebar() {
    sidebarEl.classList.remove('is-open');
    sidebarOverlay.classList.remove('is-open');
  }

  // ── EVENTS ────────────────────────────────────────────────────────────────
  function bindEvents() {
    textarea.addEventListener('keydown', e => {
      if (state.ac.visible) {
        if (e.key === 'ArrowUp')   { e.preventDefault(); moveAC(-1); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); moveAC(1);  return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyAC(state.ac.selected); return; }
        if (e.key === 'Escape')    { e.preventDefault(); hideAutocomplete(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    textarea.addEventListener('input', () => {
      resizeTextarea();
      sendBtn.disabled = !textarea.value.trim();
      onTypingInput();
      checkAutocomplete();
    });

    sendBtn.addEventListener('click', sendMessage);
    replyCancelBtn.addEventListener('click', clearReplyTo);

    pinnedEl.addEventListener('click', e => {
      if (e.target === pinnedUnpinBtn) return;
      if (state.chatInfo?.pinnedMessageId) scrollToMsg(state.chatInfo.pinnedMessageId);
    });
    pinnedUnpinBtn.addEventListener('click', e => { e.stopPropagation(); unpinMessage(); });

    shareTradeBtn.addEventListener('click', handleShareTrade);

    menuBtn.addEventListener('click', () => {
      sidebarEl.classList.add('is-open');
      sidebarOverlay.classList.add('is-open');
    });
    sidebarOverlay.addEventListener('click', closeMobileSidebar);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideAutocomplete();
    });
  }

  // ── BOOT ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
