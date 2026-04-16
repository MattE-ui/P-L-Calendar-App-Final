(() => {
  'use strict';

  // ── PAGE ROUTE MAP (mirrors server-side registry) ─────────────────────────
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
    currentUser: null,       // { userId, nickname, avatarUrl, avatarInitials }
    chats: [],               // sidebar list from GET /api/group-chats
    activeGroupId: null,
    messages: [],
    chatInfo: null,          // { isLeader, isLocked, canSend, permissions, pinnedMessageId, … }
    pinnedMessage: null,
    typingUsers: [],
    suggestions: null,       // { users, roles, systemMentions, pageTags }
    replyTo: null,           // message being replied to
    sending: false,
    msgPollTimer: null,
    sidebarPollTimer: null,
    typingTimer: null,
    isTypingActive: false,
    autoScrollEnabled: true,
    ac: {                    // autocomplete sub-state
      visible: false,
      items: [],
      selected: 0,
      trigger: null,         // '@' or '#'
      triggerIndex: 0,       // index in textarea value of the trigger char
      query: ''
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
  const tradeModal      = $('gc-trade-modal');
  const tradeModalClose = $('gc-trade-modal-close');
  const tradeList       = $('gc-trade-list');
  const tradeFeedback   = $('gc-trade-modal-feedback');

  // ── UTILS ─────────────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today - 86400000);
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (msgDay.getTime() === today.getTime()) return 'Today';
    if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function formatCurrency(val) {
    if (val == null || !isFinite(Number(val))) return '—';
    return '$' + Number(val).toFixed(2);
  }

  function sameDay(a, b) {
    const da = new Date(a), db = new Date(b);
    return da.getFullYear() === db.getFullYear() &&
           da.getMonth() === db.getMonth() &&
           da.getDate() === db.getDate();
  }

  function withinGroupWindow(a, b) {
    // Group messages within 5 minutes from same sender
    return Math.abs(new Date(a) - new Date(b)) < 5 * 60 * 1000;
  }

  // Render message text with @mentions and #page-links highlighted
  function renderContent(rawText, mentions = [], pageLinks = []) {
    if (!rawText) return '';
    let text = String(rawText);
    // Build replacement map from mention positions
    const parts = [];
    let pos = 0;

    // Collect all spans to highlight
    const spans = [];
    (mentions || []).forEach(m => {
      if (m.start != null && m.end != null) {
        spans.push({ start: m.start, end: m.end, type: 'mention', data: m });
      }
    });
    (pageLinks || []).forEach(p => {
      if (p.start != null && p.end != null) {
        spans.push({ start: p.start, end: p.end, type: 'page', data: p });
      }
    });

    spans.sort((a, b) => a.start - b.start);

    if (spans.length === 0) {
      return escHtml(text);
    }

    let result = '';
    let cursor = 0;
    for (const span of spans) {
      if (span.start < cursor) continue;
      result += escHtml(text.slice(cursor, span.start));
      const chunk = text.slice(span.start, span.end + 1);
      if (span.type === 'mention') {
        const isEveryone = span.data.type === 'everyone';
        const cls = isEveryone ? 'gc-mention gc-mention--everyone' : 'gc-mention';
        result += `<span class="${cls}">${escHtml(chunk)}</span>`;
      } else {
        const route = PAGE_ROUTES[span.data.slug] || '#';
        result += `<a class="gc-page-link" href="${escHtml(route)}">${escHtml(chunk)}</a>`;
      }
      cursor = span.end + 1;
    }
    result += escHtml(text.slice(cursor));
    return result;
  }

  // Fallback: simple regex-based content render when no structured data
  function renderContentSimple(rawText) {
    if (!rawText) return '';
    let html = escHtml(rawText);
    // @everyone
    html = html.replace(/@everyone\b/g, '<span class="gc-mention gc-mention--everyone">@everyone</span>');
    // @username mentions
    html = html.replace(/@(\w+)/g, '<span class="gc-mention">@$1</span>');
    // #page-links
    const pageKeys = Object.keys(PAGE_ROUTES).join('|');
    const pageRe = new RegExp(`#(${pageKeys})\\b`, 'g');
    html = html.replace(pageRe, (_, slug) => {
      const route = PAGE_ROUTES[slug] || '#';
      return `<a class="gc-page-link" href="${escHtml(route)}">#${slug}</a>`;
    });
    return html;
  }

  function createAvatarNode(msg) {
    if (window.VeracitySocialAvatar) {
      return window.VeracitySocialAvatar.createAvatar({
        nickname: msg.senderNickname,
        avatarUrl: msg.senderAvatarUrl,
        avatar_initials: msg.senderAvatarInitials
      }, 'sm');
    }
    const span = document.createElement('span');
    span.className = 'social-avatar social-avatar--sm';
    span.textContent = (msg.senderAvatarInitials || msg.senderNickname || '?')[0].toUpperCase();
    return span;
  }

  // ── API HELPERS ───────────────────────────────────────────────────────────
  async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
    return data;
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  async function init() {
    try {
      const me = await apiFetch('/api/social/me');
      const profile = me.profile || {};
      state.currentUser = {
        userId: profile.user_id || '',
        nickname: me.nickname || profile.user_id || '',
        avatarUrl: profile.avatar_url || '',
        avatarInitials: profile.avatar_initials || ''
      };
    } catch (e) {
      // Not logged in — guest.js will handle redirect
      return;
    }

    // Restore last active group from URL or localStorage
    const urlParams = new URLSearchParams(location.search);
    const targetGroup = urlParams.get('group') || localStorage.getItem('gc_last_group');

    await loadSidebar();

    if (targetGroup && state.chats.some(c => c.groupId === targetGroup)) {
      selectGroup(targetGroup);
    }

    // Sidebar poll (every 12s)
    state.sidebarPollTimer = setInterval(loadSidebar, 12000);

    // Bind events
    bindEvents();
  }

  // ── SIDEBAR ───────────────────────────────────────────────────────────────
  async function loadSidebar() {
    try {
      const data = await apiFetch('/api/group-chats');
      state.chats = data.chats || [];
      renderSidebar();
    } catch (e) {
      // silently ignore sidebar errors
    }
  }

  function renderSidebar() {
    sidebarList.innerHTML = '';
    if (state.chats.length === 0) {
      sidebarList.innerHTML = '<div style="padding:16px 14px;font-size:13px;color:var(--text-dim);">No groups yet. <a href="/social/groups" style="color:var(--accent);">Create one</a></div>';
      return;
    }

    state.chats.forEach(chat => {
      const item = document.createElement('div');
      item.className = 'gc-sidebar-item' +
        (chat.groupId === state.activeGroupId ? ' is-active' : '') +
        (chat.unreadCount > 0 ? ' has-unread' : '');
      item.dataset.groupId = chat.groupId;

      const lockHtml = chat.isLocked ? '<span class="gc-sidebar-lock-icon">🔒</span>' : '';
      const previewText = chat.latestMessage
        ? `${chat.latestMessage.senderNickname}: ${chat.latestMessage.rawText || chat.latestMessage.content || '…'}`
        : 'No messages yet';

      item.innerHTML = `
        <div class="gc-sidebar-item-info">
          <div class="gc-sidebar-item-name">
            <span>#</span>
            <span>${escHtml(chat.groupName)}</span>
            ${lockHtml}
          </div>
          <div class="gc-sidebar-item-preview">${escHtml(previewText.slice(0, 60))}</div>
        </div>
        ${chat.unreadCount > 0 ? `<span class="gc-sidebar-item-badge">${chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span>` : ''}
      `;

      item.addEventListener('click', () => {
        closeMobileSidebar();
        selectGroup(chat.groupId);
      });

      sidebarList.appendChild(item);
    });
  }

  // ── SELECT GROUP ──────────────────────────────────────────────────────────
  async function selectGroup(groupId) {
    if (state.activeGroupId === groupId) return;

    // Stop current poll
    stopMsgPoll();

    state.activeGroupId = groupId;
    state.messages = [];
    state.chatInfo = null;
    state.replyTo = null;
    state.typingUsers = [];

    // Update URL without navigation
    const url = new URL(location.href);
    url.searchParams.set('group', groupId);
    history.replaceState(null, '', url.toString());
    localStorage.setItem('gc_last_group', groupId);

    // Show chat view
    noGroupEl.style.display = 'none';
    chatViewEl.style.display = 'flex';
    chatViewEl.style.flexDirection = 'column';
    chatViewEl.style.flex = '1';
    chatViewEl.style.minHeight = '0';
    chatViewEl.style.overflow = 'hidden';

    // Show loading skeleton
    messagesEl.innerHTML = '<div style="padding:24px 16px;color:var(--text-dim);font-size:13px;">Loading messages…</div>';
    replyBarEl.style.display = 'none';
    state.replyTo = null;
    hideAutocomplete();

    // Update sidebar active state
    renderSidebar();

    await loadMessages();
    startMsgPoll();
  }

  // ── LOAD MESSAGES ─────────────────────────────────────────────────────────
  async function loadMessages() {
    if (!state.activeGroupId) return;
    try {
      const data = await apiFetch(`/api/group-chats/${state.activeGroupId}/messages`);
      const wasAtBottom = isNearBottom();

      state.chatInfo = data.chat;
      state.pinnedMessage = data.pinnedMessage || null;
      state.typingUsers = data.typingUsers || [];
      state.suggestions = data.suggestionsSeed || null;

      // Merge new messages (avoid full re-render if only appending)
      const prevIds = new Set(state.messages.map(m => m.id));
      const incoming = (data.messages || []);
      const hasNew = incoming.some(m => !prevIds.has(m.id));
      const hasDeleted = state.messages.some(m => {
        const fresh = incoming.find(x => x.id === m.id);
        return fresh && fresh.deletedAt !== m.deletedAt;
      });

      state.messages = incoming;

      renderHeader();
      renderPinned();
      renderTyping();

      if (hasNew || hasDeleted || prevIds.size === 0) {
        renderMessages(wasAtBottom || prevIds.size === 0);
      }

      // Mark as read
      markRead();

      // Update sidebar unread count
      const chatEntry = state.chats.find(c => c.groupId === state.activeGroupId);
      if (chatEntry && chatEntry.unreadCount > 0) {
        chatEntry.unreadCount = 0;
        renderSidebar();
      }

    } catch (e) {
      if (e.status === 403 || e.status === 404) {
        messagesEl.innerHTML = '<div style="padding:24px 16px;color:var(--text-dim);font-size:13px;">You no longer have access to this group.</div>';
        stopMsgPoll();
      }
    }
  }

  // ── POLLING ───────────────────────────────────────────────────────────────
  function startMsgPoll() {
    stopMsgPoll();
    state.msgPollTimer = setInterval(() => {
      loadMessages();
    }, 3000);
  }

  function stopMsgPoll() {
    if (state.msgPollTimer) {
      clearInterval(state.msgPollTimer);
      state.msgPollTimer = null;
    }
  }

  function isNearBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  }

  function scrollToBottom(smooth = true) {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  }

  // ── RENDER HEADER ─────────────────────────────────────────────────────────
  function renderHeader() {
    const info = state.chatInfo;
    if (!info) return;

    headerNameEl.textContent = info.groupName;
    headerMetaEl.textContent = `${info.participantCount} member${info.participantCount !== 1 ? 's' : ''}`;
    document.title = `#${info.groupName} | Group Chat`;

    // Update placeholder
    textarea.placeholder = `Message #${info.groupName}`;

    // Actions
    headerActionsEl.innerHTML = '';

    if (info.canModerate) {
      const lockBtn = document.createElement('button');
      lockBtn.className = 'gc-header-btn' + (info.isLocked ? ' is-locked' : '');
      lockBtn.textContent = info.isLocked ? '🔒 Locked' : '🔓 Lock chat';
      lockBtn.title = info.isLocked ? 'Unlock chat' : 'Lock chat (leaders only)';
      lockBtn.addEventListener('click', () => toggleLock());
      headerActionsEl.appendChild(lockBtn);
    }

    // Input lock state
    const canSend = info.canSend !== false;
    inputWrap.style.display = canSend ? 'flex' : 'none';
    lockedNotice.style.display = canSend ? 'none' : 'block';
  }

  // ── RENDER PINNED ─────────────────────────────────────────────────────────
  function renderPinned() {
    const pm = state.pinnedMessage;
    if (!pm) {
      pinnedEl.style.display = 'none';
      return;
    }
    pinnedEl.style.display = 'flex';
    pinnedTextEl.textContent = `${pm.senderNickname}: ${pm.rawText || pm.content || ''}`;
    pinnedUnpinBtn.style.display = state.chatInfo?.canModerate ? 'inline-flex' : 'none';
  }

  // ── RENDER TYPING ─────────────────────────────────────────────────────────
  function renderTyping() {
    const users = state.typingUsers || [];
    if (users.length === 0) {
      typingEl.innerHTML = '';
      return;
    }
    let label = '';
    if (users.length === 1) label = `${escHtml(users[0].nickname)} is typing`;
    else if (users.length === 2) label = `${escHtml(users[0].nickname)} and ${escHtml(users[1].nickname)} are typing`;
    else label = `${users.length} people are typing`;

    typingEl.innerHTML = `
      <span class="gc-typing-dots">
        <span class="gc-typing-dot"></span>
        <span class="gc-typing-dot"></span>
        <span class="gc-typing-dot"></span>
      </span>
      <span>${label}…</span>
    `;
  }

  // ── RENDER MESSAGES ───────────────────────────────────────────────────────
  function renderMessages(scrollToEnd = false) {
    const msgs = state.messages;
    messagesEl.innerHTML = '';

    if (msgs.length === 0) {
      messagesEl.innerHTML = '<div style="padding:24px 16px;color:var(--text-dim);font-size:13px;text-align:center;">No messages yet. Be the first to say something! 👋</div>';
      return;
    }

    let lastDate = null;
    let lastSenderId = null;
    let lastTimestamp = null;

    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];

      // Date divider
      const msgDate = msg.createdAt ? fmtDate(msg.createdAt) : null;
      if (msgDate && msgDate !== lastDate) {
        const divider = document.createElement('div');
        divider.className = 'gc-date-divider';
        divider.textContent = msgDate;
        messagesEl.appendChild(divider);
        lastDate = msgDate;
        lastSenderId = null;
        lastTimestamp = null;
      }

      // Determine if continuation (same sender, within 5min, same type group)
      const isGroupable = !['system', 'trade_event_system'].includes(msg.messageType);
      const isContinuation = isGroupable &&
        lastSenderId === msg.senderUserId &&
        lastTimestamp &&
        withinGroupWindow(lastTimestamp, msg.createdAt);

      const node = buildMessageNode(msg, isContinuation, msgs);
      messagesEl.appendChild(node);

      if (isGroupable) {
        lastSenderId = msg.senderUserId;
        lastTimestamp = msg.createdAt;
      } else {
        lastSenderId = null;
        lastTimestamp = null;
      }
    }

    if (scrollToEnd) {
      scrollToBottom(false);
    }
  }

  function buildMessageNode(msg, isContinuation, allMsgs) {
    const isMe = state.currentUser && msg.senderUserId === state.currentUser.userId;
    const canDelete = state.chatInfo?.canModerate ||
      state.chatInfo?.permissions?.canDeleteMessages ||
      (isMe && msg.messageType === 'user_message');
    const canPin = state.chatInfo?.canModerate || state.chatInfo?.permissions?.canPinMessages;

    // ── System message ─────────────────────────────────────
    if (msg.messageType === 'system') {
      const el = document.createElement('div');
      el.className = 'gc-msg gc-msg--system';
      el.dataset.msgId = msg.id;
      el.innerHTML = `<span class="gc-msg-system-text">${escHtml(msg.content || '')}</span>`;
      return el;
    }

    // ── Trade event system ─────────────────────────────────
    if (msg.messageType === 'trade_event_system') {
      const el = document.createElement('div');
      el.className = 'gc-msg gc-msg--trade-event' + (!isContinuation ? ' gc-msg--gap-before' : '');
      el.dataset.msgId = msg.id;
      const meta = msg.metadata || {};
      const icon = meta.eventType === 'TRADE_CLOSED' ? '📉' : (meta.eventType === 'TRADE_TRIMMED' ? '✂️' : '📈');
      const ticker = meta.ticker ? `<strong>${escHtml(meta.ticker)}</strong>` : '';
      const price = meta.fillPrice || meta.entryPrice;
      const priceStr = price ? ` · ${formatCurrency(price)}` : '';
      el.innerHTML = `
        <div class="gc-trade-event-pill">
          <span class="gc-trade-event-icon">${icon}</span>
          <span class="gc-trade-event-content">
            ${ticker}${escHtml(msg.content?.replace(meta.ticker || '', '') || '')}${priceStr}
          </span>
          <span class="gc-trade-event-time">${fmtTime(msg.createdAt)}</span>
        </div>
      `;
      return el;
    }

    // ── User / announcement / trade share ──────────────────
    const isAnnouncement = msg.messageType === 'leader_announcement';
    const isDeleted = !!msg.deletedAt;
    const isMentionedMe = !isDeleted && state.currentUser &&
      (msg.mentions || []).some(m => m.userId === state.currentUser.userId || m.type === 'everyone');

    const el = document.createElement('div');
    el.className = 'gc-msg' +
      (isContinuation ? ' gc-msg--continuation' : ' gc-msg--gap-before') +
      (isAnnouncement ? ' gc-msg--announcement' : '') +
      (isMentionedMe ? ' gc-msg--mentioned' : '');
    el.dataset.msgId = msg.id;

    // Avatar column
    const avatarCol = document.createElement('div');
    avatarCol.className = 'gc-msg-avatar-col';
    if (isContinuation) {
      const miniTime = document.createElement('span');
      miniTime.className = 'gc-msg-time-mini';
      miniTime.textContent = fmtTime(msg.createdAt);
      avatarCol.appendChild(miniTime);
    } else {
      avatarCol.appendChild(createAvatarNode(msg));
    }

    // Body
    const body = document.createElement('div');
    body.className = 'gc-msg-body';

    // Meta row
    if (!isContinuation) {
      const meta = document.createElement('div');
      meta.className = 'gc-msg-meta';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'gc-msg-name' + (isAnnouncement ? ' gc-msg-name--leader' : '');
      nameSpan.textContent = msg.senderNickname || 'Unknown';
      meta.appendChild(nameSpan);

      // Role badges
      (msg.senderRoleBadges || []).forEach(badge => {
        const b = document.createElement('span');
        b.className = 'gc-msg-role-badge';
        b.textContent = badge.name;
        b.style.background = hexToAlpha(badge.color || '#3cb982', 0.15);
        b.style.color = badge.color || '#3cb982';
        meta.appendChild(b);
      });

      const timeSpan = document.createElement('span');
      timeSpan.className = 'gc-msg-time';
      timeSpan.textContent = fmtTime(msg.createdAt);
      meta.appendChild(timeSpan);

      body.appendChild(meta);
    }

    // Announcement label
    if (isAnnouncement && !isContinuation) {
      const label = document.createElement('div');
      label.className = 'gc-announce-label';
      label.textContent = '📢 Announcement';
      body.insertBefore(label, body.firstChild);
    }

    // Reply quote
    if (msg.replyToMessageId && !isDeleted) {
      const replied = allMsgs.find(m => m.id === msg.replyToMessageId);
      if (replied) {
        const quote = document.createElement('div');
        quote.className = 'gc-reply-quote';
        quote.innerHTML = `
          <span class="gc-reply-quote-name">${escHtml(replied.senderNickname || 'Unknown')}</span>
          <span class="gc-reply-quote-text">${escHtml((replied.rawText || replied.content || '').slice(0, 120))}</span>
        `;
        quote.addEventListener('click', () => scrollToMessage(replied.id));
        body.appendChild(quote);
      }
    }

    // Content
    const content = document.createElement('div');
    content.className = 'gc-msg-content' + (isDeleted ? ' is-deleted' : '');
    if (isDeleted) {
      content.textContent = 'This message was deleted.';
    } else {
      const html = (msg.entities?.length || msg.pageLinks?.length || msg.mentions?.length)
        ? renderContent(msg.rawText || msg.content || '', msg.mentions, msg.pageLinks)
        : renderContentSimple(msg.rawText || msg.content || '');
      content.innerHTML = html;
    }
    body.appendChild(content);

    // Trade card (for trade_share messages)
    if (msg.messageType === 'trade_share' && !isDeleted) {
      const card = buildTradeCard(msg);
      if (card) body.appendChild(card);
    }

    // Hover actions
    if (!isDeleted) {
      const actions = document.createElement('div');
      actions.className = 'gc-msg-actions';

      const replyBtn = document.createElement('button');
      replyBtn.className = 'gc-msg-action-btn';
      replyBtn.title = 'Reply';
      replyBtn.textContent = '↩';
      replyBtn.addEventListener('click', e => { e.stopPropagation(); setReplyTo(msg); });
      actions.appendChild(replyBtn);

      if (canPin && msg.messageType !== 'system') {
        const isPinned = state.chatInfo?.pinnedMessageId === msg.id;
        const pinBtn = document.createElement('button');
        pinBtn.className = 'gc-msg-action-btn';
        pinBtn.title = isPinned ? 'Unpin' : 'Pin message';
        pinBtn.textContent = '📌';
        pinBtn.style.opacity = isPinned ? '1' : '';
        pinBtn.addEventListener('click', e => {
          e.stopPropagation();
          isPinned ? unpinMessage() : pinMessage(msg.id);
        });
        actions.appendChild(pinBtn);
      }

      if (canDelete) {
        const delBtn = document.createElement('button');
        delBtn.className = 'gc-msg-action-btn gc-msg-action-btn--danger';
        delBtn.title = 'Delete message';
        delBtn.textContent = '🗑';
        delBtn.addEventListener('click', e => { e.stopPropagation(); deleteMessage(msg.id); });
        actions.appendChild(delBtn);
      }

      el.appendChild(actions);
    }

    el.appendChild(avatarCol);
    el.appendChild(body);
    return el;
  }

  function buildTradeCard(msg) {
    const meta = msg.metadata || {};
    if (!meta.ticker) return null;
    const dir = meta.direction === 'short' ? 'short' : 'long';
    const card = document.createElement('div');
    card.className = 'gc-trade-card';
    card.innerHTML = `
      <div class="gc-trade-card-head">
        <span class="gc-trade-card-ticker">${escHtml(meta.ticker)}</span>
        <span class="gc-trade-card-dir gc-trade-card-dir--${dir}">${dir.toUpperCase()}</span>
        <span class="gc-trade-card-status">${escHtml(meta.status || 'open')}</span>
      </div>
      <div class="gc-trade-card-grid">
        ${meta.entryPrice != null ? `<div class="gc-trade-card-field"><span class="gc-trade-card-label">Entry</span><span class="gc-trade-card-value">${formatCurrency(meta.entryPrice)}</span></div>` : ''}
        ${meta.stopPrice != null ? `<div class="gc-trade-card-field"><span class="gc-trade-card-label">Stop</span><span class="gc-trade-card-value">${formatCurrency(meta.stopPrice)}</span></div>` : ''}
        ${meta.riskPercent != null ? `<div class="gc-trade-card-field"><span class="gc-trade-card-label">Risk %</span><span class="gc-trade-card-value">${Number(meta.riskPercent).toFixed(1)}%</span></div>` : ''}
      </div>
    `;
    return card;
  }

  function scrollToMessage(msgId) {
    const el = messagesEl.querySelector(`[data-msg-id="${msgId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.background = 'rgba(88,166,255,0.1)';
      setTimeout(() => el.style.background = '', 1500);
    }
  }

  function hexToAlpha(hex, alpha) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ── SEND MESSAGE ──────────────────────────────────────────────────────────
  async function sendMessage() {
    if (!state.activeGroupId || state.sending) return;
    const text = textarea.value.trim();
    if (!text) return;

    state.sending = true;
    sendBtn.disabled = true;
    textarea.disabled = true;

    const payload = {
      content: text,
      rawText: text
    };
    if (state.replyTo) {
      payload.replyToMessageId = state.replyTo.id;
    }

    try {
      await apiFetch(`/api/group-chats/${state.activeGroupId}/messages`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      textarea.value = '';
      resizeTextarea();
      clearReplyTo();
      hideAutocomplete();
      // Immediately load to show the new message
      await loadMessages();
      scrollToBottom();
    } catch (e) {
      if (e.data?.error) {
        showInputError(e.data.error);
      }
    } finally {
      state.sending = false;
      sendBtn.disabled = false;
      textarea.disabled = false;
      textarea.focus();
    }
  }

  function showInputError(msg) {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:12px;color:var(--danger);padding:4px 2px;';
    el.textContent = msg;
    inputArea.insertBefore(el, inputArea.firstChild);
    setTimeout(() => el.remove(), 3000);
  }

  // ── DELETE MESSAGE ────────────────────────────────────────────────────────
  async function deleteMessage(msgId) {
    if (!confirm('Delete this message?')) return;
    try {
      await apiFetch(`/api/group-chats/${state.activeGroupId}/messages/${msgId}`, { method: 'DELETE' });
      await loadMessages();
    } catch (e) {
      alert(e.data?.error || 'Failed to delete message.');
    }
  }

  // ── PIN / UNPIN ───────────────────────────────────────────────────────────
  async function pinMessage(msgId) {
    try {
      await apiFetch(`/api/group-chats/${state.activeGroupId}/pin/${msgId}`, { method: 'POST' });
      await loadMessages();
    } catch (e) {
      alert(e.data?.error || 'Failed to pin message.');
    }
  }

  async function unpinMessage() {
    try {
      await apiFetch(`/api/group-chats/${state.activeGroupId}/unpin`, { method: 'POST' });
      await loadMessages();
    } catch (e) {
      alert(e.data?.error || 'Failed to unpin message.');
    }
  }

  // ── LOCK / UNLOCK ─────────────────────────────────────────────────────────
  async function toggleLock() {
    if (!state.chatInfo) return;
    const endpoint = state.chatInfo.isLocked ? 'unlock' : 'lock';
    try {
      await apiFetch(`/api/group-chats/${state.activeGroupId}/${endpoint}`, { method: 'POST' });
      await loadMessages();
    } catch (e) {
      alert(e.data?.error || 'Failed.');
    }
  }

  // ── TYPING INDICATOR ──────────────────────────────────────────────────────
  function onTyping() {
    if (!state.activeGroupId) return;
    if (!state.isTypingActive) {
      state.isTypingActive = true;
      postTyping();
    }
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
      state.isTypingActive = false;
    }, 4000);
  }

  function postTyping() {
    if (!state.activeGroupId || !state.isTypingActive) return;
    apiFetch(`/api/group-chats/${state.activeGroupId}/typing`, { method: 'POST' }).catch(() => {});
    if (state.isTypingActive) {
      setTimeout(postTyping, 4000);
    }
  }

  // ── MARK READ ─────────────────────────────────────────────────────────────
  function markRead() {
    if (!state.activeGroupId) return;
    apiFetch(`/api/group-chats/${state.activeGroupId}/read`, { method: 'POST' }).catch(() => {});
  }

  // ── REPLY TO ──────────────────────────────────────────────────────────────
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
    const val = textarea.value;
    const cursor = textarea.selectionStart;
    const textUpToCursor = val.slice(0, cursor);

    // Find last @ or # before cursor (no space after it)
    const atMatch = textUpToCursor.match(/@(\w*)$/);
    const hashMatch = textUpToCursor.match(/#(\w*)$/);

    if (!state.suggestions) { hideAutocomplete(); return; }

    if (atMatch) {
      const query = atMatch[1].toLowerCase();
      state.ac.trigger = '@';
      state.ac.triggerIndex = cursor - atMatch[0].length;
      state.ac.query = query;

      const items = [];
      // Users
      (state.suggestions.users || []).forEach(u => {
        if (!query || u.nickname.toLowerCase().startsWith(query)) {
          items.push({ type: 'user', label: u.nickname, icon: '👤', insert: `@${u.nickname}` });
        }
      });
      // Roles
      (state.suggestions.roles || []).forEach(r => {
        if (!query || r.name.toLowerCase().startsWith(query)) {
          items.push({ type: 'role', label: r.name, icon: '🏷', insert: `@${r.name}`, color: r.color });
        }
      });
      // @everyone
      if (state.suggestions.systemMentions?.length) {
        if (!query || 'everyone'.startsWith(query)) {
          items.push({ type: 'everyone', label: '@everyone', icon: '📢', insert: '@everyone' });
        }
      }

      if (items.length > 0) {
        showAutocomplete(items);
      } else {
        hideAutocomplete();
      }
      return;
    }

    if (hashMatch) {
      const query = hashMatch[1].toLowerCase();
      state.ac.trigger = '#';
      state.ac.triggerIndex = cursor - hashMatch[0].length;
      state.ac.query = query;

      const items = (state.suggestions.pageTags || [])
        .filter(p => !query || p.slug.startsWith(query))
        .map(p => ({ type: 'page', label: `#${p.slug}`, icon: '🔗', insert: `#${p.slug}` }));

      if (items.length > 0) {
        showAutocomplete(items);
      } else {
        hideAutocomplete();
      }
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
        <span class="gc-autocomplete-name" ${item.color ? `style="color:${item.color}"` : ''}>${escHtml(item.label)}</span>
        <span class="gc-autocomplete-type">${item.type}</span>
      </div>
    `).join('');

    autocompleteEl.querySelectorAll('.gc-autocomplete-item').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        applyAutocomplete(parseInt(el.dataset.index));
      });
    });
  }

  function hideAutocomplete() {
    state.ac.visible = false;
    state.ac.items = [];
    autocompleteEl.style.display = 'none';
    autocompleteEl.innerHTML = '';
  }

  function applyAutocomplete(index) {
    const item = state.ac.items[index];
    if (!item) return;
    const val = textarea.value;
    const before = val.slice(0, state.ac.triggerIndex);
    const after = val.slice(textarea.selectionStart);
    const newVal = before + item.insert + ' ' + after;
    textarea.value = newVal;
    const newPos = before.length + item.insert.length + 1;
    textarea.setSelectionRange(newPos, newPos);
    hideAutocomplete();
    sendBtn.disabled = textarea.value.trim().length === 0;
    textarea.focus();
  }

  function moveAutocomplete(dir) {
    if (!state.ac.visible) return false;
    state.ac.selected = (state.ac.selected + dir + state.ac.items.length) % state.ac.items.length;
    showAutocomplete(state.ac.items);
    return true;
  }

  // ── TRADE SHARE MODAL ─────────────────────────────────────────────────────
  async function openTradeModal() {
    if (!state.activeGroupId) return;
    tradeModal.style.display = 'flex';
    tradeFeedback.textContent = '';
    tradeList.innerHTML = '<div style="color:var(--text-dim);font-size:13px;padding:8px 0;">Loading…</div>';
    try {
      const data = await apiFetch(`/api/group-chats/${state.activeGroupId}/shareable-trades`);
      const trades = data.trades || [];
      if (trades.length === 0) {
        tradeList.innerHTML = '<div style="color:var(--text-dim);font-size:13px;padding:8px 0;">No open trades to share.</div>';
        return;
      }
      tradeList.innerHTML = '';
      trades.forEach(trade => {
        const btn = document.createElement('button');
        btn.className = 'ghost';
        btn.style.cssText = 'width:100%;text-align:left;padding:10px 12px;margin-bottom:6px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);cursor:pointer;';
        const ticker = trade.ticker || trade.symbol || '—';
        const dir = trade.direction === 'short' ? '📉 Short' : '📈 Long';
        btn.innerHTML = `<strong style="color:var(--text)">${escHtml(ticker)}</strong> <span style="color:var(--text-muted);font-size:12px;margin-left:8px;">${dir}</span>`;
        btn.addEventListener('click', () => shareTrade(trade.id));
        tradeList.appendChild(btn);
      });
    } catch (e) {
      tradeList.innerHTML = `<div style="color:var(--danger);font-size:13px;">Failed to load trades.</div>`;
    }
  }

  async function shareTrade(tradeId) {
    tradeFeedback.textContent = 'Sharing…';
    try {
      await apiFetch(`/api/group-chats/${state.activeGroupId}/share-trade/${tradeId}`, { method: 'POST' });
      tradeModal.style.display = 'none';
      await loadMessages();
      scrollToBottom();
    } catch (e) {
      tradeFeedback.textContent = e.data?.error || 'Failed to share trade.';
      tradeFeedback.style.color = 'var(--danger)';
    }
  }

  // ── TEXTAREA RESIZE ───────────────────────────────────────────────────────
  function resizeTextarea() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
  }

  // ── MOBILE SIDEBAR ────────────────────────────────────────────────────────
  function openMobileSidebar() {
    sidebarEl.classList.add('is-open');
    sidebarOverlay.classList.add('is-open');
  }

  function closeMobileSidebar() {
    sidebarEl.classList.remove('is-open');
    sidebarOverlay.classList.remove('is-open');
  }

  // ── EVENT BINDING ─────────────────────────────────────────────────────────
  function bindEvents() {
    // Send on Enter (Shift+Enter = newline)
    textarea.addEventListener('keydown', e => {
      if (state.ac.visible) {
        if (e.key === 'ArrowUp') { e.preventDefault(); moveAutocomplete(-1); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); moveAutocomplete(1); return; }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          applyAutocomplete(state.ac.selected);
          return;
        }
        if (e.key === 'Escape') { e.preventDefault(); hideAutocomplete(); return; }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    textarea.addEventListener('input', () => {
      resizeTextarea();
      sendBtn.disabled = textarea.value.trim().length === 0;
      onTyping();
      checkAutocomplete();
    });

    // Auto-scroll: disable when user scrolls up, re-enable when near bottom
    messagesEl.addEventListener('scroll', () => {
      state.autoScrollEnabled = isNearBottom();
    });

    sendBtn.addEventListener('click', sendMessage);
    replyCancelBtn.addEventListener('click', clearReplyTo);

    // Pinned banner: scroll to pinned message
    pinnedEl.addEventListener('click', e => {
      if (e.target === pinnedUnpinBtn) return;
      if (state.chatInfo?.pinnedMessageId) scrollToMessage(state.chatInfo.pinnedMessageId);
    });

    pinnedUnpinBtn.addEventListener('click', e => {
      e.stopPropagation();
      unpinMessage();
    });

    // Trade share button
    shareTradeBtn.addEventListener('click', openTradeModal);
    tradeModalClose.addEventListener('click', () => { tradeModal.style.display = 'none'; });
    tradeModal.addEventListener('click', e => {
      if (e.target === tradeModal) tradeModal.style.display = 'none';
    });

    // Mobile sidebar
    menuBtn.addEventListener('click', openMobileSidebar);
    sidebarOverlay.addEventListener('click', closeMobileSidebar);

    // Escape closes autocomplete
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        hideAutocomplete();
        if (state.ac.visible) return;
        if (tradeModal.style.display !== 'none') tradeModal.style.display = 'none';
      }
    });
  }

  // ── BOOT ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
