import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SurgeryService } from '../../src/modules/surgery/surgery.service';
import { SurgeryAdvancedService } from '../../src/modules/surgery/surgery-advanced.service';
import {
  LATERALITY_REQUIRED_KEYWORDS,
  isLateralityRequired,
  lateralitySpecified,
} from '../../src/common/laterality-keywords';

/**
 * 오부위수술 방지 게이트 + 게이트 3상(OFF/WARN/BLOCK) 집행.
 *
 * 🔴 이 파일이 지키는 결함(전부 실제로 있었던 것):
 *   ① `if (mode === 'BLOCK')` 만 처리 → **WARN 이 OFF 와 완전히 동일**(차단도 기록도 없음)
 *   ② 예약(schedule)에 부위·좌우 검사가 **없음** → 오부위 방지가 입구에서 끊김
 *   ③ 좌우를 모든 수술에 필수로 걸면 거짓 마찰 → 키워드 근거 판정만 필수
 */
describe('수술 안전 게이트 — 3상 집행 · 오부위 방지', () => {
  let service: SurgeryService;
  let prisma: any;
  let advanced: any;
  let config: { get: any };
  let gates: { record: any };

  const cfg = (map: Record<string, unknown>) => vi.fn(async (k: string) => map[k]);

  beforeEach(() => {
    prisma = {
      surgery: {
        create: vi.fn(async (a: any) => ({ id: 'surg-1', ...a.data })),
        findUnique: vi.fn(async () => ({ id: 's1', patientId: 'p1', surgeonId: 'd1', status: 'IN_PROGRESS', procedureName: '슬관절 전치환술' })),
        update: vi.fn(async () => ({ id: 's1', status: 'COMPLETED' })),
      },
      user: { findMany: vi.fn(async () => []) },
    };
    advanced = {
      assertChecklistReadyForStart: vi.fn().mockResolvedValue(undefined),
      assertChecklistReadyForClose: vi.fn().mockResolvedValue(undefined),
      assertCountReconciled: vi.fn().mockResolvedValue(true),
    };
    config = { get: cfg({}) };
    gates = { record: vi.fn().mockResolvedValue(undefined) };
    service = new SurgeryService(prisma, advanced, undefined, undefined, undefined, config as any, gates as any);
  });

  /* ───────── ① 게이트 3상 — WARN 은 막지 않되 반드시 기록한다 ───────── */

  it('signOutEnforce=BLOCK — 체크리스트 미완료면 차단되고 **위반이 기록된다**', async () => {
    config.get = cfg({ 'surgery.signOutEnforce': 'BLOCK' });
    advanced.assertChecklistReadyForClose = vi.fn().mockRejectedValue(
      new BadRequestException({ code: 'CHECKLIST_INCOMPLETE', message: 'Sign-Out 미완료' }),
    );
    await expect(service.complete('s1', {} as any)).rejects.toThrow();
    expect(gates.record).toHaveBeenCalledWith('surgery.signOutEnforce', 'BLOCK', expect.stringContaining('Sign-Out'), 'SURGERY', 's1');
  });

  it('🔴 signOutEnforce=WARN — 차단하지 않지만 **로그가 남는다**(종전엔 OFF 와 동일했다)', async () => {
    config.get = cfg({ 'surgery.signOutEnforce': 'WARN' });
    advanced.assertChecklistReadyForClose = vi.fn().mockRejectedValue(
      new BadRequestException({ code: 'CHECKLIST_INCOMPLETE', message: 'Sign-Out 미완료' }),
    );
    const res: any = await service.complete('s1', {} as any);
    expect(prisma.surgery.update).toHaveBeenCalled(); // 막지 않는다
    expect(gates.record).toHaveBeenCalledWith('surgery.signOutEnforce', 'WARN', expect.any(String), 'SURGERY', 's1');
    // 통과한 사실을 화면에도 말한다 — 조용한 통과는 아무도 고치지 않는다
    expect(res.gateWarnings?.[0]?.gateKey).toBe('surgery.signOutEnforce');
  });

  it('signOutEnforce=OFF — 검사 자체를 돌리지 않고 기록도 없다', async () => {
    config.get = cfg({ 'surgery.signOutEnforce': 'OFF', 'surgery.countEnforce': 'OFF' });
    await service.complete('s1', {} as any);
    expect(advanced.assertChecklistReadyForClose).not.toHaveBeenCalled();
    expect(gates.record).not.toHaveBeenCalled();
  });

  it('countEnforce=WARN — 계수 미해소도 기록된다(잔류이물 승격 근거)', async () => {
    config.get = cfg({ 'surgery.signOutEnforce': 'OFF', 'surgery.countEnforce': 'WARN' });
    advanced.assertCountReconciled = vi.fn().mockRejectedValue(
      new BadRequestException({ code: 'COUNT_MISMATCH', message: '계수 불일치 해소기록 없음' }),
    );
    await service.complete('s1', {} as any);
    expect(gates.record).toHaveBeenCalledWith('surgery.countEnforce', 'WARN', expect.stringContaining('계수'), 'SURGERY', 's1');
  });

  it('게이트가 통과하면 기록하지 않는다(위반이 아닌 것을 위반으로 세지 않는다)', async () => {
    config.get = cfg({ 'surgery.signOutEnforce': 'BLOCK', 'surgery.countEnforce': 'BLOCK' });
    await service.complete('s1', {} as any);
    expect(gates.record).not.toHaveBeenCalled();
  });

  /* ───────── ② 오부위 방지 — 예약(입구)에서 판정한다 ───────── */

  const bookLeft = {
    patientId: 'p1', surgeonId: 'd1', scheduledAt: '2026-09-01T09:00:00Z',
    procedureName: '슬관절 전치환술', bodySite: '슬관절',
  };

  it('🔴 예약 — 좌우구분 술식인데 laterality 미지정: BLOCK 이면 예약이 거절된다', async () => {
    config.get = cfg({ 'surgery.siteVerify.enforce': 'BLOCK' });
    await expect(service.schedule(bookLeft as any)).rejects.toMatchObject({
      response: { code: 'SURGERY_LATERALITY_REQUIRED' },
    });
    expect(prisma.surgery.create).not.toHaveBeenCalled();
    expect(gates.record).toHaveBeenCalledWith('surgery.siteVerify.enforce', 'BLOCK', expect.any(String), 'SURGERY_SCHEDULE', 'p1');
  });

  it('예약 — WARN 이면 저장하되 기록+화면 경고를 함께 낸다', async () => {
    config.get = cfg({ 'surgery.siteVerify.enforce': 'WARN' });
    const res: any = await service.schedule(bookLeft as any);
    expect(prisma.surgery.create).toHaveBeenCalled();
    expect(res.siteVerification.warning).toMatch(/좌우/);
    expect(gates.record).toHaveBeenCalledWith('surgery.siteVerify.enforce', 'WARN', expect.any(String), 'SURGERY_SCHEDULE', 'p1');
  });

  it('예약 — OFF 여도 화면에는 말한다(막지 않는 것과 숨기는 것은 다르다)', async () => {
    config.get = cfg({ 'surgery.siteVerify.enforce': 'OFF' });
    const res: any = await service.schedule(bookLeft as any);
    expect(res.siteVerification.warning).toMatch(/좌우/);
    expect(gates.record).not.toHaveBeenCalled(); // 게이트가 꺼져 있으면 위반으로 세지 않는다
  });

  it('🔴 예약 — bodySite·laterality 가 실제로 저장된다(FE 가 안 보내 항상 비어 있었다)', async () => {
    config.get = cfg({});
    await service.schedule({ ...bookLeft, laterality: 'RIGHT' } as any);
    const arg = prisma.surgery.create.mock.calls[0][0];
    expect(arg.data.bodySite).toBe('슬관절');
    expect(arg.data.laterality).toBe('RIGHT');
  });

  it('좌우 무관 술식(충수절제술)은 미지정이어도 경고하지 않는다(거짓 마찰 금지)', async () => {
    config.get = cfg({ 'surgery.siteVerify.enforce': 'BLOCK' });
    const res: any = await service.schedule({ ...bookLeft, procedureName: '충수절제술', bodySite: '충수' } as any);
    expect(res.siteVerification.warning).toBeNull();
    expect(res.siteVerification.lateralityRequired).toBe(false);
  });

  it('laterality=NA 는 좌우구분 술식에서 "미지정"과 같다(모순된 선언을 통과시키지 않는다)', async () => {
    config.get = cfg({ 'surgery.siteVerify.enforce': 'WARN' });
    const res: any = await service.schedule({ ...bookLeft, laterality: 'NA' } as any);
    expect(res.siteVerification.warning).toMatch(/좌우/);
  });

  it('config 키워드 배열이 코드 기본을 **전량 대체**한다(위원회 개정 표면)', async () => {
    config.get = cfg({ 'surgery.siteVerify.enforce': 'BLOCK', 'surgery.lateralityKeywords': ['가상부위'] });
    // 슬관절은 개정 목록에 없으므로 더 이상 필수가 아니다
    const res: any = await service.schedule(bookLeft as any);
    expect(res.siteVerification.lateralityRequired).toBe(false);
  });
});

/* ───────── ③ 판정 정본 — 모르는 것을 아는 것처럼 말하지 않는다 ───────── */

describe('laterality 판정 정본', () => {
  it('키워드에 걸리면 필수', () => {
    expect(isLateralityRequired('백내장 수술', null, LATERALITY_REQUIRED_KEYWORDS)).toBe(true);
    expect(isLateralityRequired('전치환술', '고관절', LATERALITY_REQUIRED_KEYWORDS)).toBe(true);
  });
  it('걸리지 않으면 필수 아님', () => {
    expect(isLateralityRequired('제왕절개술', '자궁', LATERALITY_REQUIRED_KEYWORDS)).toBe(false);
  });
  it('🔴 근거가 아예 없으면 null(=모름) — "필요 없음"으로 접지 않는다', () => {
    expect(isLateralityRequired('', null, LATERALITY_REQUIRED_KEYWORDS)).toBeNull();
    expect(isLateralityRequired(null, '  ', LATERALITY_REQUIRED_KEYWORDS)).toBeNull();
  });
  it('NA·null 은 좌우를 특정한 것이 아니다', () => {
    expect(lateralitySpecified('NA')).toBe(false);
    expect(lateralitySpecified(null)).toBe(false);
    expect(lateralitySpecified('LEFT')).toBe(true);
  });

  /**
   * 🔴 드리프트 가드 — Sign-In 게이트(`surgery-advanced.service`)는 아직 같은 규칙을
   *    **인라인으로** 갖고 있다(동시 작업 중이라 이 축에서 건드리지 않았다).
   *    두 판정이 갈라지면 "예약에선 통과, Sign-In 에선 차단"(또는 반대)이 생긴다 — 정본이 둘이 된 것이다.
   *    같은 입력에 같은 답을 내는지 실제로 돌려서 확인한다.
   */
  it('Sign-In 게이트(인라인 판정)와 정본 헬퍼가 같은 답을 낸다', async () => {
    const cases: Array<[string, string | null, string | null, boolean]> = [
      ['슬관절 전치환술', '슬관절', null, true],   // 차단돼야 함
      ['슬관절 전치환술', '슬관절', 'RIGHT', false],
      ['충수절제술', null, null, false],
      ['백내장 수술', null, 'NA', true],           // NA=미지정
    ];
    for (const [procedureName, bodySite, laterality, shouldBlock] of cases) {
      const prisma: any = {
        surgicalChecklist: { findUnique: vi.fn(async () => ({ surgeryId: 's1' })), update: vi.fn(async () => ({ id: 'c1' })) },
        surgery: { findUnique: vi.fn(async () => ({ procedureName, bodySite, laterality })) },
        preAnesthesiaEvaluation: { findUnique: vi.fn(async () => ({ status: 'COMPLETED' })) },
      };
      const cfg = { get: vi.fn(async (k: string) => (k === 'surgery.siteVerify.enforce' ? 'BLOCK' : 'false')) };
      const svc = new SurgeryAdvancedService(prisma, cfg as any);
      const p = svc.updateChecklist('s1', 'signIn', {} as any, 'u1');
      const blocked = await p.then(() => false, () => true);
      expect(blocked, `${procedureName}/${bodySite}/${laterality}`).toBe(shouldBlock);

      // 정본 헬퍼의 판정
      const canon = isLateralityRequired(procedureName, bodySite, LATERALITY_REQUIRED_KEYWORDS) === true
        && !lateralitySpecified(laterality);
      expect(canon, `정본 불일치: ${procedureName}/${bodySite}/${laterality}`).toBe(shouldBlock);
    }
  });
});
