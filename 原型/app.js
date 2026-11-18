const STORAGE_KEY = 'lotFlowCapstoneDemo.v1';
const dayMs = 24 * 60 * 60 * 1000;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Workflow roles and escalation
// 主管鏈由低至高，未達成時沿此順序通知上一級；生管經理與生產經理並列協同。
const ROLE_LABELS = {
  GROUP_LEADER: '組長',
  STOCK_LEADER: '股長',
  SECTION_CHIEF: '課長',
  PRODUCTION_MANAGER: '生產經理',
  PRODUCTION_CONTROL_MANAGER: '生管經理',
  PRODUCTION_VP: '生產副總',
  GENERAL_MANAGER: '總經理',
  CHAIRMAN: '董事長'
};
const ESCALATION_CHAIN = [
  'GROUP_LEADER',
  'STOCK_LEADER',
  'SECTION_CHIEF',
  'PRODUCTION_MANAGER',
  'PRODUCTION_VP',
  'GENERAL_MANAGER',
  'CHAIRMAN'
];

function roleLabel(role) {
  return ROLE_LABELS[role] || role || '未設定層級';
}

function nextHigherRole(role) {
  const normalized = role === 'PRODUCTION_CONTROL_MANAGER' ? 'PRODUCTION_MANAGER' : role;
  const index = ESCALATION_CHAIN.indexOf(normalized);
  return index >= 0 && index < ESCALATION_CHAIN.length - 1 ? ESCALATION_CHAIN[index + 1] : null;
}

function notificationRoles(notice) {
  if (Array.isArray(notice.recipientRoles) && notice.recipientRoles.length) return notice.recipientRoles;
  if (notice.recipientRole) return [notice.recipientRole];
  if (notice.type === 'pending') return ['PRODUCTION_MANAGER', 'PRODUCTION_CONTROL_MANAGER'];
  if (notice.type === 'escalated') return ['GENERAL_MANAGER'];
  return [];
}

function recordNotificationResponse(notice, payload) {
  if (!Array.isArray(notice.responseHistory)) notice.responseHistory = [];
  const response = {
    id: `R-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    responderRole: payload.responderRole,
    progress: String(payload.progress || '').trim(),
    expectedCompletionDate: payload.expectedCompletionDate,
    repliedAt: payload.repliedAt || new Date().toISOString(),
    outcome: null,
    followups: [],
    escalationNoticeId: null
  };
  notice.responseHistory.push(response);
  return response;
}

function createEscalationNotice(data, notice, response, nextRole, now) {
  const id = `N-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const next = {
    id,
    date: now,
    code: notice.code,
    type: 'response-escalation',
    title: `回覆未達成，升級通知${roleLabel(nextRole)}`,
    message: `${roleLabel(response.responderRole)}回覆未達成。進度：${response.progress}；原預計完成日：${response.expectedCompletionDate}。請上一級接續處置。`,
    to: roleLabel(nextRole),
    read: false,
    recipientRole: nextRole,
    recipientRoles: [nextRole],
    parentNotificationId: notice.id,
    escalationFromRole: response.responderRole,
    responseHistory: []
  };
  data.notifications.unshift(next);
  response.escalationNoticeId = id;
  return next;
}

function followUpNotificationResponse(data, notice, response, outcome, note, now = new Date().toISOString()) {
  if (!response || response.outcome) return { error: 'already-followed-up' };
  if (outcome !== 'ACHIEVED' && outcome !== 'NOT_ACHIEVED') return { error: 'invalid-outcome' };
  response.outcome = outcome;
  response.followups = Array.isArray(response.followups) ? response.followups : [];
  response.followups.push({ outcome, note: String(note || '').trim(), followedUpAt: now });
  if (outcome === 'ACHIEVED') return { response, escalation: null, topLevel: false };
  const nextRole = nextHigherRole(response.responderRole);
  if (!nextRole) return { response, escalation: null, topLevel: true };
  return { response, escalation: createEscalationNotice(data, notice, response, nextRole, now), topLevel: false };
}

// Demo data
function isoDaysAgo(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function dateTime(daysAgo = 0, hour = 9) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function seededData() {
  return {
    settings: {
      escalationThreshold: 2,
      watchDays: 3,
      urgentDays: 5
    },
    lots: [
      {
        code: 'LOT-2611-014',
        product: 'DIAL-17 錶盤',
        workOrder: 'WO-2611-040',
        threshold: 1000,
        inputQty: 1200,
        pendingSince: isoDaysAgo(7),
        repeatedFailures: 2,
        firstReadyAt: null,
        inspections: [
          {
            date: isoDaysAgo(7),
            newlyGood: 520,
            inspected: 620,
            repair: 100,
            defect: 0,
            note: '首次中檢；修理品待安排'
          },
          {
            date: isoDaysAgo(4),
            newlyGood: 130,
            inspected: 180,
            repair: 50,
            defect: 0,
            note: '修理後再檢，仍未達移轉門檻'
          },
          {
            date: isoDaysAgo(1),
            newlyGood: 80,
            inspected: 110,
            repair: 30,
            defect: 0,
            note: '再次檢查，待後續處置'
          }
        ],
        dispositions: [
          {
            date: dateTime(6),
            action: '安排修理後再送中檢',
            owner: '陳組長',
            progress: '等待再檢',
            expected: isoDaysAgo(-1)
          },
          {
            date: dateTime(3),
            action: '確認修理排程並加派檢查',
            owner: '林課長',
            progress: '處理中',
            expected: isoDaysAgo(-1)
          }
        ],
        escalatedAt: dateTime(1)
      },
      {
        code: 'LOT-2611-022',
        product: 'DIAL-21 錶盤',
        workOrder: 'WO-2611-051',
        threshold: 850,
        inputQty: 1000,
        pendingSince: isoDaysAgo(4),
        repeatedFailures: 1,
        firstReadyAt: null,
        inspections: [
          {
            date: isoDaysAgo(4),
            newlyGood: 500,
            inspected: 630,
            repair: 130,
            defect: 0,
            note: '待修品回流中'
          },
          {
            date: isoDaysAgo(1),
            newlyGood: 180,
            inspected: 240,
            repair: 60,
            defect: 0,
            note: '重檢後累計仍不足'
          }
        ],
        dispositions: [
          {
            date: dateTime(3),
            action: '安排修理並確認回流時間',
            owner: '王股長',
            progress: '處理中',
            expected: isoDaysAgo(-1)
          }
        ],
        escalatedAt: null
      },
      {
        code: 'LOT-2611-031',
        product: 'DIAL-08 錶盤',
        workOrder: 'WO-2611-063',
        threshold: 600,
        inputQty: 700,
        pendingSince: null,
        repeatedFailures: 0,
        firstReadyAt: dateTime(0, 10),
        inspections: [
          {
            date: isoDaysAgo(0),
            newlyGood: 610,
            inspected: 640,
            repair: 30,
            defect: 0,
            note: '本次達到印刷移轉數量'
          }
        ],
        dispositions: [],
        escalatedAt: null
      },
      {
        code: 'LOT-2611-037',
        product: 'DIAL-32 錶盤',
        workOrder: 'WO-2611-069',
        threshold: 920,
        inputQty: 1100,
        pendingSince: isoDaysAgo(2),
        repeatedFailures: 1,
        firstReadyAt: null,
        inspections: [
          {
            date: isoDaysAgo(2),
            newlyGood: 650,
            inspected: 760,
            repair: 110,
            defect: 0,
            note: '中檢後待修'
          },
          {
            date: isoDaysAgo(0),
            newlyGood: 120,
            inspected: 180,
            repair: 60,
            defect: 0,
            note: '重檢後尚差 150 件'
          }
        ],
        dispositions: [
          {
            date: dateTime(1),
            action: '安排修理，確認再檢時間',
            owner: '張組長',
            progress: '等待再檢',
            expected: isoDaysAgo(-2)
          }
        ],
        escalatedAt: null
      },
      {
        code: 'LOT-2611-043',
        product: 'DIAL-06 錶盤',
        workOrder: 'WO-2611-072',
        threshold: 1200,
        inputQty: 1300,
        pendingSince: null,
        repeatedFailures: 0,
        firstReadyAt: dateTime(0, 8),
        inspections: [
          {
            date: isoDaysAgo(0),
            newlyGood: 1200,
            inspected: 1230,
            repair: 30,
            defect: 0,
            note: '中殘完，可投入'
          }
        ],
        dispositions: [],
        escalatedAt: null
      }
    ],
    notifications: [
      {
        id: 'N-001',
        date: dateTime(1, 10),
        code: 'LOT-2611-014',
        type: 'escalated',
        title: '重複處置仍未達移轉門檻',
        message: '累計 730 / 1,000 件；重檢未達 2 次，依暫定展示門檻通知總經理。',
        to: '總經理',
        recipientRole: 'GENERAL_MANAGER',
        recipientRoles: ['GENERAL_MANAGER'],
        read: false,
        responseHistory: []
      },
      {
        id: 'N-002',
        date: dateTime(1, 9),
        code: 'LOT-2611-022',
        type: 'pending',
        title: 'LOT 仍在中檢工管待處理',
        message: '累計 680 / 850 件，等待 4 天；通知生產經理與生管經理。',
        to: '生產經理、生管經理',
        recipientRole: 'PRODUCTION_MANAGER',
        recipientRoles: ['PRODUCTION_MANAGER', 'PRODUCTION_CONTROL_MANAGER'],
        read: false,
        responseHistory: []
      },
      {
        id: 'N-003',
        date: dateTime(0, 10),
        code: 'LOT-2611-031',
        type: 'ready',
        title: '中殘完',
        message: '累計 610 / 600 件，已符合移轉印刷條件。',
        to: '中檢人員、生產經理、生管經理',
        read: true,
        responseHistory: []
      }
    ]
  };
}
function normalizeWorkflowData(saved) {
  saved.notifications.forEach(notice => {
    notice.responseHistory = Array.isArray(notice.responseHistory) ? notice.responseHistory : [];
    if (!Array.isArray(notice.recipientRoles) || !notice.recipientRoles.length) {
      notice.recipientRoles = notice.recipientRole ? [notice.recipientRole] : notificationRoles(notice);
    }
    if (!notice.recipientRole && notice.recipientRoles.length) {
      notice.recipientRole = notice.recipientRoles[0];
    }
  });
  return saved;
}

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.lots && saved.settings && Array.isArray(saved.notifications)) {
      return normalizeWorkflowData(saved);
    }
  } catch (e) { /* load demo defaults */ }
  return seededData();
}

let data = loadData();
let currentDetailCode = null;
let currentNoticeId = null;
let currentNoticeAction = null;

// Data access and calculations
function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function totalGood(lot) {
  return lot.inspections.reduce((sum, x) => sum + Number(x.newlyGood || 0), 0);
}

function isReady(lot) {
  return totalGood(lot) >= Number(lot.threshold);
}

function gap(lot) {
  return Math.max(0, Number(lot.threshold) - totalGood(lot));
}

function waitDays(lot) {
  if (isReady(lot) || !lot.pendingSince) return 0;
  const start = new Date(`${lot.pendingSince}T00:00:00`);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((end - start) / dayMs));
}

function urgency(lot) {
  const days = waitDays(lot);
  if (!isReady(lot) && days >= Number(data.settings.urgentDays)) return 'urgent';
  if (!isReady(lot) && days >= Number(data.settings.watchDays)) return 'watch';
  return 'normal';
}

function latestDisposition(lot) {
  return lot.dispositions[lot.dispositions.length - 1] || null;
}

function latestResponse(notice) {
  return notice.responseHistory?.[notice.responseHistory.length - 1] || null;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function fmtDate(dateValue, withTime = false) {
  if (!dateValue) return '—';
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return String(dateValue);
  const options = withTime
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: '2-digit', day: '2-digit' };
  return new Intl.DateTimeFormat('zh-TW', options).format(d);
}

// Notifications and small UI helpers
function makeNotice(code, type, title, message, to, recipientRoles = null) {
  const roles = recipientRoles || (
    type === 'pending'
      ? ['PRODUCTION_MANAGER', 'PRODUCTION_CONTROL_MANAGER']
      : type === 'escalated'
        ? ['GENERAL_MANAGER']
        : []
  );
  const notice = {
    id: `N-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: new Date().toISOString(),
    code,
    type,
    title,
    message,
    to,
    read: false,
    recipientRoles: roles,
    recipientRole: roles[0] || null,
    responseHistory: []
  };
  data.notifications.unshift(notice);
  return notice;
}

function showToast(text, type = 'success') {
  const node = document.createElement('div');
  node.className = `app-toast ${type}`;
  node.textContent = text;
  $('#toastStack').append(node);
  setTimeout(() => node.remove(), 3200);
}

// LOT display markup
function urgencyBadge(lot) {
  if (isReady(lot)) return '<span class="badge-soft badge-ready">中殘完</span>';
  const u = urgency(lot);
  const badgeClass = u === 'urgent' ? 'badge-urgent' : u === 'watch' ? 'badge-watch' : 'badge-normal';
  const label = u === 'urgent' ? '至急' : u === 'watch' ? '注意' : '一般';
  return `<span class="badge-soft ${badgeClass}">${label}</span>`;
}

function stateBadge(lot) {
  return isReady(lot)
    ? '<span class="badge-soft badge-ready">中殘完</span>'
    : '<span class="badge-soft badge-pending">中檢工管待處理</span>';
}

function progressMarkup(lot) {
  const good = totalGood(lot);
  const percent = Math.min(100, Math.round(good / Math.max(1, lot.threshold) * 100));
  return `<div class="qty-cell"><div class="qty-line"><span>${good.toLocaleString()} / ${Number(lot.threshold).toLocaleString()}</span><strong>${percent}%</strong></div><div class="mini-progress"><span class="${isReady(lot)?'is-ready':''}" style="width:${percent}%"></span></div></div>`;
}

function sortedLots(list) {
  return [...list].sort((a, b) =>
    Number(isReady(a)) - Number(isReady(b)) ||
    Number(Boolean(b.escalatedAt)) - Number(Boolean(a.escalatedAt)) ||
    waitDays(b) - waitDays(a)
  );
}

function lotRow(lot, compact = false) {
  const latest = latestDisposition(lot);
  const repeated = Number(lot.repeatedFailures || 0);
  const escalationBadge = lot.escalatedAt
    ? '<span class="badge-soft badge-escalated">升級 GM</span>'
    : urgencyBadge(lot);

  if (compact) {
    return `<tr><td><div class="lot-code">${esc(lot.code)}</div><div class="lot-meta">${esc(lot.product)}</div></td><td>${progressMarkup(lot)}</td><td><span class="wait-num">${isReady(lot) ? '—' : waitDays(lot) + ' 天'}</span></td><td><div class="owner-cell"><strong>${esc(latest?.owner || '尚未指派')}</strong><small>${latest ? `處置 ${lot.dispositions.length} 次` : '尚無處置'}</small></div></td><td>${escalationBadge}</td><td><button class="tiny-action" data-detail="${esc(lot.code)}">明細</button></td></tr>`;
  }

  const repeatedBadge = repeated
    ? `<span class="badge-soft ${repeated >= data.settings.escalationThreshold ? 'badge-escalated' : 'badge-watch'}">${repeated} 次未達</span>`
    : '<span class="badge-soft badge-normal">0 次</span>';

  return `<tr><td><div class="lot-code">${esc(lot.code)}</div><div class="lot-meta">${esc(lot.product)} · ${esc(lot.workOrder)}</div></td><td>${progressMarkup(lot)}</td><td><strong>${gap(lot).toLocaleString()}</strong></td><td>${isReady(lot) ? '—' : `${waitDays(lot)} 天`}</td><td><div class="owner-cell"><strong>${esc(latest?.owner || '尚未指派')}</strong><small>${latest ? esc(latest.progress) : '尚無處置'}</small></div></td><td>${repeatedBadge}</td><td>${escalationBadge}</td><td><div class="status-cell">${stateBadge(lot)}<button class="tiny-action" data-detail="${esc(lot.code)}">查看明細</button></div></td></tr>`;
}

// Dashboard and list rendering
function renderDashboard() {
  const pending = data.lots.filter(l => !isReady(l));
  const ready = data.lots.filter(isReady);
  const urgent = pending.filter(l => urgency(l) === 'urgent');
  const escalated = pending.filter(l => l.escalatedAt);
  $('#kpiPending').textContent = pending.length;
  $('#kpiUrgent').textContent = `${urgent.length} 件至急`;
  $('#kpiGood').textContent = data.lots.reduce((sum, lot) => sum + totalGood(lot), 0).toLocaleString();
  $('#kpiReady').textContent = ready.length;
  $('#kpiRate').textContent = `${data.lots.length ? Math.round(ready.length / data.lots.length * 100) : 0}%`;
  $('#kpiEscalated').textContent = escalated.length;
  $('#pendingNavCount').textContent = pending.length;

  const focus = sortedLots(pending).slice(0, 5);
  $('#dashboardLotRows').innerHTML = focus.map(lot => lotRow(lot, true)).join('');
  $('#dashboardEmpty').classList.toggle('d-none', pending.length > 0);
  $('#progressPercent').textContent = `${data.lots.length ? Math.round(ready.length / data.lots.length * 100) : 0}%`;
  $('#progressRing').style.background =
    `conic-gradient(#38a87b ${data.lots.length ? ready.length / data.lots.length * 360 : 0}deg,#edf1f4 0deg)`;
  $('#progressReadyCount').textContent = `${ready.length} / ${data.lots.length} LOT 中殘完`;
  $('#pendingGood').innerHTML =
    `${pending.reduce((sum, lot) => sum + totalGood(lot), 0).toLocaleString()} <em>件</em>`;
  $('#pendingGap').innerHTML =
    `${pending.reduce((sum, lot) => sum + gap(lot), 0).toLocaleString()} <em>件</em>`;
  $('#longestWait').innerHTML =
    `${pending.length ? Math.max(...pending.map(waitDays)) : 0} <em>天</em>`;

  renderAttention(pending);
  renderTable();
}

function renderAttention(pending) {
  const ranked = sortedLots(pending).slice(0, 4);
  const html = ranked.map(lot => {
    let cls = 'info';
    let title = '待追蹤 LOT';
    let msg = `${totalGood(lot)} / ${lot.threshold} 件，尚差 ${gap(lot)} 件。`;

    if (lot.escalatedAt) {
      cls = '';
      title = '已升級總經理';
      msg = `${lot.code} 修理後仍中殘不足 ${lot.repeatedFailures} 次，等待 ${waitDays(lot)} 天。`;
    } else if (urgency(lot) === 'urgent') {
      cls = '';
      title = '至急：等待時間偏長';
      msg = `${lot.code} 已等待 ${waitDays(lot)} 天，請確認負責人與下一步。`;
    } else if (lot.repeatedFailures > 0) {
      cls = 'watch';
      title = '修理後仍中殘不足';
      msg = `${lot.code} 重檢未達 ${lot.repeatedFailures} 次，累計還差 ${gap(lot)} 件。`;
    } else if (urgency(lot) === 'watch') {
      cls = 'watch';
      title = '注意：請確認處置進度';
      msg = `${lot.code} 等待 ${waitDays(lot)} 天，距殘完尚差 ${gap(lot)} 件。`;
    }

    const symbol = lot.escalatedAt ? '↗' : urgency(lot) === 'urgent' ? '!' : '◷';
    return `<div class="attention-item"><div class="attention-symbol ${cls}">${symbol}</div><div><strong>${esc(title)}</strong><span>${esc(msg)}</span></div></div>`;
  }).join('');
  $('#attentionList').innerHTML = html || '<div class="empty-state">目前沒有待辦提醒。</div>';
}

function renderTable() {
  const q = ($('#searchInput')?.value || '').trim().toLowerCase();
  const status = $('#statusFilter')?.value || 'all';
  const urg = $('#urgencyFilter')?.value || 'all';
  const list = sortedLots(data.lots).filter(lot => {
    const searchFields = [lot.code, lot.product, lot.workOrder, latestDisposition(lot)?.owner];
    const matchesSearch = !q || searchFields.some(value =>
      String(value || '').toLowerCase().includes(q)
    );
    const matchesStatus = status === 'all' ||
      (status === 'ready' ? isReady(lot) : !isReady(lot));
    const matchesUrgency = urg === 'all' ||
      (urg === 'urgent' ? urgency(lot) === 'urgent' : urgency(lot) === urg);
    return matchesSearch && matchesStatus && matchesUrgency;
  });
  $('#allLotRows').innerHTML = list.map(lot => lotRow(lot, false)).join('');
  $('#allEmpty').classList.toggle('d-none', list.length > 0);
  $('#filterResult').textContent = `顯示 ${list.length} / ${data.lots.length} 筆`;
}

// Notification rendering
function responseHistoryMarkup(notice) {
  return (notice.responseHistory || []).map(response => {
    let status = '追蹤結果：尚待確認';
    if (response.outcome === 'ACHIEVED') {
      status = '追蹤結果：已達成';
    } else if (response.outcome === 'NOT_ACHIEVED') {
      status = response.escalationNoticeId
        ? '追蹤結果：未達成，已通知上一級'
        : '追蹤結果：未達成，已到最高層級';
    }

    const followupText = (response.followups || []).map(f => {
      const outcomeLabel = f.outcome === 'ACHIEVED' ? '確認已達成' : '確認未達成';
      const note = f.note ? ` · ${esc(f.note)}` : '';
      return `<p class="workflow-followup">${outcomeLabel} · ${fmtDate(f.followedUpAt, true)}${note}</p>`;
    }).join('');
    const escalationRole = response.escalationNoticeId
      ? roleLabel((data.notifications.find(n => n.id === response.escalationNoticeId) || {}).recipientRole)
      : '';
    const escalationText = response.escalationNoticeId ? `：${esc(escalationRole)}` : '';

    return `<div class="workflow-record"><strong>${esc(roleLabel(response.responderRole))}回覆：${esc(response.progress)}</strong><p>預計完成日：${esc(response.expectedCompletionDate)} · 回覆時間：${fmtDate(response.repliedAt, true)}</p><p class="workflow-status">${status}${escalationText}</p>${followupText}</div>`;
  }).join('');
}

function noticeActionMarkup(notice) {
  if (notice.type === 'ready') return '';
  const response = latestResponse(notice);
  if (!response) return `<button class="btn btn-sm btn-outline-primary" data-notice-action="reply" data-notice-id="${esc(notice.id)}">記錄處置回覆</button>`;
  if (!response.outcome) return `<button class="btn btn-sm btn-primary" data-notice-action="followup" data-notice-id="${esc(notice.id)}">追蹤承諾結果</button>`;
  return `<span class="workflow-complete">${response.outcome==='ACHIEVED'?'已達成':'已回覆未達成'}</span>`;
}

function renderNotices() {
  const list = [...data.notifications].sort((a, b) => new Date(b.date) - new Date(a.date));
  $('#notificationList').innerHTML = list.map(notice => {
    const isEscalated = notice.type === 'escalated' || notice.type === 'response-escalation';
    const kind = isEscalated ? 'red' : notice.type === 'ready' ? 'green' : '';
    const icon = isEscalated ? '↗' : notice.type === 'ready' ? '✓' : '◷';
    const tag = notice.type === 'response-escalation'
      ? '未達成升級'
      : notice.type === 'escalated'
        ? '升級通知'
        : notice.type === 'ready'
          ? '達標通知'
          : '待處理通知';
    const origin = notice.parentNotificationId
      ? `<p class="workflow-origin">升級來源：${esc(roleLabel(notice.escalationFromRole))}明確回覆未達成（上一級通知）</p>`
      : '';
    const history = responseHistoryMarkup(notice);
    return `<div class="notification-item"><div class="notification-icon ${kind}">${icon}</div><div class="notification-text"><strong>${esc(notice.title)} · ${esc(notice.code)}</strong><p>${esc(notice.message)}</p><small>${fmtDate(notice.date,true)}　通知對象：${esc(notice.to)}</small>${origin}${history ? `<div class="workflow-history">${history}</div>` : ''}<div class="notification-actions">${noticeActionMarkup(notice)}</div></div><span class="notification-tag">${tag}</span></div>`;
  }).join('');
  $('#notificationEmpty').classList.toggle('d-none', list.length > 0);
}

// Reports and settings
function renderReports() {
  const pending = data.lots.filter(lot => !isReady(lot));
  $('#reportPending').textContent = pending.length;
  $('#reportGood').textContent = pending
    .reduce((sum, lot) => sum + totalGood(lot), 0)
    .toLocaleString();
  $('#reportGap').textContent = pending
    .reduce((sum, lot) => sum + gap(lot), 0)
    .toLocaleString();
  $('#reportRepeated').textContent = pending.filter(lot => lot.repeatedFailures > 0).length;
  $('#reportEscalated').textContent = pending.filter(lot => lot.escalatedAt).length;

  const responses = data.notifications.flatMap(notice => notice.responseHistory || []);
  $('#reportFollowupWaiting').textContent = responses.filter(response => !response.outcome).length;
  $('#reportNotAchieved').textContent =
    responses.filter(response => response.outcome === 'NOT_ACHIEVED').length;
}

function populateLotSelects() {
  const dispositionOptions = data.lots
    .filter(lot => !isReady(lot))
    .map(lot => `<option value="${esc(lot.code)}">${esc(lot.code)}（累計 ${totalGood(lot)} / ${lot.threshold}）</option>`)
    .join('');

  $('#dispositionLot').innerHTML = dispositionOptions;
}

function renderInspectionLotResults() {
  const search = $('#inspectionLotSearch');
  const results = $('#inspectionLotResults');
  const query = search.value.trim().toLowerCase();
  const matches = sortedLots(data.lots)
    .filter(lot => lot.code.toLowerCase().includes(query));
  const visibleMatches = matches.slice(0, 8);

  if (!matches.length) {
    results.innerHTML = '<div class="lot-search-empty">找不到符合的 LOT 編號</div>';
  } else {
    const options = visibleMatches.map(lot =>
      `<button class="lot-search-option" type="button" role="option" data-lot-code="${esc(lot.code)}"><strong>${esc(lot.code)}</strong><span>${esc(lot.product)} · 累計 ${totalGood(lot)} / ${lot.threshold}</span></button>`
    ).join('');
    const moreResults = matches.length > visibleMatches.length
      ? '<div class="lot-search-hint">顯示前 8 筆，請輸入更多編號縮小範圍</div>'
      : '';
    results.innerHTML = `${options}${moreResults}`;
  }

  results.hidden = false;
  search.setAttribute('aria-expanded', 'true');
}

function hideInspectionLotResults() {
  $('#inspectionLotResults').hidden = true;
  $('#inspectionLotSearch').setAttribute('aria-expanded', 'false');
}

function selectInspectionLot(code) {
  const lot = data.lots.find(item => item.code === code);
  if (!lot) return;

  $('#inspectionLot').value = lot.code;
  $('#inspectionLotSearch').value = lot.code;
  hideInspectionLotResults();
}

function renderSettings() {
  $('#escalationThreshold').value = data.settings.escalationThreshold;
  $('#watchDays').value = data.settings.watchDays;
  $('#urgentDays').value = data.settings.urgentDays;
}

function refresh() {
  renderDashboard();
  renderNotices();
  renderReports();
  populateLotSelects();
  renderSettings();
  saveData();
}

function setView(name) {
  $$('.page-view').forEach(view => {
    view.classList.toggle('active', view.id === `view-${name}`);
  });
  $$('.side-nav .nav-item[data-view]').forEach(item => {
    item.classList.toggle('active', item.dataset.view === name);
  });

  const labels = {
    dashboard: '總覽',
    lots: 'LOT 追蹤',
    alerts: '通知紀錄',
    reports: '報表摘要'
  };
  $('#pageCrumb').textContent = labels[name] || '總覽';
}

function openDialog(id) {
  const dialog = $(`#${id}`);
  if (dialog && !dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = $(`#${id}`);
  if (dialog?.open) dialog.close();
}

// LOT details and CSV export
function openDetail(code) {
  const lot = data.lots.find(item => item.code === code);
  if (!lot) return;

  currentDetailCode = code;
  $('#detailTitle').textContent = lot.code;
  $('#detailSubtitle').textContent = `${lot.product} · 工單 ${lot.workOrder}`;

  const inspections = lot.inspections.map(item =>
    `<div class="timeline-item"><strong>中檢 ${fmtDate(item.date)} · 新增良品 ${Number(item.newlyGood).toLocaleString()} 件</strong><p>${esc(item.note || '無備註')} · 待修／再仕掛 ${Number(item.repair || 0)} 件</p></div>`
  ).join('');
  const dispositions = lot.dispositions.map(item =>
    `<div class="timeline-item"><strong>處置 ${fmtDate(item.date)} · ${esc(item.owner)}</strong><p>${esc(item.action)} · ${esc(item.progress)}${item.expected ? ` · 預計 ${esc(item.expected)}` : ''}</p></div>`
  ).join('');
  const notices = data.notifications
    .filter(notice => notice.code === lot.code)
    .map(notice => {
      const responses = (notice.responseHistory || []).map(response => {
        const outcome = response.outcome === 'ACHIEVED'
          ? '已達成'
          : response.outcome === 'NOT_ACHIEVED'
            ? '未達成'
            : '待追蹤';
        return `；${esc(roleLabel(response.responderRole))}回覆「${esc(response.progress)}」，預計 ${esc(response.expectedCompletionDate)}，結果：${outcome}`;
      }).join('');
      return `<div class="timeline-item"><strong>通知 ${fmtDate(notice.date, true)} · ${esc(notice.title)}（${esc(notice.to)}）</strong><p>${esc(notice.message)}${responses}</p></div>`;
    })
    .join('');
  const emptyDisposition = '<div class="timeline-item"><strong>尚無處置紀錄</strong><p>可由「更新處置」新增負責人與下一步。</p></div>';
  const emptyNotice = '<div class="timeline-item"><strong>尚無通知紀錄</strong></div>';

  $('#detailBody').innerHTML = `<div class="detail-summary"><div class="detail-tile"><small>累計良品 / 門檻</small><strong>${totalGood(lot).toLocaleString()} / ${Number(lot.threshold).toLocaleString()}</strong></div><div class="detail-tile"><small>尚差 / 等待</small><strong>${gap(lot).toLocaleString()} 件 / ${waitDays(lot)} 天</strong></div><div class="detail-tile"><small>狀態</small><strong>${isReady(lot) ? '可移轉印刷' : '中檢工管待處理'}</strong></div></div><div class="panel-title">中檢、處置與通知歷程</div><div class="timeline">${inspections}${dispositions || emptyDisposition}${notices || emptyNotice}</div>`;
  openDialog('detailDialog');
}

function downloadCSV() {
  const rows = [[
    'LOT編號', '品番', '工單', '累計新增良品', '移轉門檻', '距門檻差額',
    '等待天數', '負責人', '處置次數', '重檢仍未達次數', '狀態', '急迫性', '首次達標日期'
  ]];

  for (const lot of data.lots) {
    rows.push([
      lot.code,
      lot.product,
      lot.workOrder,
      totalGood(lot),
      lot.threshold,
      gap(lot),
      waitDays(lot),
      latestDisposition(lot)?.owner || '',
      lot.dispositions.length,
      lot.repeatedFailures,
      isReady(lot) ? '可移轉印刷' : '中檢工管待處理',
      lot.escalatedAt
        ? '升級總經理'
        : urgency(lot) === 'urgent'
          ? '急迫'
          : urgency(lot) === 'watch'
            ? '注意'
            : '一般',
      lot.firstReadyAt ? fmtDate(lot.firstReadyAt) : ''
    ]);
  }

  const csv = '\ufeff' + rows
    .map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'LOT追蹤摘要.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

// Form actions
function saveInspection(e) {
  e.preventDefault();

  const code = $('#inspectionLot').value;
  const lot = data.lots.find(item => item.code === code);
  const quantity = Number($('#newGoodQty').value);
  if (!lot) {
    showToast('請從搜尋結果選擇 LOT 編號。', 'warn');
    return;
  }
  if (!Number.isInteger(quantity) || quantity < 0) {
    showToast('請輸入有效的新增良品數。', 'warn');
    return;
  }

  const wasPending = !isReady(lot);
  const hadDisposition = lot.dispositions.length > 0;
  lot.inspections.push({
    date: isoDaysAgo(0),
    newlyGood: quantity,
    inspected: Number($('#inspectedQty').value || 0),
    repair: Number($('#repairQty').value || 0),
    defect: Number($('#defectQty').value || 0),
    note: $('#inspectionNote').value.trim()
  });

  if (wasPending && hadDisposition && !isReady(lot)) {
    lot.repeatedFailures = Number(lot.repeatedFailures || 0) + 1;
  }

  if (isReady(lot)) {
    if (!lot.firstReadyAt) lot.firstReadyAt = new Date().toISOString();
    makeNotice(
      lot.code,
      'ready',
      '已達印刷移轉門檻',
      `累計 ${totalGood(lot)} / ${lot.threshold} 件，已符合移轉印刷條件。`,
      '中檢人員、生產經理、生管經理'
    );
    showToast(`${lot.code} 已達移轉門檻，可移轉印刷。`, 'success');
  } else {
    if (!lot.pendingSince) lot.pendingSince = isoDaysAgo(0);
    if (!wasPending) {
      makeNotice(
        lot.code,
        'pending',
        'LOT 仍在中檢工管待處理',
        `累計 ${totalGood(lot)} / ${lot.threshold} 件；通知生產經理與生管經理。`,
        '生產經理、生管經理'
      );
    }

    if (
      lot.repeatedFailures >= Number(data.settings.escalationThreshold) &&
      !lot.escalatedAt
    ) {
      lot.escalatedAt = new Date().toISOString();
      makeNotice(
        lot.code,
        'escalated',
        '重複處置仍未達移轉門檻',
        `重檢未達 ${lot.repeatedFailures} 次，累計 ${totalGood(lot)} / ${lot.threshold} 件，依暫定展示門檻通知總經理。`,
        '總經理',
        ['GENERAL_MANAGER']
      );
      showToast(`${lot.code} 已符合暫定重檢升級條件，已建立總經理通知。`, 'warn');
    } else {
      showToast(`${lot.code} 中檢紀錄已新增，累計 ${totalGood(lot)} / ${lot.threshold} 件。`, 'success');
    }
  }

  $('#inspectionForm').reset();
  closeDialog('inspectionDialog');
  refresh();
}

function saveDisposition(e) {
  e.preventDefault();
  const lot = data.lots.find(item => item.code === $('#dispositionLot').value);
  if (!lot) return;

  const owner = $('#ownerName').value.trim();
  const progress = $('#progressStatus').value;
  lot.dispositions.push({
    date: new Date().toISOString(),
    action: $('#actionText').value.trim(),
    owner,
    progress,
    expected: $('#expectedDate').value
  });
  makeNotice(
    lot.code,
    'pending',
    '處置進度已更新',
    `負責人：${owner}；進度：${progress}。`,
    '生產經理、生管經理'
  );

  $('#dispositionForm').reset();
  closeDialog('dispositionDialog');
  refresh();
  showToast(`${lot.code} 處置進度已儲存。`);
}

function openNotificationAction(noticeId, mode) {
  const notice = data.notifications.find(item => item.id === noticeId);
  if (!notice) return;

  currentNoticeId = noticeId;
  currentNoticeAction = mode;
  const replying = mode === 'reply';
  $('#notificationActionTitle').textContent = replying ? '記錄通知處置回覆' : '追蹤承諾結果';
  $('#notificationActionIntro').textContent = replying
    ? '填寫目前進度與預計完成日。稍後請再回到通知紀錄，明確確認承諾是否達成。'
    : '請依實際回覆選擇是否達成；明確回覆未達成會建立通知，逐級送交上一級主管。';
  $('#notificationActionSummary').textContent =
    `${notice.code} · ${notice.title} · 通知對象：${notice.to}`;

  $('#replyFields').classList.toggle('d-none', !replying);
  $('#followupFields').classList.toggle('d-none', replying);
  $('#replyRole').innerHTML = notificationRoles(notice)
    .map(role => `<option value="${esc(role)}">${esc(roleLabel(role))}</option>`)
    .join('');
  $('#replyProgress').required = replying;
  $('#replyExpectedDate').required = replying;
  $('#followupOutcome').required = !replying;

  const response = latestResponse(notice);
  $('#followupSummary').textContent = response
    ? `${roleLabel(response.responderRole)}回覆：「${response.progress}」；預計完成日 ${response.expectedCompletionDate}。`
    : '';
  $('#notificationActionForm').reset();

  // reset() also resets visibility state and required flags in some browsers; re-apply modal mode.
  $('#replyFields').classList.toggle('d-none', !replying);
  $('#followupFields').classList.toggle('d-none', replying);
  $('#replyRole').required = replying;
  $('#replyProgress').required = replying;
  $('#replyExpectedDate').required = replying;
  $('#followupOutcome').required = !replying;
  if (replying) {
    $('#replyRole').innerHTML = notificationRoles(notice)
      .map(role => `<option value="${esc(role)}">${esc(roleLabel(role))}</option>`)
      .join('');
  }
  $('#notificationActionSubmit').textContent = replying ? '儲存回覆' : '儲存追蹤結果';
  openDialog('notificationActionDialog');
}

function saveNotificationAction(e) {
  e.preventDefault();
  const notice = data.notifications.find(item => item.id === currentNoticeId);
  if (!notice) return;

  if (currentNoticeAction === 'reply') {
    const response = recordNotificationResponse(notice, {
      responderRole: $('#replyRole').value,
      progress: $('#replyProgress').value,
      expectedCompletionDate: $('#replyExpectedDate').value
    });
    closeDialog('notificationActionDialog');
    refresh();
    showToast(`${notice.code} 處置進度與預計完成日已記錄。`);
    return response;
  }

  const response = latestResponse(notice);
  const outcome = $('#followupOutcome').value;
  const result = followUpNotificationResponse(
    data,
    notice,
    response,
    outcome,
    $('#followupNote').value
  );
  if (result.error) {
    showToast('此回覆已追蹤或結果無效，請重新檢查。', 'warn');
    return;
  }

  closeDialog('notificationActionDialog');
  refresh();
  if (outcome === 'ACHIEVED') {
    showToast(`${notice.code} 已記錄為承諾達成。`);
  } else if (result.escalation) {
    showToast(
      `${notice.code} 已記錄未達成，並建立通知給${roleLabel(result.escalation.recipientRole)}。`,
      'warn'
    );
  } else {
    showToast('已記錄未達成；目前通知層級為董事長，沒有更上一級可通知。', 'warn');
  }
}

function saveSettings(e) {
  e.preventDefault();
  const watch = Number($('#watchDays').value);
  const urgent = Number($('#urgentDays').value);
  const escalation = Number($('#escalationThreshold').value);
  if (
    !Number.isInteger(watch) ||
    !Number.isInteger(urgent) ||
    !Number.isInteger(escalation) ||
    watch < 1 ||
    urgent <= watch ||
    escalation < 1
  ) {
    showToast('請確認急迫天數大於注意天數，升級次數至少為 1。', 'warn');
    return;
  }

  data.settings = {
    watchDays: watch,
    urgentDays: urgent,
    escalationThreshold: escalation
  };
  closeDialog('settingsDialog');
  refresh();
  showToast('展示規則已更新。');
}
// Event binding and app initialization
function bindEvents() {
  $$('.side-nav .nav-item[data-view]').forEach(button => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  $$('[data-go]').forEach(button => {
    button.addEventListener('click', () => setView(button.dataset.go));
  });

  $('#addInspectionBtn').addEventListener('click', () => openDialog('inspectionDialog'));
  $('#addInspectionBtn2').addEventListener('click', () => openDialog('inspectionDialog'));
  $('#closeInspectionDialog').addEventListener('click', () => closeDialog('inspectionDialog'));
  $('#cancelInspectionDialog').addEventListener('click', () => closeDialog('inspectionDialog'));
  $('#inspectionLotSearch').addEventListener('focus', renderInspectionLotResults);
  $('#inspectionLotSearch').addEventListener('input', () => {
    const query = $('#inspectionLotSearch').value.trim().toLowerCase();
    const exactMatch = data.lots.find(lot => lot.code.toLowerCase() === query);
    $('#inspectionLot').value = exactMatch ? exactMatch.code : '';
    renderInspectionLotResults();
  });
  $('#inspectionLotSearch').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!$('#inspectionLotResults').hidden) {
        event.preventDefault();
        hideInspectionLotResults();
      }
    } else if (event.key === 'ArrowDown') {
      if ($('#inspectionLotResults').hidden) renderInspectionLotResults();
      const firstOption = $('#inspectionLotResults').querySelector('.lot-search-option');
      if (firstOption) {
        event.preventDefault();
        firstOption.focus();
      }
    }
  });
  $('#inspectionLotResults').addEventListener('click', event => {
    const option = event.target.closest('[data-lot-code]');
    if (option) selectInspectionLot(option.dataset.lotCode);
  });
  $('#inspectionLotResults').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hideInspectionLotResults();
      $('#inspectionLotSearch').focus();
    }
  });
  $('#settingsButton').addEventListener('click', () => openDialog('settingsDialog'));
  $('#settingsTopButton').addEventListener('click', () => openDialog('settingsDialog'));

  $('#inspectionForm').addEventListener('submit', saveInspection);
  $('#dispositionForm').addEventListener('submit', saveDisposition);
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#notificationActionForm').addEventListener('submit', saveNotificationAction);
  $('#searchInput').addEventListener('input', renderTable);
  $('#statusFilter').addEventListener('change', renderTable);
  $('#urgencyFilter').addEventListener('change', renderTable);
  $('#exportBtn').addEventListener('click', downloadCSV);
  $('#exportLotsBtn').addEventListener('click', downloadCSV);
  $('#exportReportBtn').addEventListener('click', downloadCSV);

  $('#clearNoticeBtn').addEventListener('click', () => {
    data.notifications = data.notifications.filter(notice =>
      !notice.read ||
      (notice.responseHistory || []).length ||
      notice.parentNotificationId ||
      data.notifications.some(other =>
        (other.responseHistory || []).some(response => response.escalationNoticeId === notice.id)
      )
    );
    refresh();
    showToast('已清除未涉及回覆／升級歷程的已讀展示通知。');
  });

  $('#resetDemoBtn').addEventListener('click', () => {
    if (confirm('重設後將回到預設展示 LOT 與通知，確定繼續？')) {
      data = seededData();
      refresh();
      closeDialog('settingsDialog');
      showToast('展示資料已重設。');
    }
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.lot-search')) hideInspectionLotResults();

    const detail = event.target.closest('[data-detail]');
    if (detail) openDetail(detail.dataset.detail);

    const action = event.target.closest('[data-notice-action]');
    if (action) {
      openNotificationAction(action.dataset.noticeId, action.dataset.noticeAction);
    }
  });

  $('#closeDetail').addEventListener('click', () => closeDialog('detailDialog'));
  $('#closeDetail2').addEventListener('click', () => closeDialog('detailDialog'));
  $('#detailAddDisposition').addEventListener('click', () => {
    const lot = data.lots.find(item => item.code === currentDetailCode);
    closeDialog('detailDialog');
    if (lot) {
      populateLotSelects();
      $('#dispositionLot').value = lot.code;
      openDialog('dispositionDialog');
    }
  });
  $('#closeNotificationAction').addEventListener('click', () => closeDialog('notificationActionDialog'));
}

function init() {
  $('#todayLabel').textContent = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(new Date());
  bindEvents();
  refresh();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ESCALATION_CHAIN,
    ROLE_LABELS,
    roleLabel,
    nextHigherRole,
    notificationRoles,
    recordNotificationResponse,
    followUpNotificationResponse
  };
} else {
  init();
}
