import { describe, it, expect, beforeEach, vi } from 'vitest';
import { collectIndicatorLedgers, LEDGER_INDICATOR_KEYS } from '../../src/modules/quality/indicator-ledger';

/**
 * 질 지표 ↔ 원내 구조화 원장 대조.
 *
 * 🔴 2026-09-02 종단 검토 실측 — 같은 사실을 두 화면이 다르게 말했다(P12):
 *    `/quality` 는 **손위생 98.48% · 목표 달성**, 같은 시각 `/safety-quality-board` 는
 *    **관찰 0건 · 산출 불가(null)**. 만족도도 84.62% 인데 `satisfaction_surveys` 는 0행이었다.
 *    QI 측정 원장은 수기 입력이고 임상 사건 기록과 자동 대조되지 않는데, 화면이 그 사실을 말하지 않았다.
 *
 * 🔴 이 대조는 **판정이 아니다** — 수기 입력이 틀렸다고 단정하지 않고 근거만 나란히 놓는다.
 */
describe('지표 원장 대조', () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      handHygieneObservation: { count: vi.fn().mockResolvedValue(0) },
      satisfactionSurvey: { count: vi.fn().mockResolvedValue(0) },
      safetyIncident: { count: vi.fn().mockResolvedValue(12) },
    };
  });

  it('대조 기준 자체가 비어 있지 않다 — 매핑이 0이면 이 가드는 아무것도 안 한다', () => {
    expect(LEDGER_INDICATOR_KEYS.length).toBeGreaterThanOrEqual(10);
    expect(LEDGER_INDICATOR_KEYS).toContain('손위생수행률');
    expect(LEDGER_INDICATOR_KEYS).toContain('환자만족도');
  });

  /**
   * 🔴 **매핑하지 않기로 한 것이 조용히 매핑되지 않게** 한다.
   *    운영 `infection_surveillance.infectionType` 어휘는 HAP·CAUTI·SSI 뿐이다.
   *    인공호흡기 폐렴(VAP)·중심정맥관 혈류감염(CLABSI)을 HAP 에 붙이면 **임상적으로 틀린 대조**가 되고,
   *    수혈 부작용은 대응 원장을 찾지 못했다. 셋 다 침묵이 정답이다.
   */
  it.each(['인공호흡기 관련 폐렴 발생률', '중심정맥관 관련 혈류감염률', '수혈 부작용 발생률'])(
    '%s 는 어휘를 확인하지 못해 매핑하지 않는다',
    async (name) => {
      /**
       * 🔴 목에 모델이 없으면 카운터가 던져서 **다른 이유로 통과한다**(실제로 겪었다 —
       *    VAP 를 HAP 에 붙이는 재주입이 이 목 때문에 통과했다). 셀 수 있는 목을 준다.
       */
      const full: any = {
        ...prisma,
        infectionSurveillance: { count: vi.fn().mockResolvedValue(1) },
        educationCompletion: { count: vi.fn().mockResolvedValue(1) },
        vocTicket: { count: vi.fn().mockResolvedValue(1) },
        transfusionReaction: { count: vi.fn().mockResolvedValue(1) },
      };
      const m = await collectIndicatorLedgers(full, [name]);
      expect(m.size, '확인하지 못한 원장을 붙였다 — 거짓 대조가 된다').toBe(0);
    },
  );

  it('감염·교육·VoC 도 실측 어휘로만 센다', async () => {
    prisma.infectionSurveillance = { count: vi.fn().mockResolvedValue(1) };
    prisma.educationCompletion = { count: vi.fn().mockResolvedValue(812) };
    prisma.vocTicket = { count: vi.fn().mockResolvedValue(1) };
    await collectIndicatorLedgers(prisma, ['요로감염 발생률 (도뇨관)', '수술부위 감염률', '환자 불만 건수', '필수교육 이수율']);
    const calls = prisma.infectionSurveillance.count.mock.calls.map((c: any[]) => JSON.stringify(c[0]));
    expect(calls).toContain(JSON.stringify({ where: { infectionType: 'CAUTI' } }));
    expect(calls).toContain(JSON.stringify({ where: { infectionType: 'SSI' } }));
    // 🔴 VoC 는 불만만 — 전체를 세면 지표를 부풀린다
    expect(prisma.vocTicket.count).toHaveBeenCalledWith({ where: { type: 'COMPLAINT' } });
    expect(prisma.educationCompletion.count).toHaveBeenCalled();
  });

  it('🔴 원장이 비어 있으면 0 건으로 그대로 말한다(실측된 그 상태)', async () => {
    const m = await collectIndicatorLedgers(prisma, ['손위생 수행률', '환자만족도']);
    expect(m.get('손위생수행률')).toEqual({ source: '손위생 관찰 기록', count: 0, period: null });
    expect(m.get('환자만족도')?.count).toBe(0);
  });

  it('사고 원장은 유형으로 센다 — 어휘는 운영 실측으로 확정한 것만', async () => {
    await collectIndicatorLedgers(prisma, ['낙상 발생률']);
    expect(prisma.safetyIncident.count).toHaveBeenCalledWith({ where: { type: 'FALL' } });
  });

  it('공백 표기가 달라도 같은 지표로 본다(DB 실값 대응)', async () => {
    const m = await collectIndicatorLedgers(prisma, ['손위생  수행률']);
    expect(m.has('손위생수행률')).toBe(true);
  });

  it('🔴 매핑 없는 지표에는 아무 말도 하지 않는다 — 추정한 원장은 거짓 경보다', async () => {
    const m = await collectIndicatorLedgers(prisma, ['병상 가동률', '수술실 가동률']);
    expect(m.size).toBe(0);
  });

  it('🔴 세지 못한 것을 0(=원장 없음)으로 번역하지 않는다', async () => {
    prisma.handHygieneObservation.count.mockRejectedValue(new Error('db down'));
    const m = await collectIndicatorLedgers(prisma, ['손위생 수행률']);
    expect(m.has('손위생수행률')).toBe(false); // 조회 실패 = 아무 말 안 함
  });

  it('지표가 여러 번 나와도 원장은 한 번만 센다(N+1 아님)', async () => {
    await collectIndicatorLedgers(prisma, ['환자만족도', '환자만족도', '환자만족도']);
    expect(prisma.satisfactionSurvey.count).toHaveBeenCalledTimes(1);
  });
});

describe('대시보드가 그 대조를 실제로 붙인다', () => {
  /**
   * 🔴 이 it 이 없었을 때, "대시보드가 `ledger: null` 을 내도록" 재주입해도 전 스위트가 **통과했다**.
   *    수집 함수만 검사하면 그것을 부르지 않는 회귀를 못 잡는다(가드가 다른 이유로 통과하는 자리).
   */
  it('매핑된 지표에 ledger 가 붙는다', async () => {
    const { QualityService } = await import('../../src/modules/quality/quality.service');
    const prisma: any = {
      qualityIndicator: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'i1', name: '손위생 수행률', category: '감염관리', formula: null, targetValue: 95, direction: null, unit: null, valueScale: null, isActive: true, measurements: [{ value: 98.48, period: '2026-05', measuredAt: new Date() }] },
          { id: 'i2', name: '병상 가동률', category: '진료효율', formula: null, targetValue: 85, direction: null, unit: null, valueScale: null, isActive: true, measurements: [] },
        ]),
      },
      handHygieneObservation: { count: vi.fn().mockResolvedValue(0) },
      satisfactionSurvey: { count: vi.fn().mockResolvedValue(0) },
      safetyIncident: { count: vi.fn().mockResolvedValue(0) },
    };
    const rows: any[] = await new QualityService(prisma).getDashboard();
    const hh = rows.find((r) => r.name === '손위생 수행률');
    // 2026-10-08 — 원장 대조는 **그 지표의 최신 측정 달**로 센다(종전 전 기간 건수는 월 측정과 대조가 안 됐다)
    expect(hh.ledger, '대시보드가 원장 대조를 붙이지 않았다').toEqual({ source: '손위생 관찰 기록', count: 0, period: '2026-05' });
    // 매핑 없는 지표는 null — 화면이 아무 말도 하지 않는다
    expect(rows.find((r) => r.name === '병상 가동률').ledger).toBeNull();
  });
});

describe('화면이 그 대조를 그린다', () => {
  it('QI 화면이 ledger 를 렌더한다 — 서버만 붙이면 아무도 못 본다', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), '..', 'web', 'src', 'app', '(main)', 'quality', 'page.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).toContain('<LedgerNote');
    expect(src).toContain('q.ledger');
    // 판정으로 오해되지 않게 — '미달' 이라 단정하지 않는다
    expect(src).toContain('수기 입력');
  });
});
