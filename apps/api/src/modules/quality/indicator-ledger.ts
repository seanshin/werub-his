/**
 * 질 지표 ↔ **원내 구조화 원장** 대조표.
 *
 * 🔴 2026-09-02 종단 검토 실측 — 같은 사실을 두 화면이 다르게 말하고 있었다(P12):
 *
 *   | 지표 | `/quality` QI 대시보드 | `/safety-quality-board` · 원장 실측 |
 *   |------|------------------------|--------------------------------------|
 *   | 손위생 수행률 | **98.48% · 목표 달성** | 관찰 **0건** · 산출 불가(`null`) |
 *   | 환자만족도    | **84.62%**             | `satisfaction_surveys` **0행** |
 *   | 낙상 발생률   | 2026-05 분자 **7건**   | `safety_incidents(FALL)` 전 기간 **12건** |
 *
 *   QI 측정 원장(`qi_measurements`)은 **사람이 분자·분모를 넣는 수기 원장**이고, 시스템의 임상 사건
 *   기록과 **자동으로 대조되지 않는다**. 그런데 대시보드는 그 사실을 말하지 않아 "손위생 98.48% 달성"이
 *   원내 관찰 기록에 근거한 것처럼 읽혔다. 인증·보고에 그대로 인용되면 위험하다.
 *
 * 🔴 그렇다고 **수기 입력이 틀렸다고 단정하지 않는다** — 종이로 관찰하고 월 단위로 입력하는 것은
 *    정상적인 QI 운영이다. 시스템이 할 일은 **판정이 아니라 대조 근거를 나란히 놓는 것**이다.
 *    ("시스템은 권고하지 않는다 — 선택지와 결과만" · "주장마다 확인 경로")
 *
 * 🔴 **확인한 것만 적는다.** 아래 매핑은 운영 DB 에서 어휘를 실측해 확정한 것만 담는다.
 *    매핑이 없는 지표에는 **아무 말도 하지 않는다**(추정한 원장을 붙이면 거짓 경보가 된다).
 */
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { normalizeIndicatorKey } from './indicator-policy';
import { monthRangeLocal } from '../../common/day-range';

export interface IndicatorLedger {
  /** 사람이 읽을 원장 이름 */
  source: string;
  /**
   * 원장 건수 — 🔴 2026-10-08 종전엔 **전 기간** 건수라 월 측정("2026-05 분자 7") 옆에 "12건(전 기간)"이 붙어
   * 대조가 아니라 혼동이었다. 이제 측정 기간(월)이 있으면 **그 달 건수**, 없으면 전 기간(`period: null`).
   */
  count: number;
  /** 센 기간 — `YYYY-MM` 이면 그 달, null 이면 전 기간 */
  period: string | null;
}

/** 월 창(KST) — 날짜 필드 이름을 받아 where 조각을 만든다 */
type Range = { gte: Date; lt: Date } | null;
const inRange = (field: string, r: Range) => (r ? { [field]: { gte: r.gte, lt: r.lt } } : {});

/** 지표명(공백 제거) → 원장 카운터. 값은 실측으로 확인한 어휘만 쓴다. */
const LEDGERS: Record<string, { source: string; count: (p: PrismaService, r: Range) => Promise<number> }> = {
  '손위생수행률': {
    source: '손위생 관찰 기록',
    count: (p, r) => p.handHygieneObservation.count({ where: inRange('observedAt', r) }),
  },
  '환자만족도': {
    source: '만족도 설문 응답',
    count: (p, r) => p.satisfactionSurvey.count({ where: inRange('createdAt', r) }),
  },
  // safety_incidents.type 어휘는 운영 실측(FALL 12·MEDICATION_ERROR 12·PRESSURE_ULCER 10)
  '낙상발생률': {
    source: '환자안전사고(낙상)',
    count: (p, r) => p.safetyIncident.count({ where: { type: 'FALL', ...inRange('occurredAt', r) } }),
  },
  '투약오류발생률': {
    source: '환자안전사고(투약오류)',
    count: (p, r) => p.safetyIncident.count({ where: { type: 'MEDICATION_ERROR', ...inRange('occurredAt', r) } }),
  },
  '욕창발생률': {
    source: '환자안전사고(욕창)',
    count: (p, r) => p.safetyIncident.count({ where: { type: 'PRESSURE_ULCER', ...inRange('occurredAt', r) } }),
  },
  // ── 감염관리 — `infection_surveillance.infectionType` 은 enum 이 아니라 자유 문자열이다.
  //    운영 실측 어휘: HAP 1 · CAUTI 1 · SSI 1. **본 것만 매핑한다.**
  '병원감염발생률': {
    source: '감염 감시 기록',
    count: (p, r) => p.infectionSurveillance.count({ where: inRange('detectedAt', r) }),
  },
  '요로감염발생률(도뇨관)': {
    source: '감염 감시(CAUTI)',
    count: (p, r) => p.infectionSurveillance.count({ where: { infectionType: 'CAUTI', ...inRange('detectedAt', r) } }),
  },
  '수술부위감염률': {
    source: '감염 감시(SSI)',
    count: (p, r) => p.infectionSurveillance.count({ where: { infectionType: 'SSI', ...inRange('detectedAt', r) } }),
  },
  /**
   * 🔴 **매핑하지 않기로 한 것** — 여기 적어 두지 않으면 다음 사람이 다시 고민한다.
   *  · 인공호흡기 관련 폐렴(VAP) : 운영 어휘에 `VAP` 이 없다. `HAP`(원내폐렴)은 **다른 지표**라
   *    거기에 붙이면 임상적으로 틀린 대조가 된다 → 침묵.
   *  · 중심정맥관 관련 혈류감염(CLABSI) : 같은 이유로 어휘 부재 → 침묵.
   *  · 수혈 부작용 발생률 : 대응 원장 테이블을 찾지 못했다 → 침묵.
   *    (모르면 말하지 않는다. 추정한 원장은 거짓 경보가 된다.)
   */
  '필수교육이수율': {
    // 분모(대상자) 모델이 없어 '이수율'은 시스템이 산출하지 못한다 — **이수 기록 수**만 대조 근거로 준다
    source: '교육 이수 기록',
    count: (p, r) => p.educationCompletion.count({ where: inRange('completedAt', r) }),
  },
  '환자불만건수': {
    // VocTicket.type = QUESTION/COMPLAINT/SUGGESTION/COMPLIMENT — 불만만 센다(전체를 세면 부풀린다)
    source: 'VoC 불만 접수',
    count: (p, r) => p.vocTicket.count({ where: { type: 'COMPLAINT', ...inRange('createdAt', r) } }),
  },
};

/** 대조 가능한 지표명 집합 — 가드가 "매핑이 비지 않았는지" 먼저 확인한다 */
export const LEDGER_INDICATOR_KEYS = Object.keys(LEDGERS);

/**
 * 지표별 원장 건수 — 지표마다 **그 지표의 측정 기간(월)** 으로 센다. 기간이 없으면(미측정) 전 기간.
 * 매핑 없는 지표는 결과에 담기지 않는다 — 화면은 그 지표에 아무 말도 하지 않는다.
 * 같은 (지표, 기간)은 한 번만 센다.
 */
export async function collectIndicatorLedgers(
  prisma: PrismaService,
  items: Array<string | { name: string; period?: string | null }>,
): Promise<Map<string, IndicatorLedger>> {
  const wanted = new Map<string, string | null>();
  for (const it of items) {
    const name = typeof it === 'string' ? it : it.name;
    const period = typeof it === 'string' ? null : (it.period ?? null);
    const k = normalizeIndicatorKey(name);
    if (k in LEDGERS && !wanted.has(k)) wanted.set(k, period && /^\d{4}-\d{2}$/.test(period) ? period : null);
  }
  const out = new Map<string, IndicatorLedger>();
  await Promise.all(
    [...wanted.entries()].map(async ([k, period]) => {
      const def = LEDGERS[k];
      const range: Range = period ? (() => { const m = monthRangeLocal(period); return { gte: m.start, lt: m.end }; })() : null;
      // 🔴 조회 실패를 0(=원장 없음)으로 번역하지 않는다 — 세지 못하면 아무 말도 하지 않는다
      try {
        out.set(k, { source: def.source, count: await def.count(prisma, range), period });
      } catch {
        /* 대조 근거를 못 얻었을 뿐이다. 지어내지 않는다 */
      }
    }),
  );
  return out;
}
