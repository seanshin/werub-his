import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * JCI GLD 샘플 (위원회/위원/회의/정책) — 일회성
 * 실행: npx ts-node prisma/seed-gld-samples.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const day = (offset: number) => new Date(Date.now() + offset * 86400000);

/**
 * 🔴 **위원회를 여기서 만들지 않는다**(2026-08-27).
 *
 *    이 목록이 `code` 없이 위원회를 생성해 왔고, 그래서 운영에 **코드 없는 위원회 6건**이
 *    남아 있다(안건 0·의결 0·표면 0). 게다가 이름이 정본과 겹친다 —
 *    `질향상위원회` vs `QPS 질향상·환자안전위원회`, `감염관리위원회`(IC 와 중복) 등.
 *
 *    `code` 는 집행 컨텍스트(`committee.code`)와 표면 맵이 쓰는 식별자다.
 *    빈 코드 위원회는 안건 상신 목록에 섞여 **사람이 잘못 고르게 만든다.**
 *
 *    정본은 `governance.service.ts` 의 `COMMITTEE_SEED`(advisory lock upsert) 하나다.
 *    샘플 시드는 **이미 있는 위원회에 회의·위원만 붙인다.**
 */
const COMMITTEE_CODES = ['QPS', 'SAFE', 'IC', 'DTC', 'ETH', 'MRC'];

const POLICIES = [
  { code: 'QPS-001', title: '환자안전사건 보고 및 관리 규정', category: 'SAFETY', review: 120, status: 'ACTIVE' },
  { code: 'PCI-002', title: '손위생 수행 지침', category: 'INFECTION', review: -30, status: 'ACTIVE' },
  { code: 'IPSG-003', title: '정확한 환자확인 절차', category: 'CLINICAL', review: 200, status: 'ACTIVE' },
  { code: 'MMU-004', title: '고위험 약물 관리 규정', category: 'CLINICAL', review: -10, status: 'ACTIVE' },
  { code: 'GLD-005', title: '위원회 운영 규정', category: 'ADMIN', review: 300, status: 'ACTIVE' },
  { code: 'COP-006', title: '연명의료 결정 절차', category: 'CLINICAL', review: 0, status: 'DRAFT' },
];

async function main() {
  const doctors = await prisma.user.findMany({ where: { role: 'DOCTOR', isActive: true }, take: 20, select: { id: true } });
  const staff = await prisma.user.findMany({ where: { isActive: true, role: { in: ['DOCTOR', 'NURSE', 'PHARMACIST'] as never } }, take: 40, select: { id: true } });
  if (!doctors.length) { console.log('의사 데이터 없음'); return; }

  /**
   * 🔴 **위원회를 지우거나 만들지 않는다**(2026-08-27 교정).
   *
   *    종전 코드는 이름으로 `committee.deleteMany` 를 했다. 그런데 샘플 이름
   *    `감염관리위원회` 는 **정본 `IC` 와 이름이 같다** — 즉 이 시드는 안건·의결이 달린
   *    실제 위원회를 지울 수 있었다. 그리고 새로 만들 때 `code` 를 넣지 않아
   *    운영에 **코드 없는 위원회 6건**이 남았다(안건 0·의결 0·표면 0).
   *
   *    이제 정본(`COMMITTEE_SEED`)이 만든 위원회를 **코드로 찾아** 위원·회의만 붙인다.
   *    없으면 만들지 않고 건너뛴다 — 시드가 정본을 앞지르지 않는다.
   */
  let ci = 0, mi = 0;
  const created: { id: string; name: string }[] = [];
  for (let i = 0; i < COMMITTEE_CODES.length; i++) {
    const code = COMMITTEE_CODES[i];
    const committee = await prisma.committee.findFirst({ where: { code }, select: { id: true, name: true } });
    if (!committee) { console.log(`위원회 ${code} 없음 — 건너뜀(정본 시드가 먼저 돌아야 한다)`); continue; }
    created.push({ id: committee.id, name: committee.name });
    ci++;
    const chair = doctors[i % doctors.length];
    // 위원 — 이미 있으면 다시 만들지 않는다(중복 위원 방지)
    const already = await prisma.committeeMember.count({ where: { committeeId: committee.id } });
    if (already === 0) {
      await prisma.committeeMember.create({ data: { committeeId: committee.id, userId: chair.id, role: 'CHAIR' } });
      for (let k = 1; k <= 4; k++) {
        const u = staff[(i * 4 + k) % staff.length];
        if (u && u.id !== chair.id) await prisma.committeeMember.create({ data: { committeeId: committee.id, userId: u.id, role: k === 1 ? 'SECRETARY' : 'MEMBER' } });
      }
    }
    // 회의 — 같은 제목이 이미 있으면 건너뛴다
    const meetings = await prisma.committeeMeeting.count({ where: { committeeId: committee.id } });
    if (meetings === 0) {
      await prisma.committeeMeeting.create({ data: { committeeId: committee.id, title: `${committee.name} 정기회의 (${new Date().getMonth()}월)`, scheduledAt: day(-20), location: '본관 3층 대회의실', agenda: '1. 지난 회의 결과 보고\n2. 주요 지표 검토\n3. 개선활동 심의', minutes: '안건별 심의 후 개선과제 3건 채택, 차기 회의 시 이행률 점검하기로 의결함.', status: 'COMPLETED' } });
      await prisma.committeeMeeting.create({ data: { committeeId: committee.id, title: `${committee.name} 정기회의 (예정)`, scheduledAt: day(10), location: '본관 3층 대회의실', agenda: '1. 이행과제 점검\n2. 신규 안건', status: 'SCHEDULED' } });
      mi += 2;
    }
  }

  // 정책 (일부는 위원회 연결)
  const gldCommittee = created[0]; // 🔴 이름으로 찾지 않는다 — 정본 이름은 '질향상·환자안전위원회'다
  const approver = doctors[0];
  for (const p of POLICIES) {
    await prisma.institutionalPolicy.create({
      data: {
        code: p.code, title: p.title, category: p.category, status: p.status,
        committeeId: gldCommittee?.id,
        reviewDate: day(p.review),
        ...(p.status === 'ACTIVE' ? { approvedBy: approver.id, approvedAt: day(-180), effectiveDate: day(-180) } : {}),
      },
    });
  }

  console.log(`GLD 샘플: 위원회 ${ci}건 / 회의 ${mi}건 / 정책 ${POLICIES.length}건 생성`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
