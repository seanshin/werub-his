/**
 * 카탈로그(약속처방·치료일정 템플릿) 저장·상태 변경 결과를 사람이 읽을 문장으로(2026-10-21 임상 규칙 P2).
 * 정본 shared `catalog-lifecycle` — 사용 중 수정 = 새 판 초안 · 승인 대기/승인됨 수정 = 초안으로 · 사용 중으로 바꾸면 이전 판 폐기.
 * 서버 응답 모양을 화면이 짐작하지 않도록 읽는 곳을 하나로 둔다(봉투 `{data}` 유무 모두).
 */
import { catalogEditMode } from '@hospital-run/shared';

type Body = { editMode?: string; newVersionOf?: string; version?: number; supersededIds?: string[]; pathwayLinksToSuperseded?: number | null };
const body = (r: unknown): Body => ((r as { data?: { data?: Body } })?.data?.data ?? (r as { data?: Body })?.data ?? (r as Body) ?? {}) as Body;

/** 저장 결과 → 번역 키와 값(없으면 null = 평범한 저장) */
export function editResultNotice(r: unknown): { k: string; params?: Record<string, string | number> } | null {
  const b = body(r);
  if (b.editMode === 'NEW_VERSION') return { k: '사용 중인 판은 그대로 두고 새 판(v{판}) 초안을 만들었습니다 — 승인 후 사용 중으로 바꾸세요.', params: { 판: b.version ?? '?' } };
  if (b.editMode === 'RESET_APPROVAL') return { k: '승인 전 내용이 바뀌어 초안으로 되돌렸습니다 — 다시 승인을 받으세요.' };
  return null;
}

/** 사용 중으로 바꾼 결과 — 이전 판 폐기 수·이전 판을 가리키는 임상경로 수(조회 실패 null = 확인 불가) */
export function activationNotices(r: unknown): Array<{ k: string; params?: Record<string, string | number> }> {
  const b = body(r);
  const out: Array<{ k: string; params?: Record<string, string | number> }> = [];
  const n = b.supersededIds?.length ?? 0;
  if (n) out.push({ k: '같은 계보의 이전 판 {수}개를 폐기로 바꿨습니다.', params: { 수: n } });
  if (n && b.pathwayLinksToSuperseded === null) out.push({ k: '이전 판을 가리키는 임상경로를 확인하지 못했습니다.' });
  else if (b.pathwayLinksToSuperseded) out.push({ k: '임상경로 {수}곳이 이전 판을 가리킵니다 — 경로 편집에서 새 판으로 바꾸세요.', params: { 수: b.pathwayLinksToSuperseded } });
  return out;
}

/** 편집 창 안내 — 이 상태에서 저장하면 무엇이 일어나는가 */
export function editModeHint(status: string | undefined): string | null {
  if (!status) return null;
  const m = catalogEditMode(status);
  if (m === 'NEW_VERSION') return '사용 중 — 저장하면 새 판 초안이 생기고 지금 판은 그대로 쓰입니다.';
  if (m === 'RESET_APPROVAL') return '승인 단계 — 저장하면 초안으로 돌아가 다시 승인을 받아야 합니다.';
  return null;
}
