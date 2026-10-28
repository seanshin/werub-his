/**
 * 상담데스크 시드 — 팀 4 / 신규 상담원 직원계정 12 / 예시 세션 7 (멱등).
 * 실행: cd apps/api && node prisma/seeds/consult-desk.seed.cjs
 * - 상담원은 전담 신규 직원계정(consult.*@hospital.example.org, 비번 staff1234!, role CRM_STAFF)으로 생성.
 * - 팀: 이름 upsert(기본팀 '일반상담'). 상담원: email→User upsert + ConsultAgent.
 * - 예시 세션: 고정 UUID(delete→insert)로 멱등, 기존 seed 환자에 연결.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const p = new PrismaClient();

const now = Date.now();
const ago = (d = 0, h = 0, m = 0) => new Date(now - d * 86400000 - h * 3600000 - m * 60000);

async function upsertTeam(name, data) {
  const found = await p.consultTeam.findFirst({ where: { name } });
  if (found) { await p.consultTeam.update({ where: { id: found.id }, data }); return found.id; }
  return (await p.consultTeam.create({ data: { name, ...data } })).id;
}

// 신규 상담원 직원계정 정의 (팀·역할·상태)
const STAFF = [
  { email: 'consult.general.lead@hospital.example.org', fn: '오', gn: '일반팀장', team: 'general', role: 'LEAD', status: 'ONLINE' },
  { email: 'consult.general1@hospital.example.org', fn: '김', gn: '일반상담1', team: 'general', role: 'AGENT', status: 'ONLINE' },
  { email: 'consult.general2@hospital.example.org', fn: '이', gn: '일반상담2', team: 'general', role: 'AGENT', status: 'AWAY' },
  { email: 'consult.intl.lead@hospital.example.org', fn: '박', gn: '국제팀장', team: 'intl', role: 'LEAD', status: 'ONLINE' },
  { email: 'consult.intl1@hospital.example.org', fn: '최', gn: '국제상담1', team: 'intl', role: 'AGENT', status: 'ONLINE' },
  { email: 'consult.intl2@hospital.example.org', fn: '정', gn: '국제상담2', team: 'intl', role: 'AGENT', status: 'OFFLINE' },
  { email: 'consult.checkup.lead@hospital.example.org', fn: '강', gn: '검진팀장', team: 'checkup', role: 'LEAD', status: 'ONLINE' },
  { email: 'consult.checkup1@hospital.example.org', fn: '윤', gn: '검진상담1', team: 'checkup', role: 'AGENT', status: 'ONLINE' },
  { email: 'consult.checkup2@hospital.example.org', fn: '장', gn: '검진상담2', team: 'checkup', role: 'AGENT', status: 'BUSY' },
  { email: 'consult.billing.lead@hospital.example.org', fn: '한', gn: '수납팀장', team: 'billing', role: 'LEAD', status: 'ONLINE' },
  { email: 'consult.billing1@hospital.example.org', fn: '서', gn: '수납상담1', team: 'billing', role: 'AGENT', status: 'ONLINE' },
  { email: 'consult.billing2@hospital.example.org', fn: '신', gn: '수납상담2', team: 'billing', role: 'AGENT', status: 'AWAY' },
];

require('../seed-mode-guard').assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모 — REAL 에서 중단(상용 릴리즈 T2-3)
(async () => {
  try {
    const patients = (await p.patient.findMany({ orderBy: { id: 'asc' }, take: 7, select: { id: true } })).map((u) => u.id);
    if (patients.length < 7) { console.log(`SKIP — 환자 부족(${patients.length})`); await p.$disconnect(); return; }
    const passwordHash = await bcrypt.hash('staff1234!', 12);

    // ── 팀 4 ──
    const tGeneral = await upsertTeam('일반상담', { description: '미분류 상담 수용 기본팀', categories: ['GENERAL'], locales: null, defaultAiMode: 'AUTO', isDefault: true, active: true });
    await p.consultTeam.updateMany({ where: { id: { not: tGeneral }, isDefault: true }, data: { isDefault: false } });
    const tIntl = await upsertTeam('국제진료팀', { description: '외국인/국제진료 상담(영어·중국어)', categories: ['INTERNATIONAL'], locales: ['en', 'zh'], defaultAiMode: 'SUGGEST', isDefault: false, active: true });
    const tCheckup = await upsertTeam('검진상담팀', { description: '건강검진 예약·결과 상담', categories: ['CHECKUP'], locales: null, defaultAiMode: 'AUTO', isDefault: false, active: true });
    const tBilling = await upsertTeam('수납상담팀', { description: '수납·청구·보험 상담', categories: ['BILLING'], locales: null, defaultAiMode: 'OFF', isDefault: false, active: true });
    const TEAM = { general: tGeneral, intl: tIntl, checkup: tCheckup, billing: tBilling };

    // ── 신규 상담원 직원계정 + 프로필 ──
    const uidByEmail = {};
    for (const s of STAFF) {
      const u = await p.user.upsert({
        where: { email: s.email },
        update: { familyName: s.fn, givenName: s.gn, department: '고객상담', specialty: `${s.team}상담`, role: 'CRM_STAFF' },
        create: { email: s.email, passwordHash, familyName: s.fn, givenName: s.gn, role: 'CRM_STAFF', department: '고객상담', specialty: `${s.team}상담` },
      });
      uidByEmail[s.email] = u.id;
      await p.consultAgent.upsert({
        where: { userId: u.id },
        create: { userId: u.id, teamId: TEAM[s.team], role: s.role, status: s.status, maxConcurrent: 5 },
        update: { teamId: TEAM[s.team], role: s.role, status: s.status, maxConcurrent: 5 },
      });
    }
    // 이전 시드(기존 직원 기반) 상담원 프로필 정리 — 신규 계정만 남김.
    // 파괴적이므로 CONSULT_SEED_RESET=1 일 때만(운영서 관리자 추가분 보호). 기본은 비파괴 upsert.
    if (process.env.CONSULT_SEED_RESET === '1') {
      const r = await p.consultAgent.deleteMany({ where: { userId: { notIn: Object.values(uidByEmail) } } });
      console.log(`reset: 비시드 상담원 ${r.count}건 제거`);
    }

    const U = (e) => uidByEmail[`consult.${e}@hospital.example.org`];
    const gLead = U('general.lead'), gA1 = U('general1'), iA1 = U('intl1'), cLead = U('checkup.lead'), bLead = U('billing.lead');

    // ── 예시 세션 7 (고정 UUID·멱등) ──
    const SID = (n) => `dddddddd-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
    const ids = Array.from({ length: 7 }, (_, i) => SID(i + 1));
    await p.consultMessage.deleteMany({ where: { sessionId: { in: ids } } });
    await p.consultSession.deleteMany({ where: { id: { in: ids } } });
    const M = (sessionId, sender, content, createdAt, extra = {}) => ({ sessionId, sender, content, contentKo: content, lang: extra.lang ?? 'ko', visibility: extra.visibility ?? 'PATIENT', senderId: extra.senderId ?? null, createdAt });

    await p.consultSession.create({ data: { id: ids[0], patientId: patients[0], status: 'CLOSED', locale: 'ko', category: 'GENERAL', teamId: tGeneral, aiMode: 'AUTO', assigneeId: gA1, rating: 5, ratingComment: '친절했어요', firstResponseAt: ago(2, 0, -3), createdAt: ago(2), updatedAt: ago(2, -1) } });
    await p.consultMessage.createMany({ data: [
      M(ids[0], 'PATIENT', '진료 예약 변경하고 싶어요', ago(2)),
      M(ids[0], 'AI', '안녕하세요. 예약 변경은 예약 메뉴 또는 상담원 연결로 도와드릴 수 있어요.', ago(2, 0, -2)),
      M(ids[0], 'STAFF', '원하시는 날짜 알려주시면 변경해 드릴게요.', ago(2, 0, -3), { senderId: gA1 }),
    ] });

    await p.consultSession.create({ data: { id: ids[1], patientId: patients[1], status: 'CLOSED', locale: 'ko', category: 'CHECKUP', teamId: tCheckup, aiMode: 'AUTO', assigneeId: cLead, rating: 4, firstResponseAt: ago(1, 3, -5), createdAt: ago(1, 3), updatedAt: ago(1, 2) } });
    await p.consultMessage.createMany({ data: [
      M(ids[1], 'PATIENT', '종합검진 결과 언제 나오나요?', ago(1, 3)),
      M(ids[1], 'STAFF', '보통 5영업일 내 포털에서 확인 가능하세요.', ago(1, 3, -5), { senderId: cLead }),
    ] });

    await p.consultSession.create({ data: { id: ids[2], patientId: patients[2], status: 'ACTIVE', locale: 'en', category: 'INTERNATIONAL', teamId: tIntl, aiMode: 'SUGGEST', assigneeId: iA1, firstResponseAt: ago(0, 2, -4), createdAt: ago(0, 2), updatedAt: ago(0, 1) } });
    await p.consultMessage.createMany({ data: [
      M(ids[2], 'PATIENT', 'Hello, I need an interpreter for my appointment.', ago(0, 2), { lang: 'en' }),
      M(ids[2], 'STAFF', 'We will arrange an interpreter. May I have your appointment date?', ago(0, 2, -4), { lang: 'en', senderId: iA1 }),
    ] });

    await p.consultSession.create({ data: { id: ids[3], patientId: patients[3], status: 'ACTIVE', locale: 'ko', category: 'GENERAL', teamId: tGeneral, aiMode: 'AUTO', assigneeId: gA1, leadEscalatedAt: ago(0, 0, 20), escalatedToId: gLead, escalationReason: '환불 규정 확인 필요', priority: 'HIGH', firstResponseAt: ago(0, 0, 40), createdAt: ago(0, 1), updatedAt: ago(0, 0, 5) } });
    await p.consultMessage.createMany({ data: [
      M(ids[3], 'PATIENT', '예약 취소하면 결제 금액 환불되나요?', ago(0, 1)),
      M(ids[3], 'STAFF', '확인 후 안내드리겠습니다.', ago(0, 0, 40), { senderId: gA1 }),
      M(ids[3], 'LEAD', '이 건 환불 규정 §3 적용. 50% 위약금 안내하세요.', ago(0, 0, 18), { visibility: 'INTERNAL', senderId: gLead }),
    ] });

    await p.consultSession.create({ data: { id: ids[4], patientId: patients[4], status: 'OPEN', locale: 'ko', category: 'BILLING', teamId: tBilling, aiMode: 'OFF', createdAt: ago(0, 0, 12), updatedAt: ago(0, 0, 12) } });
    await p.consultMessage.createMany({ data: [M(ids[4], 'PATIENT', '진료비 영수증 재발급 가능한가요?', ago(0, 0, 12))] });

    await p.consultSession.create({ data: { id: ids[5], patientId: patients[5], status: 'OPEN', locale: 'ko', category: 'GENERAL', teamId: tGeneral, aiMode: 'AUTO', createdAt: ago(0, 0, 6), updatedAt: ago(0, 0, 5) } });
    await p.consultMessage.createMany({ data: [
      M(ids[5], 'PATIENT', '주차장 위치가 어디인가요?', ago(0, 0, 6)),
      M(ids[5], 'AI', '본관 지하 1~3층에 주차장이 있습니다. 정문 진입 후 안내표지를 따라가세요.', ago(0, 0, 5)),
    ] });

    await p.consultSession.create({ data: { id: ids[6], patientId: patients[6], status: 'CLOSED', locale: 'ko', category: 'BILLING', teamId: tBilling, aiMode: 'OFF', assigneeId: bLead, rating: 3, firstResponseAt: ago(3, 0, -8), createdAt: ago(3), updatedAt: ago(3, -2) } });
    await p.consultMessage.createMany({ data: [
      M(ids[6], 'PATIENT', '보험 청구용 서류 떼고 싶어요', ago(3)),
      M(ids[6], 'STAFF', '진단서·진료비 세부내역서 발급 도와드리겠습니다.', ago(3, 0, -8), { senderId: bLead }),
    ] });

    console.log(`SEED_DONE staff=${STAFF.length} teams=${await p.consultTeam.count()} agents=${await p.consultAgent.count()} sessions=${await p.consultSession.count()} (비번 staff1234!)`);
  } catch (e) { console.log('ERROR:', e.message); }
  finally { await p.$disconnect(); }
})();
