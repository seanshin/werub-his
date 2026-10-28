import type { DecisionItem } from '../types';
import { LAYER_ORDER } from '../types';

/**
 * 개시 전 필수 결정의 의사결정 순서 — 선행(dependsOn)이 먼저 · 같은 차례는 층(허가권자 → 위원회 → 직원) → 키 순.
 * 선행이 개시 전 필수 밖에 있으면 순서에 넣지 않고 "선행(필수 밖)"으로 따로 적는다 · 🔴 순환이 있으면 지어 끊지 않고 표시한다.
 */
export function goLiveDecisionOrder(items: readonly DecisionItem[]): Array<{ item: DecisionItem; step: number | null; deps: string[]; outsideDeps: string[] }> {
  const req = items.filter((i) => i.goLive === 'REQUIRED_BEFORE');
  const keys = new Set(req.map((i) => i.key));
  const rank = (i: DecisionItem) => LAYER_ORDER.indexOf(i.layer);
  const cmp = (a: DecisionItem, b: DecisionItem) => rank(a) - rank(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const step = new Map<string, number>();
  let remaining = [...req];
  for (let s = 1; remaining.length; s++) {
    const ready = remaining.filter((i) => (i.dependsOn ?? []).filter((d) => keys.has(d)).every((d) => step.has(d)));
    if (!ready.length) break; // 순환 — 남은 것은 차례 없음(null)
    for (const i of ready) step.set(i.key, s);
    remaining = remaining.filter((i) => !step.has(i.key));
  }
  return [...req]
    .sort((a, b) => (step.get(a.key) ?? Infinity) - (step.get(b.key) ?? Infinity) || cmp(a, b))
    .map((item) => ({
      item, step: step.get(item.key) ?? null,
      deps: (item.dependsOn ?? []).filter((d) => keys.has(d)),
      outsideDeps: (item.dependsOn ?? []).filter((d) => !keys.has(d)),
    }));
}

/** 인쇄본 출력 점검 대상 — 인쇄 버튼이 있는 문서(2026-10-12 · 발급 상태와 함께) */
export const PRINT_CHECK_TARGETS: Array<{ name: string; where: string; issue: string }> = [
  { name: '결정 대장', where: '/admin/decisions/register', issue: '서버 발급(진위확인 QR)' },
  { name: '의사결정서', where: '/admin/decisions/<결정 키>', issue: '서버 발급(진위확인 QR)' },
  { name: '실서비스 개시 브리핑', where: '/admin/go-live', issue: '서버 발급(진위확인 QR)' },
  { name: '당직표(가로)', where: '/admin/duty-schedule', issue: '서버 발급(진위확인 QR)' },
  { name: 'QI 보고서', where: '/print/qi-report/<보고서 id>', issue: '서버 발급(진위확인 QR)' },
  { name: '단축키·화면번호', where: '/settings/shortcuts', issue: '발급 대상 아님(QR 없음)' },
  { name: '환자 차트 요약', where: '/patients/<환자 id>', issue: '원장 미등재(QR 없음)' },
  { name: '퇴원 정산서', where: '/inpatient/<입원 id>', issue: '원장 미등재(QR 없음)' },
  { name: '기록 상세', where: '/record-detail/<종류>/<id>', issue: '원장 미등재(QR 없음)' },
  { name: '기록 시계열(환자·입원)', where: '/record-timeline/…', issue: '원장 미등재(QR 없음)' },
  { name: '진단서 빠른 인쇄', where: '/print/diagnosis/<진료 id>', issue: '원장 미등재(QR 없음)' },
  { name: '사람 확인 문서(이 화면)', where: '/admin/decisions/checks', issue: '발급 대상 아님(QR 없음)' },
];
