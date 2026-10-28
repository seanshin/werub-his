import { decisionPrintCanonLine, type DecisionPrintSource } from './decision-print';

/**
 * 서버 발급 인쇄본 정본 줄 — 2026-10-12 기획 `decision-print-remaining` P1.
 *
 * 서버(발급 스냅샷)와 화면(인쇄 전 대조)이 **같은 함수**로 줄을 만든다. 해시 = 줄을 "\n" 으로 이은 UTF-8 의 sha256.
 * 줄의 첫 칸(`|` 앞)이 대조 키다 — 발급 판과 지금 원장을 키 단위로 비교한다.
 * 🔴 줄 모양을 바꾸면 이미 발급된 판과 대조가 깨진다 — 버전(`PRINT_CANON_VERSION`)을 올리고 옛 해석을 남긴다.
 */
export const PRINT_CANON_VERSION = 1;

/** 칸 안의 구분자 제거 — 사람 이름·라벨에 `|`·줄바꿈이 섞여도 줄이 깨지지 않게 */
export const printCell = (s: string | null | undefined) => String(s ?? '').replace(/[|\r\n]+/g, ' ');
/** 줄 정렬 — 코드 포인트 순(로캘에 기대지 않는다 · 서버·브라우저가 같다) */
export const sortPrintLines = (lines: string[]) => [...lines].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** 개시 브리핑 — go-live 항목 상태 + 개시 전 필수 결정 */
export function goLivePrintLines(
  items: ReadonlyArray<{ key: string; status: string }>,
  decisions: ReadonlyArray<DecisionPrintSource & { goLive?: string }>,
): string[] {
  return sortPrintLines([
    ...items.map((i) => `G:${i.key}|${printCell(i.status)}`),
    ...decisions.filter((d) => d.goLive === 'REQUIRED_BEFORE').map((d) => `D:${decisionPrintCanonLine(d)}`),
  ]);
}

/** 당직표 — 배정(근무 id·날짜·근무조·이름) + 승인 휴가(날짜·직원·종류) */
export function dutyRosterPrintLines(
  days: ReadonlyArray<{ date: string; shifts: ReadonlyArray<{ id: string; shift: string; staffName: string }>; leaves: ReadonlyArray<{ userId: string; type: string }> }>,
): string[] {
  return sortPrintLines(days.flatMap((d) => [
    ...d.shifts.map((s) => `S:${s.id}|${d.date}|${printCell(s.shift)}|${printCell(s.staffName)}`),
    ...d.leaves.map((l) => `L:${d.date}:${l.userId}|${printCell(l.type)}`),
  ]));
}

/** QI 보고서 — 보존된 본문 sha256 과 상태(본문을 두 번 저장하지 않는다) */
export const qiReportPrintLines = (r: { id: string; sha256: string | null; status: string }) => [`Q:${r.id}|${r.sha256 ?? ''}|${printCell(r.status)}`];

export type PrintDiffEntry = { key: string; before: string | null; after: string | null };

/** 키 단위 대조 — 같으면 빈 배열 · 바뀜·사라짐(after null)·새로 생김(before null) */
export function diffPrintLines(issued: readonly string[], now: readonly string[]): PrintDiffEntry[] {
  const keyOf = (l: string) => l.split('|', 1)[0];
  const a = new Map(issued.map((l) => [keyOf(l), l] as const));
  const b = new Map(now.map((l) => [keyOf(l), l] as const));
  const out: PrintDiffEntry[] = [];
  for (const [k, l] of a) { const m = b.get(k); if (m === undefined) out.push({ key: k, before: l, after: null }); else if (m !== l) out.push({ key: k, before: l, after: m }); }
  for (const [k, l] of b) if (!a.has(k)) out.push({ key: k, before: null, after: l });
  return out;
}
