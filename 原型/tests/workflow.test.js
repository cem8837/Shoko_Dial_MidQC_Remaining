const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ESCALATION_CHAIN,
  nextHigherRole,
  notificationRoles,
  recordNotificationResponse,
  followUpNotificationResponse
} = require('../app.js');

function makeData() {
  return { notifications: [] };
}
function makeNotice(role = 'PRODUCTION_MANAGER') {
  return {
    id: 'N-TEST-1',
    code: 'LOT-TEST-001',
    type: 'pending',
    recipientRole: role,
    recipientRoles: [role],
    responseHistory: []
  };
}

test('主管升級鏈由組長逐級上行至董事長，無更上一級時回傳 null', () => {
  assert.deepEqual(ESCALATION_CHAIN, [
    'GROUP_LEADER', 'STOCK_LEADER', 'SECTION_CHIEF', 'PRODUCTION_MANAGER',
    'PRODUCTION_VP', 'GENERAL_MANAGER', 'CHAIRMAN'
  ]);
  assert.deepEqual(
    ESCALATION_CHAIN.slice(0, -1).map(role => nextHigherRole(role)),
    ESCALATION_CHAIN.slice(1)
  );
  assert.equal(nextHigherRole('CHAIRMAN'), null);
});

test('生管經理與生產經理協同，兩者未達成時都升至生產副總', () => {
  assert.equal(nextHigherRole('PRODUCTION_MANAGER'), 'PRODUCTION_VP');
  assert.equal(nextHigherRole('PRODUCTION_CONTROL_MANAGER'), 'PRODUCTION_VP');
  assert.deepEqual(notificationRoles({ type: 'pending' }), ['PRODUCTION_MANAGER', 'PRODUCTION_CONTROL_MANAGER']);
});

test('通知回覆會保存角色、進度、預計完成日並等待後續追蹤', () => {
  const notice = makeNotice();
  const response = recordNotificationResponse(notice, {
    responderRole: 'PRODUCTION_MANAGER',
    progress: '已安排修理，等待再檢',
    expectedCompletionDate: '2026-11-25',
    repliedAt: '2026-11-18T09:00:00.000Z'
  });
  assert.equal(notice.responseHistory.length, 1);
  assert.equal(response.progress, '已安排修理，等待再檢');
  assert.equal(response.expectedCompletionDate, '2026-11-25');
  assert.equal(response.outcome, null);
});

test('追蹤為已達成時保存結果，不建立上一級通知', () => {
  const data = makeData();
  const notice = makeNotice();
  const response = recordNotificationResponse(notice, {
    responderRole: 'PRODUCTION_MANAGER', progress: '完成修理', expectedCompletionDate: '2026-11-25'
  });
  const result = followUpNotificationResponse(data, notice, response, 'ACHIEVED', '已按期完成', '2026-11-25T08:00:00.000Z');
  assert.equal(result.response.outcome, 'ACHIEVED');
  assert.equal(result.escalation, null);
  assert.equal(data.notifications.length, 0);
  assert.equal(response.followups[0].note, '已按期完成');
});

test('生產經理回覆未達成時通知生產副總並保存通知關聯', () => {
  const data = makeData();
  const notice = makeNotice('PRODUCTION_MANAGER');
  const response = recordNotificationResponse(notice, {
    responderRole: 'PRODUCTION_MANAGER', progress: '修理尚未完成', expectedCompletionDate: '2026-11-25'
  });
  const result = followUpNotificationResponse(data, notice, response, 'NOT_ACHIEVED', '零件未到', '2026-11-26T08:00:00.000Z');
  assert.equal(result.escalation.recipientRole, 'PRODUCTION_VP');
  assert.equal(result.escalation.parentNotificationId, notice.id);
  assert.equal(result.escalation.escalationFromRole, 'PRODUCTION_MANAGER');
  assert.equal(response.outcome, 'NOT_ACHIEVED');
  assert.equal(response.escalationNoticeId, result.escalation.id);
  assert.equal(data.notifications[0], result.escalation);
});

test('生產副總、總經理未達成會依序通知總經理、董事長', () => {
  const data = makeData();
  for (const [role, expected] of [['PRODUCTION_VP', 'GENERAL_MANAGER'], ['GENERAL_MANAGER', 'CHAIRMAN']]) {
    const notice = makeNotice(role);
    const response = recordNotificationResponse(notice, {
      responderRole: role, progress: '處置未完成', expectedCompletionDate: '2026-11-30'
    });
    const result = followUpNotificationResponse(data, notice, response, 'NOT_ACHIEVED', '尚未達成', '2026-11-30T08:00:00.000Z');
    assert.equal(result.escalation.recipientRole, expected);
  }
  assert.equal(data.notifications.length, 2);
});

test('董事長回覆未達成仍保存結果，但不會建立不存在的上一級通知', () => {
  const data = makeData();
  const notice = makeNotice('CHAIRMAN');
  const response = recordNotificationResponse(notice, {
    responderRole: 'CHAIRMAN', progress: '仍未完成', expectedCompletionDate: '2026-12-01'
  });
  const result = followUpNotificationResponse(data, notice, response, 'NOT_ACHIEVED', '最高層級待決策', '2026-12-02T08:00:00.000Z');
  assert.equal(result.topLevel, true);
  assert.equal(result.escalation, null);
  assert.equal(response.outcome, 'NOT_ACHIEVED');
  assert.equal(data.notifications.length, 0);
});
