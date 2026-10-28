export type GateMode = 'OFF' | 'WARN' | 'BLOCK';

/**
 * 안전 게이트 모드 정규화 — fail-closed.
 * - 설정 부재(null/빈문자열): fallbackWhenAbsent(기본 BLOCK). 게이트별 등록 기본이 WARN이면 'WARN', per-rule 맵이면 'OFF' 전달.
 * - 명시적 'OFF'/'WARN'(공백 제거·대문자): 그대로 완화.
 * - 그 외 존재하는 값(오타·'BLOCKED'·'BLOCK '·공백 포함): **항상 BLOCK**.
 * 과거 `String(x).toUpperCase() === 'BLOCK'` 방식은 'BLOCK '·오타에서 조용히 무시(fail-open)되어
 * ABO 부적합·과선량·2인확인 등 치명 통제가 우회됐음.
 */
export function gateMode(raw: unknown, fallbackWhenAbsent: GateMode = 'BLOCK'): GateMode {
  if (raw == null || String(raw).trim() === '') return fallbackWhenAbsent;
  const m = String(raw).trim().toUpperCase();
  if (m === 'OFF') return 'OFF';
  if (m === 'WARN') return 'WARN';
  return 'BLOCK';
}

/**
 * 영역별 게이트 맵(예: `formulary.enforce`)의 대표 모드 — 🔴 **최저 영역이 기준**이다.
 *
 * 🔴 2026-08-19 실측 결함 둘:
 *   ① `gateMode({MEDICATION:'WARN'})` 은 `String(raw)` 가 `"[object Object]"` 라 **무조건 BLOCK** 을 냈다.
 *      → 안전 게이트 관제가 **전 영역 OFF 인 포뮬러리를 "BLOCK"** 으로 표시했다(정반대의 사실).
 *   ② 관제의 다른 경로는 "하나라도 BLOCK 이면 BLOCK"(최강 기준)으로 접었다 —
 *      7영역 중 1개만 BLOCK 이어도 붉은 배지가 떠 **여섯 영역이 열려 있다는 사실이 가려졌다.**
 *   go-live 는 이미 최저 기준으로 고쳐져 있었다(`go-live.registry` 주석) — **정본이 둘이었다.**
 *
 * 안전은 **가장 약한 고리**로 결정된다. 그래서 대표 모드는 floor 이고, 커버리지를 함께 낸다
 * (분모 없는 배지는 "얼마나 통제되는지"를 말하지 못한다).
 */
export interface MapGateSummary {
  /** 최저 영역 기준 대표 모드 — 한 영역이라도 OFF 면 OFF */
  mode: GateMode;
  /** 시행 중(OFF 아님) 영역 수 */
  active: number;
  /** 설정된 영역 수(분모) */
  total: number;
  /** `MEDICATION:WARN · LAB:BLOCK` — 영역별 실제 값 */
  detail: string;
  /** 영역이 하나도 설정되지 않았다 — "전부 OFF"와 다른 사실이다 */
  unset: boolean;
}

export function summarizeMapGate(raw: unknown): MapGateSummary {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const entries = Object.entries(obj).map(([k, v]) => [k, gateMode(v, 'OFF')] as const);
  if (entries.length === 0) {
    return { mode: 'OFF', active: 0, total: 0, detail: '설정된 영역 없음', unset: true };
  }
  // 🔴 floor — 하나라도 OFF 면 OFF, 하나라도 WARN 이면 WARN(전부 BLOCK 일 때만 BLOCK)
  const mode: GateMode = entries.some(([, m]) => m === 'OFF')
    ? 'OFF'
    : entries.some(([, m]) => m === 'WARN')
      ? 'WARN'
      : 'BLOCK';
  const active = entries.filter(([, m]) => m !== 'OFF').length;
  return {
    mode,
    active,
    total: entries.length,
    detail: entries.map(([k, m]) => `${k}:${m}`).join(' · '),
    unset: false,
  };
}

export type GateEntryType = 'TRI' | 'MAP' | 'BOOL';

/**
 * DEFAULTS 카탈로그 엔트리의 게이트 분류 — 안전 게이트 관제 수집과 거버넌스 헬스체크(D13)가
 * 같은 판정을 쓰기 위한 단일 분류기. 값 타입이 정본, 설명 표기는 보조 신호.
 * - TRI: 문자열 값 + 설명에 3상(OFF|WARN|BLOCK — 구분자 표기 차이 허용)
 * - MAP: 객체 값 + 설명에 3상 (영역/유형별 부분 키 맵 — D15)
 * - BOOL: boolean 값 + 게이트성 신호(key 에 enforce/gate/require 또는 설명에 필수/차단/게이트)
 * - null: 게이트 아님(수집 비대상)
 */
export function classifyGateEntry(e: { key: string; value: unknown; description?: string }): GateEntryType | null {
  const desc = e.description ?? '';
  const triDesc = /OFF\s*[|/·]\s*WARN\s*[|/·]\s*BLOCK/i.test(desc);
  if (typeof e.value === 'string') return triDesc ? 'TRI' : null;
  if (e.value !== null && typeof e.value === 'object' && !Array.isArray(e.value)) return triDesc ? 'MAP' : null;
  if (typeof e.value === 'boolean') {
    return /enforce|gate|require/i.test(e.key) || /(필수|차단|게이트)/.test(desc) ? 'BOOL' : null;
  }
  return null;
}
