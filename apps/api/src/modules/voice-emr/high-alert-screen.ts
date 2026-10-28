/**
 * VoiceEMR — 고위험약 판정. **정본은 약품 마스터(`medication_codes.high_alert_flag/category`)**이고,
 * 적용 범위 규칙은 shared `high-alert-double-check.ts` 다. 이 파일은 그 둘을 부르는 배선 + 마스터가
 * 없을 때의 **선별(screen) 후단**일 뿐, 스스로 고위험 어휘를 정하지 않는다.
 *
 * 🔴 2026-08-27. 종전 `orchestrator.ts` 는 이렇게 판정했다:
 *      const HIGH_ALERT = ['헤파린','인슐린','와파린','칼륨','kcl','모르핀','펜타닐','디곡신'];
 *      r.drug.toLowerCase().includes(h.toLowerCase())
 *    · 마스터를 **한 번도 보지 않았다**(운영 고위험 표식 634품목·7분류가 판정에 안 들어갔다).
 *    · 목록이 **한글 8개**뿐이라 `heparin`·`insulin`·상품명으로 발화하면 표식이 안 붙었다.
 *      v4.4.0 의 "DUR 55룰 중 43룰이 한글 룰·영문 마스터라 매칭 0" 과 **같은 형태**다.
 *    · 경로(IV/PO)를 보지 않아 이중확인 대상 여부는 말할 수 없었다.
 *
 * 그래서 판정을 **3출처**로 정직하게 나눈다(`HighAlertSource`):
 *   MASTER      — 약품 마스터 후보를 조회해 표식으로 판정했다(정본).
 *   TERM_SCREEN — 마스터에서 후보를 못 찾아 **발화어 선별**로 걸렀다(후단·과탐 가능).
 *   UNSCREENED  — 마스터에도 없고 선별어에도 없다 → **고위험 여부 미확인**.
 *                 🔴 `highAlert:false` 는 "고위험이 아니다"가 아니라 "확인하지 못했다"이다.
 *                 화면은 이 사실을 뭉개지 말고 그대로 말해야 한다.
 */
import {
  requiresIndependentDoubleCheck,
  HIGH_ALERT_CATEGORY_LABEL,
  type HighAlertCategory,
} from '@hospital-run/shared';
import type { Candidate } from './nbest-matcher';

export type HighAlertSource = 'MASTER' | 'TERM_SCREEN' | 'UNSCREENED';

export interface HighAlertVerdict {
  /** 고위험 표식이 확인됐는가. `false` + source `UNSCREENED` 는 **미확인**이다(음성 판정 아님). */
  highAlert: boolean;
  source: HighAlertSource;
  category: HighAlertCategory | null;
  /** 독립 이중확인(IPSG.3) 대상인가. 판정 불가는 `null` — 0/false 로 뭉개지 않는다. */
  doubleCheckRequired: boolean | null;
  /** 사람이 읽을 판정 사유 — 확인 카드에 그대로 띄울 문장(근거 없는 경고 금지) */
  reason: string;
}

/**
 * 🔴 **발화어 선별 목록 — 정본이 아니다.** 마스터 조회가 후보 0건일 때만 쓰는 후단이다.
 *
 * 어휘를 지어내지 않았다: 항목은 종전 하드코딩 8개와 **같은 약물**이고, 추가한 것은
 * 그 약물의 **영문 표기**뿐이다(= 한글 룰이 영문 발화를 못 잡던 결함의 직접 봉합).
 * 새 약물을 여기에 늘리지 말 것 — 늘려야 한다면 그 자리는 **약품 마스터**다.
 *
 * `category: null` = 마스터 7분류 어디에도 속하지 않는 고위험약. shared 정본이 이 경우를
 * "분류 미등재 고위험약"으로 **안전측 처리**하므로 억지로 분류를 붙이지 않는다(디곡신이 그렇다).
 */
export const SPOKEN_HIGH_ALERT_TERMS: readonly { terms: readonly string[]; category: HighAlertCategory | null }[] = [
  { terms: ['헤파린', 'heparin'], category: 'ANTICOAGULANT' },
  { terms: ['와파린', 'warfarin'], category: 'ANTICOAGULANT' },
  { terms: ['인슐린', 'insulin'], category: 'INSULIN' },
  { terms: ['칼륨', '포타슘', '염화칼륨', 'kcl', 'potassium'], category: 'CONCENTRATED_ELECTROLYTE' },
  { terms: ['모르핀', 'morphine'], category: 'OPIOID' },
  { terms: ['펜타닐', 'fentanyl'], category: 'OPIOID' },
  // 디곡신은 ISMP 고위험이지만 마스터 7분류에 해당하는 것이 없다 — 분류를 지어내지 않는다.
  { terms: ['디곡신', 'digoxin'], category: null },
];

const norm = (v: string | null | undefined) => String(v ?? '').toLowerCase().replace(/\s+/g, '');

/** 발화어 선별 — 걸리면 `{ matched, category }`, 아니면 `null`. */
export function screenSpokenTerm(spoken: string | null | undefined): { matched: string; category: HighAlertCategory | null } | null {
  const s = norm(spoken);
  if (!s) return null;
  for (const row of SPOKEN_HIGH_ALERT_TERMS) {
    const hit = row.terms.find((t) => s.includes(norm(t)));
    if (hit) return { matched: hit, category: row.category };
  }
  return null;
}

const label = (c: HighAlertCategory | null) => (c ? HIGH_ALERT_CATEGORY_LABEL[c] : '고위험 약물(분류 미등재)');

/**
 * 고위험 판정.
 *
 * 🔴 "후보가 있다"와 "마스터를 봤다"는 다른 사실이다. 후보에 `highAlertFlag` 가 **실려 있는 것**만
 *    마스터가 답한 것으로 센다 — 필드가 `undefined` 인 후보(주입 목·검색 EP 결과 등)를 `false` 로
 *    읽으면 마스터를 안 보고도 "고위험 아님"이라 말하게 된다.
 *
 * 판정 순서(아래로 갈수록 약한 근거이며, **어느 단계도 위 단계를 낮추지 않는다**):
 *   ① 마스터 후보 중 고위험 표식이 있다      → MASTER · 고위험
 *   ② 발화어 선별에 걸린다                   → TERM_SCREEN · 고위험 (①이 비어도 내리지 않는다)
 *   ③ 마스터가 답했고 표식이 하나도 없다      → MASTER · 고위험 아님
 *   ④ 아무것도 없다                          → UNSCREENED · **미확인**
 *
 * 후보가 여럿이고 그중 하나라도 표식이면 고위험으로 본다 — 어느 것을 처방할지 아직 확정되지
 * 않은 시점이라 관대하게 접으면 보호가 조용히 사라진다(모르면 안전측).
 */
export function resolveRxHighAlert(input: {
  spokenTerm: string;
  candidates: readonly Candidate[];
  route?: string | null;
}): HighAlertVerdict {
  const { spokenTerm, candidates, route } = input;
  const informed = candidates.filter((c) => typeof c.highAlertFlag === 'boolean');

  // ① 마스터 표식
  const flagged = informed.filter((c) => c.highAlertFlag === true);
  if (flagged.length > 0) {
    const top = flagged[0];
    const scope = requiresIndependentDoubleCheck({
      highAlertFlag: true,
      highAlertCategory: top.highAlertCategory ?? null,
      route: route ?? null,
    });
    return {
      highAlert: true,
      source: 'MASTER',
      category: scope.category,
      doubleCheckRequired: scope.required,
      reason: `약품 마스터 고위험 표식 — ${top.name}(${top.code}). ${scope.reason}`,
    };
  }

  // ② 발화어 선별 — 후단이지만 ①이 비었다고 해서 판정을 낮추는 데는 쓰지 않는다
  const hit = screenSpokenTerm(spokenTerm);
  if (hit) {
    const scope = requiresIndependentDoubleCheck({
      highAlertFlag: true,
      highAlertCategory: hit.category,
      route: route ?? null,
    });
    const where = informed.length
      ? `마스터 후보 ${informed.length}건에는 표식이 없었으나 발화어로 선별했습니다`
      : '약품 마스터에서 후보를 찾지 못해 발화어로 선별했습니다';
    return {
      highAlert: true,
      source: 'TERM_SCREEN',
      category: scope.category,
      doubleCheckRequired: scope.required,
      reason: `${where}(“${hit.matched}” → ${label(hit.category)}). ${scope.reason}`,
    };
  }

  // ③ 마스터가 답했고 표식이 없다
  if (informed.length > 0) {
    return {
      highAlert: false,
      source: 'MASTER',
      category: null,
      doubleCheckRequired: false,
      reason: `약품 마스터 후보 ${informed.length}건 모두 고위험(high-alert) 표식이 없습니다.`,
    };
  }

  // ④ 확인하지 못했다 — "고위험 아님"이 아니다
  return {
    highAlert: false,
    source: 'UNSCREENED',
    category: null,
    doubleCheckRequired: null,
    reason: '약품 마스터에서 후보를 찾지 못했고 선별어에도 걸리지 않았습니다 — 고위험 여부를 확인하지 못했습니다(확인 카드에서 약품을 선택하면 마스터로 판정합니다).',
  };
}
