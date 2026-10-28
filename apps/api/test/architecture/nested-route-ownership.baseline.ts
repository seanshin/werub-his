/**
 * 중첩 경로(경로 파라미터 2개 이상) 재고 — 2026-09-16 E2 전수.
 *
 * D2 가 고친 12자리는 스펙이 이름으로 못박는다. 이 기준선은 **새로 생기는 중첩 경로**를 잡는다:
 * 판정기(`nested-route-judge`)가 "부모가 조회 조건에 닿는다"를 못 보면 실패.
 *
 * 🔴 **면제는 근거에 묶는다.** 첫 판은 경로 이름만 적었는데, 면제된 자리(`removeMember`)의 팀 비교를
 *    지우고 재주입했더니 **가드가 통과했다** — 한번 면제되면 대조를 지워도 침묵하는 사각이었다.
 *    그래서 항목마다 `evidence`(그 대조가 코드에 실재한다는 표식)를 함께 둔다. 표식이 사라지면 실패한다.
 */

/** 중첩 경로 총수 — 늘면 새 경로가 생긴 것이니 판정하고 이 수를 갱신한다 */
// 55 → 56 (2026-09-27): D8 세그먼트 재라벨 `PATCH /encounters/:encounterId/scribe/:sid/segment/:index`.
// 부모(encounterId)를 조회 조건에 쓰므로 판정 scoped — 면제 목록·unresolved 테스트가 통과하는 것이 그 증거다.
// 2026-09-28 +1: GET api/v1/space-assets/history/:kind/:assetId (scoped — 종류·자산 둘 다 조회 조건)
// +1 2026-09-30 `POST patients/:id/education/:recordId/void` — 서비스가 기록의 patientId 를 경로 환자와 대조(scoped)
// +1 2026-10-03 `GET patients/:patientId/medical-record/versions/:versionId` — 서비스가 판의 patientId 를 경로 환자와 대조(scoped · 다르면 404)
export const NESTED_ROUTE_TOTAL = 65; // +1 2026-10-22 POST inpatient/:id/interim-billings/:billingId/refund(중간정산 환불 · findFirst where {id: billingId, admissionId} — scoped) // +1 2026-10-22 PATCH inpatient/:id/interim-billings/:billingId/void(중간정산 무효 · findFirst where {id, admissionId} — scoped) // +1 2026-10-21 GET forms/:id/revisions/:revision(폼 한 판 · 복합 유일키 formSchemaId+revision 으로 조회 — scoped) // +1 2026-10-13 document-sign/content-hash/:type/:id(서명 대상 내용 해시 · :type 은 부모가 아니라 종류 · 면제 근거 아래) // +1 2026-10-05 surgery/:surgeryId/intraop/events/:eventId/void(수술 중 기록 무효 · 서비스가 surgeryId 일치 검사) · +1 2026-10-04 handoffs/:id/actions/:index(인계 조치 체크 · 서비스가 당사자 검사)

export interface ScopeExemption {
  /** 왜 결함이 아닌가(2026-09-16 한 건씩 읽고 확인) */
  why: string;
  /** 대조가 실재한다는 표식 — 파일 안에 이 문자열이 있어야 한다 */
  file: string;
  evidence: string;
}

/** 판정기가 볼 수 없는 방식으로 대조하는 자리 */
export const NESTED_SCOPE_EXEMPT: Record<string, ScopeExemption> = {
  'POST api/v1/codes/:sourceTable/:id/retire': {
    why: 'sourceTable 이 모델을 고른다 — 다른 표의 id 는 조회되지 않는다',
    file: 'code-master/code-usage.service.ts', evidence: 'MODEL_BY_TABLE[sourceTable]',
  },
  'GET api/v1/codes/:sourceTable/:id/usage': {
    why: '같음 — sourceTable→모델 디스패치',
    file: 'code-master/code-usage.service.ts', evidence: 'MODEL_BY_TABLE[sourceTable]',
  },
  'DELETE api/v1/consult/teams/:id/members/:userId': {
    why: '읽어온 멤버의 팀을 경로의 팀과 비교하고 404',
    file: 'consult/consult-team.service.ts', evidence: 'a.teamId !== teamId',
  },
  'POST api/v1/admin/decisions/:key/attachments/:id/extract': {
    why: '첨부가 그 key 레코드의 목록 안에 있다',
    file: 'decision-registry/decision.service.ts', evidence: 'await this.pendingAttachments(key)).find',
  },
  'GET api/v1/document-sign/content-hash/:type/:id': {
    why: ':type 은 부모 id 가 아니라 문서 종류 — 종류별 원장 하나에서 :id 로 찾는다(종류 밖은 400)',
    file: 'document-sign/document-content-hash.ts', evidence: 'if (!isContentHashType(type)) return null;',
  },
  'GET api/v1/document-sign/document/:type/:id': {
    why: 'where 에 documentType·documentId 를 함께 건다',
    file: 'document-sign/document-sign.service.ts', evidence: 'where: { documentType, documentId }',
  },
  'GET api/v1/encounters/:id/attachments/file/:fname': {
    why: 'HMAC 토큰이 (encounterId,fname,exp) 에 묶인다 — 다른 진료의 토큰은 검증 실패',
    file: 'encounter/encounter.service.ts', evidence: 'this.attToken(encounterId, fname, expNum)',
  },
  'POST api/v1/legal-holds/:holdId/patients/:patientId/release-request': {
    why: 'getHold 가 보존명령의 환자와 경로의 환자를 비교한다(부모가 첫 파라미터가 아니다)',
    file: 'legal-hold/legal-hold.service.ts', evidence: 'h.patientId !== patientId',
  },
  'POST api/v1/legal-holds/:holdId/patients/:patientId/release': {
    why: '같음 — getHold 비교',
    file: 'legal-hold/legal-hold.service.ts', evidence: 'h.patientId !== patientId',
  },
  'DELETE api/v1/opening/tasks/:key/attachments/:id': {
    why: '첨부가 taskKey 레코드의 목록 안에 있다',
    file: 'opening/opening.service.ts', evidence: 'readAttachments(rec.attachments).filter',
  },
  'POST api/v1/opening/tasks/:key/attachments/:id/extract': {
    why: '같음 — attachmentPath(taskKey, id)',
    file: 'opening/opening.service.ts', evidence: "join(process.cwd(), 'uploads', 'opening', taskKey, att.id)",
  },
  'GET api/v1/encounters/:encounterId/scribe/audio/:fname': {
    why: 'HMAC 토큰이 (encounterId,fname,exp) 에 묶인다 + 게이트 OFF 면 즉시 차단',
    file: 'scribe/scribe.service.ts', evidence: 'this.audioToken(encounterId, fname, expNum)',
  },
};
