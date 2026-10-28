import { describe, it, expect, vi, beforeEach } from 'vitest';

import { QcService, QC_NOT_EVALUABLE } from '../../src/modules/lab/qc.service';

/**
 * 🔴 갈래 H(2026-09-16~21 결함 발굴 캠페인 · 지표 0폴백 축) 가 봉합한 자리의 **행동** 가드.
 *
 * 기준선(`metric-zero-fallback.spec.ts`)은 "조용히 늘지 않는다"만 지킨다 — 그건 **모양**이다.
 * 여기서는 봉합이 실제로 무슨 값을 내는지 본다. 이 둘은 다른 일이다:
 * 기준선은 `?? 0` 을 `?? null` 로 바꾸면 통과하지만, 그 null 이 **화면까지 3상태로 가는지**는 모른다.
 *
 * 🔴 목은 정본의 **실제 반환 모양**을 쓴다 — Prisma `_avg` 는 표본 0 에서 `null` 이다(0 이 아니다).
 *    내가 가정한 모양(0)으로 목을 만들면 가드가 헛돈다.
 */
describe('🔴 H — 표본 부재·미측정을 0 으로 말하지 않는다(행동)', () => {
  describe('lab QC — 목표 SD 0 은 PASS 가 아니라 산출 불가다', () => {
    let prisma: { labQcRecord: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> } };
    let svc: QcService;

    beforeEach(() => {
      prisma = {
        labQcRecord: {
          create: vi.fn(async (args: { data: Record<string, unknown> }) => args.data),
          findMany: vi.fn(async () => []),
        },
      };
      svc = new QcService(prisma as never);
    });

    const base = {
      instrumentId: 'i-1', qcLevel: 'LEVEL_1', testCode: 'GLU',
      measuredValue: 100, targetMean: 100, performedBy: 'u-1',
    };

    it('🔴 SD 0 — z 는 null, 판정은 NOT_EVALUABLE, "합격"이라 말하지 않는다', async () => {
      await svc.addRecord({ ...base, targetSD: 0 });
      const data = prisma.labQcRecord.create.mock.calls[0][0].data;
      expect(data.zScore, 'z 0 은 "평균과 일치"라는 다른 사실이다').toBeNull();
      expect(data.westgardRule).toBe(QC_NOT_EVALUABLE);
      expect(data.isAccepted, '합격이라고 말할 근거가 없다').toBe(false);
    });

    it('대조군 — SD 가 있으면 종전대로 판정한다(성공을 실패로 말하지 않는다)', async () => {
      await svc.addRecord({ ...base, targetSD: 2, measuredValue: 101 });
      const pass = prisma.labQcRecord.create.mock.calls[0][0].data;
      expect(pass.westgardRule).toBe('PASS');
      expect(pass.zScore).toBe(0.5);
      expect(pass.isAccepted).toBe(true);

      prisma.labQcRecord.create.mockClear();
      await svc.addRecord({ ...base, targetSD: 1, measuredValue: 104 }); // z=4
      const fail = prisma.labQcRecord.create.mock.calls[0][0].data;
      expect(fail.westgardRule).toBe('1-3s');
      expect(fail.isAccepted).toBe(false);
    });

    it('🔴 대시보드 — 판정 불가는 passed 도 failed 도 아닌 **별도 칸**이다', async () => {
      const inst = { id: 'i-1', name: '장비1', serialNumber: 'SN' };
      prisma.labQcRecord.findMany.mockResolvedValue([
        { instrumentId: 'i-1', instrument: inst, westgardRule: QC_NOT_EVALUABLE, isAccepted: false, id: 'r1', qcLevel: 'L1', testCode: 'GLU', measuredValue: 1, targetMean: 1, targetSD: 0, zScore: null, performedAt: new Date() },
        { instrumentId: 'i-1', instrument: inst, westgardRule: 'PASS', isAccepted: true, id: 'r2', qcLevel: 'L1', testCode: 'GLU', measuredValue: 1, targetMean: 1, targetSD: 1, zScore: 0, performedAt: new Date() },
      ]);
      const d = await svc.getDashboard();
      expect(d.summary.notEvaluable, '거짓 안심(passed)으로도').toBe(1);
      expect(d.summary.passed, '거짓 경보(failed)로도 새지 않는다').toBe(1);
      expect(d.summary.failed).toBe(0);
      // 🔴 분모를 함께 — 판정 불가를 빼고 세면 "전건 PASS" 처럼 분모가 조용히 줄어든다
      expect(d.summary.total).toBe(2);
      expect(d.instruments[0].notEvaluable).toBe(1);
    });
  });

  /**
   * 🔴 봉합이 되돌아오는 것은 소스 문자열로 잡는다 — 이 네 자리는 Prisma·LLM 목을 통째로 세우지
   *    않으면 행동으로 부를 수 없는 깊은 경로라, **소스가 `?? 0` 으로 되돌아갔는지**를 본다.
   *    (기준선 스펙의 `sealed` 목록이 같은 사실을 스캐너 쪽에서 한 번 더 잡는다 — 이중 그물이다.)
   */
  describe('소스 회귀 — 0 폴백으로 되돌아가지 않는다', () => {
    const cases: [string, RegExp, string][] = [
      [
        '../../src/modules/admission/admission.service.ts',
        /fallRiskScore:[^\n]*fallRiskAssessment\?\.score\s*\?\?\s*null/,
        '낙상위험 미평가는 Morse 0점이 아니다',
      ],
      [
        '../../src/modules/crm/crm.service.ts',
        /avgScore:\s*s\._avg\.crmScore\s*!=\s*null\s*\?/,
        'RFM 세그먼트 평균 점수 미산출은 0점(최하 등급)이 아니다',
      ],
      [
        '../../src/modules/partner-request/partner-request.service.ts',
        /avgResponseTime:\s*avgResponseTime\._avg\.responseTime\s*!=\s*null\s*\?/,
        '미계측은 0ms(가장 빠름)가 아니다',
      ],
      [
        '../../src/modules/nutrition/nutrition-advanced.service.ts',
        /const percent = typeof raw === 'number' \? raw : null;/,
        '섭취율 미기록은 "0% 섭취"가 아니다',
      ],
    ];

    it.each(cases)('%s', async (rel, re, why) => {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const src = readFileSync(resolve(__dirname, rel), 'utf8');
      expect(re.test(src), why).toBe(true);
      // 🔴 대조군 — 정규식이 **아무것도 안 겨누는** 상태로 통과하지 않게 한다
      expect(src.length).toBeGreaterThan(100);
    });
  });
});
