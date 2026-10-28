import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 위원회 위원 **리허설 구성** — 현재 재직 의료진 기준 (2026-08-28).
 *
 * 사람 지시: *"위원회 설정도 현재 의료진 기준으로 시드 데이터 연결해서 진행."*
 *
 * 🔴 발단(실측): 정본 위원회 9개가 **전부 위원 0명**인데 의결이 누적돼 있었다.
 *    참석자는 `["a","b","c","d","e"]` — 정족수가 문자 다섯 개로 충족됐다.
 *    명부를 채워야 정족수 명부 게이트가 의미를 갖는다.
 *
 * 🔴 **이 스크립트가 지키는 것 넷**
 *
 *  ① **시드는 임명이 아니다.** 전부 `source='SEED'` · `appointedBy=null` 로 넣는다.
 *     화면이 "위원 5명"만 보면 임명이 끝난 줄 안다 — Go-Live 준비율이 시드 결재를
 *     실결재로 세어 65%(실제 45%)를 표시한 전례가 있다.
 *  ② **사람이 손댄 것을 덮지 않는다.** `source='MANUAL'` 위원이 하나라도 있는 위원회는
 *     **통째로 건너뛴다**(부분 개입이 더 위험하다 — 사람 구성 위에 시드가 얹힌다).
 *  ③ **결정적으로 고른다.** 난수 없음 — 역할·부서 우선순위 + 이름 정렬. 여러 번 돌려도
 *     같은 사람이 뽑힌다(그래야 "누가 위원인가"가 실행마다 바뀌지 않는다).
 *  ④ **정족수를 못 채우면 채운 척하지 않는다.** 후보가 부족하면 넣을 수 있는 만큼만
 *     넣고 **부족을 출력한다**. 아무나 끌어와 숫자를 맞추면 명부가 거짓이 된다.
 *
 * 실행: `npx ts-node prisma/seed-committee-members.ts`
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Pick_ = {
  /** 이 자리에 앉힐 사람의 조건 — 위에서부터 찾는다(못 찾으면 다음 대안) */
  want: Array<{ role?: string; dept?: string; deptLike?: string }>;
  as: 'CHAIR' | 'SECRETARY' | 'MEMBER';
  /** 이 자리가 무엇인지 — 부족할 때 무엇이 비었는지 말하기 위해 */
  label: string;
};

/**
 * 위원회별 구성 — **실무에서 그 위원회에 실제로 들어가는 직군**으로 적는다.
 * 🔴 정족수는 위원회 정본(`COMMITTEE_SEED`)이 갖는다. 여기서 다시 적지 않는다.
 */
const COMPOSITION: Record<string, Pick_[]> = {
  // 약사위원회 — 약제 + 처방 의사
  DTC: [
    { as: 'CHAIR', label: '위원장(의사)', want: [{ role: 'DOCTOR', dept: '내과' }] },
    { as: 'SECRETARY', label: '간사(약사)', want: [{ role: 'PHARMACIST' }] },
    { as: 'MEMBER', label: '약사', want: [{ role: 'PHARMACIST' }] },
    { as: 'MEMBER', label: '의사', want: [{ role: 'DOCTOR', dept: '외과' }, { role: 'DOCTOR' }] },
    { as: 'MEMBER', label: '의사', want: [{ role: 'DOCTOR', dept: '소아청소년과' }, { role: 'DOCTOR' }] },
  ],
  // 감염관리위원회 — 감염관리실 + 진단검사 + 진료 + 간호
  IC: [
    { as: 'CHAIR', label: '위원장(의사)', want: [{ role: 'DOCTOR', dept: '내과' }] },
    { as: 'SECRETARY', label: '간사(감염관리실)', want: [{ role: 'NURSE', dept: '감염관리실' }, { role: 'NURSE' }] },
    { as: 'MEMBER', label: '진단검사', want: [{ role: 'LAB_TECH', dept: '진단검사의학과' }, { role: 'LAB_TECH' }] },
    { as: 'MEMBER', label: '간호부', want: [{ role: 'NURSE', dept: '간호부' }, { role: 'NURSE' }] },
    { as: 'MEMBER', label: '의사', want: [{ role: 'DOCTOR', dept: '응급의학과' }, { role: 'DOCTOR' }] },
  ],
  // 의무기록위원회 — 의무기록 + 진료 + 원무
  MRC: [
    { as: 'CHAIR', label: '위원장(의사)', want: [{ role: 'DOCTOR', dept: '내과' }] },
    { as: 'SECRETARY', label: '간사(의무기록)', want: [{ role: 'MEDICAL_RECORDS' }] },
    { as: 'MEMBER', label: '의사', want: [{ role: 'DOCTOR', dept: '외과' }, { role: 'DOCTOR' }] },
    { as: 'MEMBER', label: '원무', want: [{ role: 'RECEPTIONIST' }, { role: 'ADMIN_STAFF' }] },
  ],
  // 질향상·환자안전위원회 — 간호부 + 진료 + 행정 + 약제
  QPS: [
    { as: 'CHAIR', label: '위원장(의사)', want: [{ role: 'DOCTOR', dept: '내과' }] },
    { as: 'SECRETARY', label: '간사(간호부)', want: [{ role: 'NURSE', dept: '간호부' }, { role: 'NURSE' }] },
    { as: 'MEMBER', label: '의사', want: [{ role: 'DOCTOR', dept: '마취통증의학과' }, { role: 'DOCTOR' }] },
    { as: 'MEMBER', label: '행정', want: [{ role: 'ADMIN_STAFF' }] },
    { as: 'MEMBER', label: '약제', want: [{ role: 'PHARMACIST' }] },
  ],
  // 수혈위원회 — 진단검사(혈액) + 다량 수혈 진료과 + 간호
  TRF: [
    { as: 'CHAIR', label: '위원장(의사)', want: [{ role: 'DOCTOR', dept: '외과' }, { role: 'DOCTOR' }] },
    { as: 'SECRETARY', label: '간사(진단검사)', want: [{ role: 'LAB_TECH', dept: '진단검사의학과' }, { role: 'LAB_TECH' }] },
    { as: 'MEMBER', label: '의사', want: [{ role: 'DOCTOR', dept: '내과' }] },
    { as: 'MEMBER', label: '간호', want: [{ role: 'NURSE', deptLike: '수술실' }, { role: 'NURSE' }] },
  ],
  // 병원윤리위원회 — 진료 + 간호 + 행정 + 경영
  ETH: [
    { as: 'CHAIR', label: '위원장(의사)', want: [{ role: 'DOCTOR', dept: '내과' }] },
    { as: 'SECRETARY', label: '간사(행정)', want: [{ role: 'ADMIN_STAFF' }] },
    { as: 'MEMBER', label: '의사', want: [{ role: 'DOCTOR', dept: '정신건강의학과' }, { role: 'DOCTOR' }] },
    { as: 'MEMBER', label: '간호부', want: [{ role: 'NURSE', dept: '간호부' }, { role: 'NURSE' }] },
    { as: 'MEMBER', label: '경영진', want: [{ role: 'EXECUTIVE' }] },
  ],
  // 영양위원회 — 급양 + 진료 + 간호
  NUT: [
    { as: 'CHAIR', label: '위원장(의사)', want: [{ role: 'DOCTOR', dept: '내과' }] },
    { as: 'SECRETARY', label: '간사(급양)', want: [{ role: 'NUTRITION' }] },
    { as: 'MEMBER', label: '간호', want: [{ role: 'NURSE', dept: '간호부' }, { role: 'NURSE' }] },
  ],
  // 안전관리위원회 — 행정 + 간호 + 진료 + 경영
  SAFE: [
    { as: 'CHAIR', label: '위원장(경영진)', want: [{ role: 'EXECUTIVE' }] },
    { as: 'SECRETARY', label: '간사(행정)', want: [{ role: 'ADMIN_STAFF' }] },
    { as: 'MEMBER', label: '간호부', want: [{ role: 'NURSE', dept: '간호부' }, { role: 'NURSE' }] },
    { as: 'MEMBER', label: '의사', want: [{ role: 'DOCTOR', dept: '응급의학과' }, { role: 'DOCTOR' }] },
  ],
  // 운영위원회 — 경영진 + 각 축 대표
  OPS: [
    { as: 'CHAIR', label: '위원장(경영진)', want: [{ role: 'EXECUTIVE' }] },
    { as: 'SECRETARY', label: '간사(원무)', want: [{ role: 'ADMIN', dept: '원무과' }, { role: 'ADMIN_STAFF' }] },
    { as: 'MEMBER', label: '경영진', want: [{ role: 'EXECUTIVE' }] },
    { as: 'MEMBER', label: '의사', want: [{ role: 'DOCTOR', dept: '내과' }] },
  ],
};

interface U { id: string; role: string; department: string | null; familyName: string | null; givenName: string | null }

/** 🔴 결정적 선택 — 난수 없음. 조건을 위에서부터 보고, 같은 조건 안에서는 이름 순 */
function choose(pool: U[], want: Pick_['want'], taken: Set<string>): U | null {
  for (const w of want) {
    const hit = pool
      .filter((u) => !taken.has(u.id))
      .filter((u) => (w.role ? u.role === w.role : true))
      .filter((u) => (w.dept ? u.department === w.dept : true))
      .filter((u) => (w.deptLike ? (u.department ?? '').includes(w.deptLike) : true))
      .sort((a, b) => `${a.familyName ?? ''}${a.givenName ?? ''}${a.id}`.localeCompare(`${b.familyName ?? ''}${b.givenName ?? ''}${b.id}`))[0];
    if (hit) return hit;
  }
  return null;
}

async function main() {
  const users = (await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, role: true, department: true, familyName: true, givenName: true },
  })) as U[];
  console.log(`재직 사용자 ${users.length}명`);

  const committees = await prisma.committee.findMany({
    where: { code: { in: Object.keys(COMPOSITION) } },
    select: { id: true, code: true, name: true, quorum: true, members: { select: { id: true, userId: true, source: true, isActive: true } } },
  });
  console.log(`대상 위원회 ${committees.length}개 (정본 코드 보유)\n`);

  let seeded = 0; let skipped = 0;
  const shortfalls: string[] = [];
  /**
   * 🔴 **위원장을 분산한다.** 결정적 선택만 하면 같은 조건의 1순위가 전 위원회 위원장이
   *    된다 — 첫 실행에서 한 사람이 **7개 위원회 위원장**이 됐다. 실무에서 말이 안 되고,
   *    보는 사람이 데이터를 못 믿게 된다. 이미 위원장인 사람은 다음 위원회의 위원장
   *    후보에서 뺀다(대안이 없으면 어쩔 수 없이 중복 — 그건 인력이 없는 것이다).
   */
  const chairing = new Set<string>();

  for (const c of committees) {
    const code = c.code as string;
    const plan = COMPOSITION[code];
    if (!plan) continue;

    // ② 사람이 손댄 위원회는 통째로 건너뛴다
    const manual = c.members.filter((m) => m.source === 'MANUAL');
    if (manual.length > 0) {
      console.log(`SKIP  ${code} ${c.name} — 실제 임명 ${manual.length}건이 있다(시드가 덮지 않는다)`);
      skipped++;
      continue;
    }

    const taken = new Set<string>();
    const picks: Array<{ u: U; as: string; label: string }> = [];
    for (const slot of plan) {
      // 위원장 자리는 **이미 다른 위원회 위원장인 사람을 먼저 피한다**
      const u = slot.as === 'CHAIR'
        ? (choose(users, slot.want, new Set([...taken, ...chairing])) ?? choose(users, slot.want, taken))
        : choose(users, slot.want, taken);
      if (!u) { shortfalls.push(`${code} ${slot.label}`); continue; }
      taken.add(u.id);
      if (slot.as === 'CHAIR') chairing.add(u.id);
      picks.push({ u, as: slot.as, label: slot.label });
    }

    /**
     * 🔴 **이전 시드 구성의 잔재를 지운다.** 구성을 고쳐 다시 돌리면 옛 배정이 남아
     *    "위원 9명 / 정족수 5" 같은 유령 명부가 생긴다. 🔴 **SEED 행만** 지운다 —
     *    사람이 임명한 행은 이 스크립트가 건드리지 않는다(위에서 이미 통째로 건너뛴다).
     */
    const keep = new Set(picks.map((p) => p.u.id));
    const stale = c.members.filter((m) => m.source === 'SEED' && !keep.has(m.userId));
    if (stale.length) {
      await prisma.committeeMember.deleteMany({ where: { id: { in: stale.map((m) => m.id) } } });
    }

    for (const p of picks) {
      await prisma.committeeMember.upsert({
        where: { committeeId_userId: { committeeId: c.id, userId: p.u.id } },
        // 🔴 시드는 임명이 아니다 — source=SEED · appointedBy=null
        update: { role: p.as, isActive: true, source: 'SEED', appointedBy: null },
        create: { committeeId: c.id, userId: p.u.id, role: p.as, source: 'SEED', appointedBy: null },
      });
    }
    seeded++;
    const names = picks.map((p) => `${p.u.familyName ?? ''}${p.u.givenName ?? ''}(${p.as})`).join(' · ');
    // ④ 정족수를 못 채우면 채운 척하지 않는다
    const short = c.quorum > 0 && picks.length < c.quorum ? `  🔴 정족수 ${c.quorum} 미달` : '';
    const cleaned = stale.length ? ` (옛 시드 배정 ${stale.length}건 정리)` : '';
    console.log(`SEED  ${code} ${c.name} — 위원 ${picks.length}명${short}${cleaned}\n      ${names}`);
  }

  console.log(`\n구성 ${seeded}개 · 건너뜀 ${skipped}개`);
  if (shortfalls.length) {
    console.log(`🔴 채우지 못한 자리 ${shortfalls.length}개 — ${shortfalls.join(', ')}`);
    console.log('   (해당 직군 재직자가 없다. 아무나 끌어와 숫자를 맞추지 않았다.)');
  }
  console.log('\n🔴 이것은 **리허설 구성**이다 — source=SEED. 실제 임명은 위원회 관리 화면에서 사람이 한다.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
