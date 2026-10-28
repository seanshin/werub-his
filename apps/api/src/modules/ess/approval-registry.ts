/**
 * HR 전자결재 — docType 레지스트리·채널 계층·결재선 변환 (기획 P3-1/P3-2, 2026-07-18)
 *
 * - DocTypeDef: 문서 타입별 참조 모듈·제목·승인 후 훅을 선언적으로 등록 — 신규 결재 문서 추가 시
 *   이 레지스트리에 1건 추가 + 훅 구현이 전부(수신함/decide/콜백 분기문 수정 불필요)
 * - ApprovalChannel: SIMULATION(자동 확정)|INTERNAL(HIS 보고라인 결재)|CLINIC(그룹웨어 W.Sign 위임)
 * - 결재선 변환: INTERNAL {staffId, order} ↔ CLINIC {step, userId(clinicUserId)} — 채널 전환 시 데이터 호환
 *   (W.Sign 합의 규격: 리허설 종결 2026-07-18 · relay-his-wsign-rehearsal-closed.md)
 */

export type ApprovalDecision = 'APPROVED' | 'REJECTED';
export type ApprovalChannelName = 'SIMULATION' | 'INTERNAL' | 'CLINIC';

/** 승인/반려 확정 훅 — 문서 타입별 도메인 반영(차감·정정 레코드·근무표 등). 멱등이어야 한다.
 * approverUserId/comment: 임상 확약(서명·발급·반려사유)에 필요 — HR 훅은 무시(하위호환). */
export type DecisionHook = (refId: string, decision: ApprovalDecision, approverName?: string, relayId?: string, approverUserId?: string, comment?: string) => Promise<unknown>;

/** 기안자 해소 — 결과 알림 대상 */
export type DrafterResolver = (refId: string) => Promise<string | undefined>;

/** 결재 대분류 — 전자결재/관리 대시보드/W.Sign 문서분류 구분 단위 */
export type ApprovalCategory = 'HR' | 'CLINICAL_RECORD' | 'PRE_AUTH';

export const CATEGORY_LABELS: Record<ApprovalCategory, string> = {
  HR: '인사·근태',
  // 표시명은 W.Sign(Clinic)과 '진료·의무기록'으로 통일(2026-07-20). 계약 코드값(CLINICAL_RECORD)은 불변.
  //  카테고리 실범위가 증명서·동의서·간호기록·사본 = 의무기록 전반이라 이 표시명이 더 정확.
  CLINICAL_RECORD: '진료·의무기록',
  PRE_AUTH: '사전승인',
};

export interface DocTypeDef {
  docType: string;
  refModule: string;
  /** 결재 대분류(카테고리) — 미지정 시 HR로 간주(하위호환) */
  category: ApprovalCategory;
  /** 확정 시 도메인 반영(HR_LEAVE는 leaveCallback 경유 — relay 갱신 포함 여부가 달라 별도 플래그) */
  onDecision: DecisionHook;
  /** true면 onDecision이 relay 상태까지 갱신(HR_LEAVE=leaveCallback). false면 decide가 relay를 직접 종결 */
  updatesRelay: boolean;
  resolveDrafter: DrafterResolver;
}

/** INTERNAL 결재선 항목 (HIS 정본) */
export interface InternalLineEntry {
  order: number;
  staffId: string;
  userId?: string;
  role?: 'APPROVE' | 'REFERENCE';
  result?: string;
  actedAt?: string;
  actedByStaffId?: string;
  delegated?: boolean;
  comment?: string;
}

/** CLINIC(W.Sign) 결재선 항목 — 합의 규격 {step, userId=clinicUserId} */
export interface ClinicLineEntry {
  step: number;
  userId: string;
  type?: 'approve' | 'reference';
  result?: string;
  actedAt?: string;
}

/** INTERNAL → CLINIC 결재선 변환 — staffId→clinicUserId 매핑 필요(미매핑 항목은 제외·사유 반환) */
export function toClinicLine(
  line: InternalLineEntry[],
  clinicIdOf: Map<string, string>, // staffId → clinicUserId
): { line: ClinicLineEntry[]; unmapped: string[] } {
  const out: ClinicLineEntry[] = [];
  const unmapped: string[] = [];
  for (const e of [...line].sort((a, b) => a.order - b.order)) {
    const cid = clinicIdOf.get(e.staffId);
    if (!cid) { unmapped.push(e.staffId); continue; }
    out.push({
      step: out.length + 1,
      userId: cid,
      type: e.role === 'REFERENCE' ? 'reference' : 'approve',
      ...(e.result ? { result: e.result } : {}),
      ...(e.actedAt ? { actedAt: e.actedAt } : {}),
    });
  }
  return { line: out, unmapped };
}

/** CLINIC → INTERNAL 결재선 변환 — clinicUserId→staffId 역매핑(미매핑 제외) */
export function fromClinicLine(
  line: ClinicLineEntry[],
  staffIdOf: Map<string, string>, // clinicUserId → staffId
): { line: InternalLineEntry[]; unmapped: string[] } {
  const out: InternalLineEntry[] = [];
  const unmapped: string[] = [];
  for (const e of [...line].sort((a, b) => a.step - b.step)) {
    const sid = staffIdOf.get(e.userId);
    if (!sid) { unmapped.push(e.userId); continue; }
    out.push({
      order: out.length + 1,
      staffId: sid,
      role: e.type === 'reference' ? 'REFERENCE' : 'APPROVE',
      ...(e.result ? { result: e.result } : {}),
      ...(e.actedAt ? { actedAt: e.actedAt } : {}),
    });
  }
  return { line: out, unmapped };
}

/** 레지스트리 컨테이너 — EssService가 부팅 시 훅을 바인딩해 채운다 */
export class DocTypeRegistry {
  private defs = new Map<string, DocTypeDef>();

  register(def: DocTypeDef) {
    this.defs.set(def.docType, def);
  }

  get(docType: string): DocTypeDef | undefined {
    return this.defs.get(docType);
  }

  has(docType: string): boolean {
    return this.defs.has(docType);
  }

  docTypes(): string[] {
    return [...this.defs.keys()];
  }

  /** docType의 카테고리(미등록 시 HR 기본) */
  categoryOf(docType: string): ApprovalCategory {
    return this.defs.get(docType)?.category ?? 'HR';
  }

  /** 카테고리에 속한 docType 목록 */
  docTypesByCategory(category: ApprovalCategory): string[] {
    return [...this.defs.values()].filter((d) => d.category === category).map((d) => d.docType);
  }

  /** 등록된 전체 정의(대시보드·집계용) */
  allDefs(): DocTypeDef[] {
    return [...this.defs.values()];
  }
}
