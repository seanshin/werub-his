import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 화면에 활력 임계 숫자를 적지 않는다(2026-10-01 전수).
 *
 *    같은 측정치를 화면마다 다른 숫자로 판정했다 — 간호 스테이션 SBP>140 · 입원 상세 SpO2<94·RR>24 ·
 *    플로시트 SBP>160·HR>120(혈압 칸은 문자열이라 **어떤 혈압도 이상 표시 안 됨**) · 응급 HR>100·BT<36 ·
 *    ICU HR>130(`hr &&` 라 **HR 0 무경보**) · FE `VITAL_RANGES`(또 하나의 "단일 정책") · 진료 화면 `warnIf(v >= 140)`.
 *    환자안전위가 `clinical.vitals.thresholds` 를 개정해도 화면들은 각자 옛 숫자였다.
 *    판정은 `@/lib/vital-flags`(`useVitalsThresholds`·`flagsWith`) 또는 서버 `flags` 로만 한다.
 *
 * 아래 허용 목록은 **활력 경보 임계가 아닌** 숫자다(이유를 적는다). 늘면 실패 · 줄면 목록을 줄인다(정확 동결).
 */
const WEB = join(process.cwd(), '../web/src');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(p) && !/\.(spec|test)\./.test(p)) out.push(p);
  }
  return out;
}

/** 활력 이름 뒤 비교 연산 + 숫자 — 주석은 지우고 센다(설명 속 옛 숫자는 결함이 아니다) */
const VITAL_CMP = /(systolic|sbp|heartRate|\bhr\b|spo2|temperature|bodyTemp|\btemp\b|respiratoryRate|\brr\b|painScore|diastolic|dbp|\bbt\b|\bbp\b)[A-Za-z?.)\]]*\s*(\?\?\s*[0-9]+\)?\s*)?(>=|<=|>|<)\s*[0-9]{1,3}(\.[0-9])?\b/gi;
/** `warnIf(x, (v) => v >= 140)` 형태(판정 함수에 숫자를 넣는 것) */
const WARNIF_LITERAL = /warnIf\([^)]*\)\s*=>\s*v\s*(>=|<=|>|<)\s*[0-9]/g;

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

function scan(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of walk(WEB)) {
    const code = stripComments(readFileSync(f, 'utf8'));
    const n = (code.match(VITAL_CMP)?.length ?? 0) + (code.match(WARNIF_LITERAL)?.length ?? 0);
    if (n) out[f.slice(WEB.length + 1)] = n;
  }
  return out;
}

/** 활력 경보 임계가 아닌 것 — 이유와 함께 정확 동결 */
const ALLOWED: Record<string, { n: number; why: string }> = {
  'app/portal/_shared/NotificationCenter.tsx': { n: 1, why: 'hr = 시간(경과 표시)' },
  'lib/build-status.ts': { n: 1, why: 'hr = 시간(경과 표시)' },
  'app/(main)/print/receipt/[billingId]/page.tsx': { n: 2, why: 'hr = 시각(야간·공휴 가산)' },
  'app/(main)/blood-bank/page.tsx': { n: 1, why: 'bt = 혈액형' },
  'app/(main)/chronic/page.tsx': { n: 2, why: '고혈압 **조절 목표** 140/90(만성질환 관리 목표 — 급성 경보 임계 아님)' },
  'app/(main)/patients/[id]/components/ChronicTrendPanel.tsx': { n: 2, why: '고혈압 조절 목표 140/90(만성질환 관리)' },
  'app/(main)/workstation/post-op/page.tsx': { n: 2, why: '통증 NRS 중증도 구간(4·7 — 척도 정의)' },
  'app/(main)/patients/[id]/components/NursingRecordTab.tsx': { n: 1, why: '통증 NRS 중등도 이상(4 — 척도 정의)' },
  'app/(main)/inpatient/[admissionId]/page.tsx': { n: 2, why: '통증 입력 슬라이더 NRS 구간 색(척도 정의)' },
  'app/(main)/inpatient/[admissionId]/nursing/assessment/page.tsx': { n: 8, why: '통증 NRS 구간 색(척도 정의)' },
  'app/(main)/pacu/page.tsx': { n: 3, why: 'Aldrete SpO2 선택지 문구(채점 도구 정의)·통증 NRS 4' },
  'app/(main)/obgyn/page.tsx': { n: 2, why: '태아 심박(FHR) 정상 110–160 — 산모 활력 임계와 다른 척도(정본 VITALS_THRESHOLDS 범위 밖)' },
  'components/specialty/ScoreCalculator.tsx': { n: 2, why: 'CURB-65·qSOFA 채점 문구(국제 채점 도구)' },
  'lib/clinical-charts/definitions/scoring.ts': { n: 1, why: '채점 도구 문구' },
};

describe('화면 활력 임계 숫자 — 정본 밖 판정 금지', () => {
  it('🔴 허용 목록 밖에 활력 비교 숫자가 없다 · 허용 목록은 정확 동결(늘면 실패·줄면 목록을 줄인다)', () => {
    const got = scan();
    const want = Object.fromEntries(Object.entries(ALLOWED).map(([k, v]) => [k, v.n]));
    expect(got).toEqual(want);
  });
  it('대조군 — 검사기가 실제로 잡는다(옛 형태 문자열)', () => {
    const code = "const a = v.hr > 130 || v.hr < 40; flagTone(warnIf(x.spo2, (v) => v < 95));";
    expect(code.match(VITAL_CMP)?.length).toBe(2);
    expect(code.match(WARNIF_LITERAL)?.length).toBe(1);
  });
  it('FE `VITAL_RANGES` 같은 두 번째 임계표가 다시 생기지 않는다', () => {
    const hits = walk(WEB).filter((f) => /VITAL_RANGES|function isAbnormalVital|isAbnormalBp|isAbnormalHr/.test(stripComments(readFileSync(f, 'utf8'))));
    expect(hits.map((f) => f.slice(WEB.length + 1))).toEqual([]);
  });
});

/** 서버도 같은 규칙 — 활력 경보 판정은 shared `VITALS_THRESHOLDS`(+개정) 하나. 아래는 경보 임계가 아닌 것(정확 동결) */
const API_SRC = join(process.cwd(), 'src');
// PACU 밀착감시 임계는 2026-10-01 설정화(`pacu.vitalAlertThresholds` · `PACU_ALERT_DEFAULTS` 객체 상수) — 비교 숫자 0
const API_ALLOWED: Record<string, { n: number; why: string }> = {
  'modules/icu/icu-scores.ts': { n: 12, why: 'APACHE II 점수 밴드(국제 채점 도구)' },
  'modules/internal-medicine/internal-medicine.service.ts': { n: 5, why: 'CURB-65·qSOFA 채점(국제 채점 도구)' },
  'modules/nursing/nursing.service.ts': { n: 4, why: '간호진단 제안 근거(통증 NRS 4·7·SpO2<92·발열 38) — 경보가 아니라 제안 신뢰도' },
  'modules/lab/cell-therapy.service.ts': { n: 2, why: '세포치료 투여 적격 기준(제품 프로토콜)' },
  'modules/chronic/chronic.service.ts': { n: 2, why: '고혈압 조절 목표 140/90(만성질환 관리)' },
  'modules/obgyn/obgyn.service.ts': { n: 2, why: '전자간증 중증 고혈압 기준(≥160/110 + 단백뇨)' },
};

describe('서버 활력 임계 숫자 — 정본 밖 판정 금지', () => {
  it('🔴 허용 목록 밖에 활력 비교 숫자가 없다(담당 환자 상태 HR>140 위급 같은 자기 숫자 회수 · 정확 동결)', () => {
    const got: Record<string, number> = {};
    for (const f of walk(API_SRC)) {
      if (f.includes('/vitals-thresholds') ) continue;
      const n = stripComments(readFileSync(f, 'utf8')).match(VITAL_CMP)?.length ?? 0;
      if (n) got[f.slice(API_SRC.length + 1)] = n;
    }
    expect(got).toEqual(Object.fromEntries(Object.entries(API_ALLOWED).map(([k, v]) => [k, v.n])));
  });
});
