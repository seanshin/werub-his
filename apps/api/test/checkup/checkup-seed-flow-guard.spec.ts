/**
 * 시드 흐름 전수 검토 8단계 — 검진 흐름 가드 (2026-08-24).
 *
 * 이 파일이 지키는 세 가지 사실:
 *  A. 당일 접수의 `scheduledDate` 는 `@db.Date` 다 — 로컬(KST) 자정을 넣으면 **어제**로 저장되고,
 *     오늘을 UTC 날짜로 읽는 동선 현황판·스테이션 큐·대기 전광판이 그 수검자를 못 본다.
 *  B. 프로그램 항목의 **검사코드**가 결과항목까지 이어져야 프로토콜 판정룰이 매칭된다.
 *     분해 입력 가능 여부는 **코드**로 정한다(항목 이름 접두로 짐작하지 않는다).
 *  C. 검진 전담 직군(CHECKUP)이 자기 본업(예약·접수·추적관리)을 할 수 있어야 한다.
 *     🔴 대신 임상 입력·서명·마스터 관리는 **여전히 막혀 있어야 한다**(열어도 되는 것만 연다).
 *
 * 🔴 각 단언은 결함을 되돌리면 실패한다(재주입 검증 완료 — 보고서 §가드 참조).
 *    "성공하면 실패라고 말하지 않는다" 대조군을 함께 둔다.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { CheckupService } from '../../src/modules/checkup/checkup.service';
import { CheckupController } from '../../src/modules/checkup/checkup.controller';
import { Permission, ROLE_PERMISSIONS } from '../../src/modules/auth/rbac/permission.types';
import { PERMISSION_KEY } from '../../src/common/decorators/require-permission.decorator';
import { localDateKey, todayDateOnly } from '../../src/common/day-range';
import { UserRole } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ORIGINAL_TZ = process.env.TZ;

/** 프로그램 항목 = 검사코드의 **묶음**이다(운영 실측: 항목 99개 전부 codes 보유·묶음 다수) */
const PROGRAM = {
  id: 'prog-1',
  code: 'CK-BASIC',
  name: '기본검진',
  price: 300000,
  discountRate: 0,
  isActive: true,
  dailyCapacity: null,
  items: [
    // 코드 3개(그중 LIPID·LFT 는 패널) — 분해 입력 대상
    { seq: 1, category: 'LAB', name: '혈액검사 (종합)', codes: ['LIPID', 'LFT', 'FBS'] },
    // 코드 1개 — 단일 검사(그 코드를 결과항목에 그대로 적는다)
    { seq: 2, category: 'DIAGNOSTIC', name: '심전도', codes: ['EKG'], interpretDept: '순환기내과' },
    // 코드 1개 + 판독과 — 판독 요청이 **이 항목**에 붙어야 한다
    { seq: 3, category: 'IMAGING', name: '흉부 X-ray', codes: ['CHEST_PA'], interpretDept: '영상의학과' },
  ],
  options: [],
};

/** 정본 `checkupTestMaster.findMany` 의 select 모양 그대로 */
const MASTERS = [
  { code: 'FBS', name: '공복혈당', unit: 'mg/dL', referenceRange: '70-110' },
  { code: 'EKG', name: '심전도', unit: null, referenceRange: null },
  { code: 'CHEST_PA', name: '흉부 X-ray', unit: null, referenceRange: null },
];

function makePrisma() {
  const prisma: any = {
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    checkupProgram: { findUnique: vi.fn().mockResolvedValue(PROGRAM) },
    checkupContract: { findUnique: vi.fn() },
    checkupVisit: {
      create: vi.fn(async ({ data }: any) => ({ id: 'visit-1', ...data, program: PROGRAM, patient: {} })),
      findUnique: vi.fn().mockResolvedValue({
        id: 'visit-1', patientId: 'pat-1', programId: 'prog-1', status: 'RESERVED',
        scheduledDate: todayDateOnly(), totalPrice: 300000, selectedOptions: [],
        program: PROGRAM, patient: { id: 'pat-1', dateOfBirth: new Date('1980-01-01'), gender: 'MALE' },
        items: [], summary: null, interpretations: [], referrals: [], followUps: [],
      }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn(async ({ data }: any) => ({ id: 'visit-1', ...data, program: PROGRAM, patient: {}, items: [] })),
    },
    checkupResultItem: {
      create: vi.fn(async ({ data }: any) => ({ id: 'ri-new', ...data })),
      createMany: vi.fn().mockResolvedValue({ count: 3 }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(async ({ data }: any) => ({ id: 'ri-1', ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
    checkupInterpretation: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    checkupSummary: { findUnique: vi.fn() },
    checkupFollowUp: { create: vi.fn(async ({ data }: any) => ({ id: 'fu-1', ...data })) },
    checkupTestMaster: { findMany: vi.fn().mockResolvedValue(MASTERS) },
    encounter: { create: vi.fn().mockResolvedValue({ id: 'enc-1' }) },
    billing: { create: vi.fn() },
    user: { findFirst: vi.fn().mockResolvedValue({ id: 'admin-1' }), findUnique: vi.fn() },
    patient: { findUnique: vi.fn().mockResolvedValue({ gender: 'MALE', dateOfBirth: new Date('1980-01-01') }) },
    labResult: { findMany: vi.fn().mockResolvedValue([]) },
    imagingResult: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return prisma;
}

describe('검진 흐름 — 시드 흐름 전수 검토 8단계 가드', () => {
  let prisma: any;
  let service: CheckupService;

  beforeAll(() => { process.env.TZ = 'Asia/Seoul'; });
  afterAll(() => { process.env.TZ = ORIGINAL_TZ; });

  beforeEach(() => {
    prisma = makePrisma();
    service = new CheckupService(prisma, {} as any, { emit: vi.fn() } as any);
  });

  // ═════════════════════════════════════════════════════════
  // A. 당일 접수 날짜 — `@db.Date` 하루 밀림
  // ═════════════════════════════════════════════════════════
  describe('A. 당일 접수(walk-in)가 오늘 날짜로 저장된다', () => {
    it('서버가 KST 라는 것을 이 스펙이 실제로 강제한다(전제 확인)', () => {
      expect(new Date().getTimezoneOffset()).toBe(-540);
    });

    it('scheduledDate 가 오늘(KST 달력)의 @db.Date 비교값과 정확히 같다', async () => {
      vi.spyOn(service, 'checkIn').mockResolvedValue({ id: 'visit-1' } as any);
      await service.createWalkInVisit({ patientId: 'pat-1', programId: 'prog-1' } as any);

      const stored = prisma.checkupVisit.create.mock.calls[0][0].data.scheduledDate as Date;
      // 🔴 로컬 자정(`setHours(0,0,0,0)`)이면 이 단언이 깨진다 — KST 에서 UTC 기준 전날이 된다
      expect(stored.getTime()).toBe(todayDateOnly().getTime());
      expect(stored.toISOString().slice(0, 10)).toBe(localDateKey(new Date()));
      expect(stored.toISOString().slice(11)).toBe('00:00:00.000Z');
    });

    it('당일 접수분이 "오늘" 조회 구간(동선 현황판·스테이션 큐)에 들어온다', async () => {
      vi.spyOn(service, 'checkIn').mockResolvedValue({ id: 'visit-1' } as any);
      await service.createWalkInVisit({ patientId: 'pat-1', programId: 'prog-1' } as any);
      const stored = prisma.checkupVisit.create.mock.calls[0][0].data.scheduledDate as Date;

      // getDisplayData·getStationQueue·getFlowBoard 가 쓰는 구간과 동일한 계산
      const gte = todayDateOnly();
      const lt = new Date(gte); lt.setUTCDate(lt.getUTCDate() + 1);
      expect(stored >= gte && stored < lt).toBe(true);
    });

    it('대조군 — 예약(createVisit)이 넣은 날짜를 조용히 다른 날로 바꾸지 않는다', async () => {
      await service.createVisit({ patientId: 'pat-1', programId: 'prog-1', scheduledDate: '2026-09-01' } as any);
      const stored = prisma.checkupVisit.create.mock.calls[0][0].data.scheduledDate as Date;
      expect(stored.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    });

    /**
     * 🔴 (2026-09-03) 못 찾은 옵션 id 를 조용히 건너뛰면 **선택 옵션이 0원으로 예약**된다
     *    (프로그램에서 옵션이 삭제된 뒤 이전 화면으로 제출). 모르는 것으로 돈을 계산하지 않는다.
     */
    it('🔴 프로그램에 없는 옵션 id 는 0원 예약이 아니라 400 이다', async () => {
      prisma.checkupProgram.findUnique.mockResolvedValue({
        ...PROGRAM, options: [{ id: 'opt-a', name: '위내시경', price: 50000 }],
      });
      await expect(
        service.createVisit({ patientId: 'pat-1', programId: 'prog-1', scheduledDate: '2026-09-10', selectedOptions: ['opt-deleted'] } as any),
      ).rejects.toThrow(/옵션.*없습니다/);
      expect(prisma.checkupVisit.create, '검증 실패인데 예약이 만들어졌다').not.toHaveBeenCalled();
    });

    it('실재 옵션은 금액이 가산된다(대조군 — 막다가 정상 옵션까지 굶기지 않는다)', async () => {
      prisma.checkupProgram.findUnique.mockResolvedValue({
        ...PROGRAM, options: [{ id: 'opt-a', name: '위내시경', price: 50000 }],
      });
      await service.createVisit({ patientId: 'pat-1', programId: 'prog-1', scheduledDate: '2026-09-10', selectedOptions: ['opt-a'] } as any);
      const data = prisma.checkupVisit.create.mock.calls[0][0].data as { totalPrice: number };
      expect(data.totalPrice).toBe(350000);
    });

    it('날짜 파싱 실패는 500 이 아니라 400 으로 말한다', async () => {
      await expect(
        service.createVisit({ patientId: 'pat-1', programId: 'prog-1', scheduledDate: '오늘' } as any),
      ).rejects.toThrow(/형식/);
    });

    it('추적 예정일(dueDate·@db.Date)도 같은 정본을 쓴다', async () => {
      await service.createFollowUp('visit-1', { followUpType: 'RECHECK', description: '재검', dueDate: '2026-09-10' });
      const stored = prisma.checkupFollowUp.create.mock.calls[0][0].data.dueDate as Date;
      expect(stored.toISOString()).toBe('2026-09-10T00:00:00.000Z');
    });
  });

  // ═════════════════════════════════════════════════════════
  // B. 검사코드 → 결과항목 → 판정룰
  // ═════════════════════════════════════════════════════════
  describe('B. 프로그램 항목의 검사코드가 결과항목까지 이어진다', () => {
    it('코드가 하나인 항목은 그 코드를 결과항목 testCode 로 적는다', async () => {
      prisma.checkupResultItem.findMany.mockResolvedValue([
        { id: 'ri-1', testName: '혈액검사 (종합)', testCode: null },
        { id: 'ri-2', testName: '심전도', testCode: 'EKG' },
        { id: 'ri-3', testName: '흉부 X-ray', testCode: 'CHEST_PA' },
      ]);
      await service.checkIn('visit-1');
      const rows = prisma.checkupResultItem.createMany.mock.calls[0][0].data as any[];
      const byName = new Map(rows.map((r) => [r.testName, r]));
      // 🔴 종전엔 testCode 를 아예 넣지 않아 운영 426/426 NULL 이었다 → 판정룰 매칭 0
      expect(byName.get('심전도')!.testCode).toBe('EKG');
      expect(byName.get('흉부 X-ray')!.testCode).toBe('CHEST_PA');
    });

    it('코드가 여럿인 묶음 항목은 testCode 를 지어내지 않는다(null)', async () => {
      prisma.checkupResultItem.findMany.mockResolvedValue([]);
      await service.checkIn('visit-1');
      const rows = prisma.checkupResultItem.createMany.mock.calls[0][0].data as any[];
      const bundle = rows.find((r) => r.testName === '혈액검사 (종합)')!;
      expect(bundle.testCode).toBeNull();
    });

    it('판독 요청은 위치가 아니라 검사명으로 짝짓는다 — 순서가 뒤섞여도 엉뚱한 항목에 붙지 않는다', async () => {
      // createMany 는 한 문장이라 createdAt 이 전 행 동일 → 조회 순서는 보장되지 않는다.
      // 일부러 프로그램 항목과 **다른 순서**로 돌려준다.
      prisma.checkupResultItem.findMany.mockResolvedValue([
        { id: 'ri-xray', testName: '흉부 X-ray', testCode: 'CHEST_PA' },
        { id: 'ri-blood', testName: '혈액검사 (종합)', testCode: null },
        { id: 'ri-ekg', testName: '심전도', testCode: 'EKG' },
      ]);
      await service.checkIn('visit-1');
      const interps = prisma.checkupInterpretation.createMany.mock.calls[0][0].data as any[];
      const byDept = new Map(interps.map((i) => [i.department, i.resultItemId]));
      expect(byDept.get('순환기내과')).toBe('ri-ekg');
      expect(byDept.get('영상의학과')).toBe('ri-xray');
    });
  });

  describe('B-2. 분해 입력 가능 여부는 검사코드로 정한다(항목 이름으로 짐작하지 않는다)', () => {
    it("묶음 항목 '혈액검사 (종합)' 의 분석물이 펼쳐진다 — 옛 이름 접두 규칙으로는 하나도 안 맞았다", async () => {
      const sheet = await service.getRouteSheet('visit-1');
      const blood = sheet.find((r) => r.name === '혈액검사 (종합)')!;
      const codes = blood.analytes.map((a) => a.code);
      // LIPID → TC/LDL/HDL/TG · LFT → AST/ALT/GGT · FBS 는 그대로
      expect(codes).toEqual(expect.arrayContaining(['TC', 'LDL', 'HDL', 'TG', 'AST', 'ALT', 'GGT', 'FBS']));
      expect(blood.analytes.length).toBeGreaterThan(1); // 화면이 분해 입력창을 연다

      // 🔴 종전 규칙(항목명이 '혈압|지질|간기능|신장기능' 으로 시작)으로는 열리지 않았다
      const OLD_HINTS = ['혈압', '지질', '간기능', '신장기능'];
      expect(OLD_HINTS.some((h) => blood.name.startsWith(h))).toBe(false);
    });

    it('분석물 이름은 마스터에서 가져오고, 마스터에 없으면 코드를 그대로 둔다(지어내지 않는다)', async () => {
      const analytes = await service.resolveAnalytes(['FBS', 'NO_SUCH_CODE']);
      expect(analytes.find((a) => a.code === 'FBS')!.name).toBe('공복혈당');
      expect(analytes.find((a) => a.code === 'NO_SUCH_CODE')!.name).toBe('NO_SUCH_CODE');
    });

    it('대조군 — 코드가 하나뿐인 항목은 분해 대상이 아니다(분해창을 열지 않는다)', async () => {
      const sheet = await service.getRouteSheet('visit-1');
      const ekg = sheet.find((r) => r.name === '심전도')!;
      expect(ekg.analytes.map((a) => a.code)).toEqual(['EKG']);
    });

    it('그 항목에 없는 검사코드는 400 으로 거절한다(어휘를 지어내지 않는다)', async () => {
      await expect(
        service.addPanelResults('visit-1', { parentTestName: '혈액검사 (종합)', values: { HB: '13' } }),
      ).rejects.toThrow(/검사코드/);
    });
  });

  describe('B-3. 부모 항목 롤업은 저장된 전 분석물로 계산한다', () => {
    it('앞서 입력한 이상 소견을 나중 패널 입력이 정상으로 덮지 않는다', async () => {
      // 이미 간기능(AST)이 ABNORMAL 로 저장돼 있는 상태
      prisma.checkupResultItem.findMany.mockResolvedValue([
        { finding: 'ABNORMAL', grade: 'B' },
        { finding: 'NORMAL', grade: 'A' },
      ]);
      vi.spyOn(service, 'addResult').mockResolvedValue({ finding: 'NORMAL', grade: 'A' } as any);

      await service.addPanelResults('visit-1', {
        parentTestName: '혈액검사 (종합)',
        values: { TC: '180', LDL: '90', HDL: '55', TG: '110' },
      });

      const rollup = prisma.checkupResultItem.updateMany.mock.calls.at(-1)![0];
      expect(rollup.where.testName).toBe('혈액검사 (종합)');
      // 🔴 이번 호출만 보면 NORMAL 이 된다 — 저장된 전 분석물을 봐야 ABNORMAL 이 남는다
      expect(rollup.data.finding).toBe('ABNORMAL');
    });

    it('대조군 — 전 분석물이 정상이면 이상이라 말하지 않는다', async () => {
      prisma.checkupResultItem.findMany.mockResolvedValue([
        { finding: 'NORMAL', grade: 'A' },
        { finding: 'NORMAL', grade: 'A' },
      ]);
      vi.spyOn(service, 'addResult').mockResolvedValue({ finding: 'NORMAL', grade: 'A' } as any);
      await service.addPanelResults('visit-1', { parentTestName: '혈액검사 (종합)', values: { TC: '180' } });
      const rollup = prisma.checkupResultItem.updateMany.mock.calls.at(-1)![0];
      expect(rollup.data.finding).toBe('NORMAL');
    });
  });

  // ═════════════════════════════════════════════════════════
  // B-4. 자동수집이 "0건 수집 완료"라고 말하지 않는다
  // ═════════════════════════════════════════════════════════
  describe('B-4. 결과 자동수집은 대상 수를 함께 낸다', () => {
    const visitWith = (items: any[]) => ({
      id: 'visit-1', patientId: 'pat-1', programId: 'prog-1', status: 'IN_PROGRESS',
      scheduledDate: todayDateOnly(), selectedOptions: [], program: PROGRAM,
      patient: { id: 'pat-1', dateOfBirth: new Date('1980-01-01'), gender: 'MALE' },
      items, summary: null, interpretations: [], referrals: [], followUps: [],
    });

    it('원자료 연결이 없으면 "수집 0"이 아니라 **연결 없음 항목 수**를 낸다', async () => {
      prisma.checkupVisit.findUnique.mockResolvedValue(visitWith([
        { id: 'ri-1', testName: '혈액검사 (종합)', finding: 'PENDING', sourceType: null, sourceId: null },
        { id: 'ri-2', testName: '심전도', finding: 'PENDING', sourceType: null, sourceId: null },
      ]));
      prisma.checkupResultItem.findMany.mockResolvedValue([]);
      const r = await service.autoCollectResults('visit-1');
      expect(r.collected).toBe(0);
      // 🔴 이 두 값이 없으면 화면은 "0건 수집 완료"라고 말한다(P17)
      expect(r.linkedPending).toBe(0);
      expect(r.unlinkedPending).toBe(2);
    });

    it('대조군 — 연결이 있으면 "연결 없음"이라 말하지 않는다', async () => {
      prisma.checkupVisit.findUnique.mockResolvedValue(visitWith([
        { id: 'ri-1', testName: '혈액검사 (종합)', finding: 'PENDING', sourceType: 'LAB_RESULT', sourceId: 'lab-1' },
      ]));
      prisma.checkupResultItem.findMany.mockResolvedValue([]);
      const r = await service.autoCollectResults('visit-1');
      expect(r.linkedPending).toBe(1);
      expect(r.unlinkedPending).toBe(0);
    });
  });

  // ═════════════════════════════════════════════════════════
  // G. 상태 어휘 — STATUS_FLOW 가 허용하는 전이를 DTO 가 400 으로 자르지 않는다
  // ═════════════════════════════════════════════════════════
  describe('G. 상태 전이 어휘가 서비스와 DTO 사이에서 갈라지지 않는다', () => {
    /** 전용 EP(취소·노쇼)가 따로 검사하는 값은 일반 상태변경 DTO 에 두지 않는다 */
    const DEDICATED_EP_ONLY = new Set(['CANCELLED', 'NO_SHOW']);

    it('STATUS_FLOW 의 전이 대상이 모두 UpdateCheckupVisitStatusDto 의 허용 목록에 있다', () => {
      const svc = readFileSync(resolve(__dirname, '../../src/modules/checkup/checkup.service.ts'), 'utf8');
      const dto = readFileSync(resolve(__dirname, '../../src/modules/checkup/dto/checkup-visit.dto.ts'), 'utf8');

      const flowBlock = svc.match(/const STATUS_FLOW[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1];
      expect(flowBlock, 'STATUS_FLOW 를 찾지 못했다 — 가드가 헛돌지 않게 즉시 고칠 것').toBeTruthy();
      const targets = new Set([...flowBlock!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));

      const isInBlock = dto.match(/@IsIn\(\[([\s\S]*?)\]\)/)?.[1];
      expect(isInBlock).toBeTruthy();
      const allowed = new Set([...isInBlock!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));

      const missing = [...targets].filter((t) => !DEDICATED_EP_ONLY.has(t) && !allowed.has(t));
      expect(missing, `STATUS_FLOW 가 허용하는데 DTO 가 막는 상태: ${missing.join(', ')}`).toEqual([]);
    });

    it('대조군 — 전용 EP 로만 가는 값(CANCELLED·NO_SHOW)은 DTO 에 열려 있지 않다', () => {
      const dto = readFileSync(resolve(__dirname, '../../src/modules/checkup/dto/checkup-visit.dto.ts'), 'utf8');
      const isInBlock = dto.match(/@IsIn\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
      const allowed = new Set([...isInBlock.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));
      for (const v of DEDICATED_EP_ONLY) expect(allowed.has(v)).toBe(false);
    });
  });

  // ═════════════════════════════════════════════════════════
  // C. 검진 전담 직군(CHECKUP) 권한
  // ═════════════════════════════════════════════════════════
  describe('C. CHECKUP 직군이 검진 원무를 할 수 있고, 임상·마스터는 여전히 못 한다', () => {
    const permsOf = (m: keyof CheckupController) =>
      (Reflect.getMetadata(PERMISSION_KEY, CheckupController.prototype[m] as any) as Permission[]) ?? [];
    const checkupCan = (m: keyof CheckupController) =>
      permsOf(m).some((p) => ROLE_PERMISSIONS[UserRole.CHECKUP].has(p));

    it('CHECKUP 역할이 CHECKUP_MANAGE 를 가진다', () => {
      expect(ROLE_PERMISSIONS[UserRole.CHECKUP].has(Permission.CHECKUP_MANAGE)).toBe(true);
      expect(ROLE_PERMISSIONS[UserRole.ADMIN].has(Permission.CHECKUP_MANAGE)).toBe(true);
    });

    it.each<[keyof CheckupController, string]>([
      ['createVisit', '검진 예약'],
      ['createWalkInVisit', '당일 접수'],
      ['checkIn', '접수(체크인)'],
      ['updateStatus', '진행 상태 변경'],
      ['cancelVisit', '예약 취소'],
      ['rescheduleVisit', '예약 변경'],
      ['saveVisitQuestionnaire', '문진 응답 저장'],
      ['createFollowUp', '추적 등록'],
      ['completeFollowUp', '추적 완료'],
      ['listContracts', '단체 계약 목록'],
      ['createContract', '단체 계약 생성'],
      ['bulkReserve', '단체 일괄 예약'],
    ])('원무·행정: %s (%s) 은 CHECKUP 이 할 수 있다', (method) => {
      expect(permsOf(method).length).toBeGreaterThan(0); // 무가드가 아니다
      expect(checkupCan(method)).toBe(true);
    });

    it.each<[keyof CheckupController, string]>([
      ['addResult', '검사 결과 입력'],
      ['addPanelResults', '분석물 분해 입력'],
      ['stationComplete', '스테이션 결과 마감'],
      ['wsComplete', '워크스테이션 완료'],
      ['skipResultItem', '검사 항목 스킵'],
      ['createSummary', '종합소견 작성'],
      ['signSummary', '결과서 서명'],
      ['completeInterpretation', '과별 판독 완료'],
      ['createProgram', '검진 프로그램 마스터'],
      ['createQuestionnaire', '문진표 정의'],
      ['updateWsStation', '스테이션 설정'],
      ['processNoShows', '노쇼 일괄 처리'],
    ])('임상·마스터: %s (%s) 은 CHECKUP 이 할 수 없다', (method) => {
      expect(permsOf(method).length).toBeGreaterThan(0);
      expect(checkupCan(method)).toBe(false);
    });

    it('대조군 — 기존 직군(NURSE·RECEPTIONIST)의 검진 원무 접근이 좁아지지 않았다', () => {
      for (const role of [UserRole.NURSE, UserRole.RECEPTIONIST] as const) {
        const perms = permsOf('createVisit');
        expect(perms.some((p) => ROLE_PERMISSIONS[role].has(p))).toBe(true);
      }
    });
  });
});
