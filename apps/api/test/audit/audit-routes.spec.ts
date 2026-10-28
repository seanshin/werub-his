import { describe, it, expect } from 'vitest';
import {
  ZERO_UUID,
  actionForMethod,
  deriveResourceType,
  extractResourceId,
  isExempt,
  patientIdFromQuery,
  toResourceName,
  PHI_READ_PATTERNS,
} from '../../src/modules/audit/audit-routes';

const UUID_A = '8f14e45f-ceea-467a-9b3a-1a1b2c3d4e5f';
const UUID_B = '3b9f0e1c-7d2a-4c58-9f10-0a1b2c3d4e5f';

const isPhiRead = (path: string) => PHI_READ_PATTERNS.some((p) => p.test(path));

describe('감사 라우트 규약', () => {
  describe('PHI 열람 패턴 — hex 부분매칭 오탐 봉합', () => {
    it('집계·목록 조회를 환자 열람으로 오인하지 않는다 (구 `[0-9a-f-]+` 결함)', () => {
      expect(isPhiRead('/api/v1/billing/daily-summary')).toBe(false);
      expect(isPhiRead('/api/v1/billing/cashier-queue')).toBe(false);
      expect(isPhiRead('/api/v1/billing/deferred')).toBe(false);
      expect(isPhiRead('/api/v1/patients/export')).toBe(false);
    });

    it('실제 청구서 열람(복수형 라우트)을 기록한다', () => {
      expect(isPhiRead(`/api/v1/billings/${UUID_A}`)).toBe(true);
      expect(isPhiRead(`/api/v1/patients/${UUID_A}`)).toBe(true);
      expect(isPhiRead(`/api/v1/encounters/${UUID_A}`)).toBe(true);
    });
  });

  describe('resourceType 파생', () => {
    it('레지스트리 매핑을 우선한다', () => {
      expect(deriveResourceType(`/api/v1/patients/${UUID_A}`)).toBe('Patient');
      expect(deriveResourceType('/api/v1/billings')).toBe('Billing');
      expect(deriveResourceType('/api/v1/inpatient/nursing-notes')).toBe('Admission');
    });

    it('프리픽스 경계를 지킨다 — order-sets 는 Order 가 아니다', () => {
      expect(deriveResourceType('/api/v1/orders')).toBe('Order');
      expect(deriveResourceType('/api/v1/order-sets')).toBe('OrderSet');
    });

    it('미등록 도메인은 경로에서 자동 파생된다(누락 방지)', () => {
      expect(deriveResourceType('/api/v1/nursing-notes')).toBe('NursingNote');
      expect(deriveResourceType(`/api/v1/surgery-opnote/${UUID_A}`)).toBe('SurgeryOpnote');
      expect(deriveResourceType('/api/v1/vitals')).toBe('Vital');
      expect(deriveResourceType('/api/v1/ess/leave')).toBe('Ess'); // 'ss' 는 단수화하지 않음
      expect(deriveResourceType('/api/workgroup/medication')).toBe('Workgroup');
    });

    it('FHIR 리소스명을 사용한다', () => {
      expect(deriveResourceType('/fhir/R4/Observation')).toBe('Observation');
      expect(deriveResourceType(`/fhir/R4/Patient/${UUID_A}`)).toBe('Patient');
    });

    it('toResourceName 단수화 규칙', () => {
      expect(toResourceName('care-teams')).toBe('CareTeam');
      expect(toResourceName('access-control')).toBe('AccessControl');
      expect(toResourceName('ess')).toBe('Ess');
    });
  });

  describe('resourceId 추출', () => {
    it('중첩 경로에서 마지막 UUID(실제 대상)를 채택한다', () => {
      expect(extractResourceId(`/api/v1/patients/${UUID_A}/allergies/${UUID_B}`)).toBe(UUID_B);
    });

    it('경로에 UUID 가 없으면 응답 id 를 쓴다', () => {
      expect(extractResourceId('/api/v1/nursing-notes', UUID_A)).toBe(UUID_A);
    });

    it('비UUID 응답 id 는 저장 불가라 채택하지 않는다(버퍼 poison 방지)', () => {
      expect(extractResourceId('/api/v1/documents', 'ISS-2026-0001')).toBe(ZERO_UUID);
      expect(extractResourceId('/api/v1/config', 12345)).toBe(ZERO_UUID);
    });
  });

  describe('면제·액션', () => {
    it('명시 면제 경로만 제외된다', () => {
      expect(isExempt('/api/v1/notifications/read-all')).toBe(true);
      expect(isExempt(`/api/v1/notifications/${UUID_A}/read`)).toBe(true);
      expect(isExempt('/api/v1/dashboard/config')).toBe(true);
      expect(isExempt('/health')).toBe(true);
      // 임상·보안 경로는 면제 대상이 아니다
      expect(isExempt('/api/v1/nursing-notes')).toBe(false);
      expect(isExempt('/api/v1/access-control/dept-access/내과')).toBe(false);
      expect(isExempt('/api/v1/surgery')).toBe(false);
    });

    it('변이 메서드만 액션이 매핑된다', () => {
      expect(actionForMethod('POST')).toBe('CREATE');
      expect(actionForMethod('PATCH')).toBe('UPDATE');
      expect(actionForMethod('PUT')).toBe('UPDATE');
      expect(actionForMethod('DELETE')).toBe('DELETE');
      expect(actionForMethod('GET')).toBeUndefined();
    });
  });

  describe('환자 지목 조회', () => {
    it('query.patientId 가 UUID 일 때만 열람 대상으로 본다', () => {
      expect(patientIdFromQuery({ patientId: UUID_A })).toBe(UUID_A);
      expect(patientIdFromQuery({ patientId: 'MRN-000123' })).toBeNull();
      expect(patientIdFromQuery({})).toBeNull();
      expect(patientIdFromQuery(undefined)).toBeNull();
    });
  });
});

/**
 * 🔴 청구·EDI 문서 열람 감사(2026-09-01) — `GET /claims/:id/xml` 은 환자 성명·MRN·
 *    보험증번호(복호 후 평문)가 든 파일을 내보내는데 PHI_READ_PATTERNS 에 빠져
 *    **개통 이래 열람 감사 0** 이었다(운영 실측: 다운로드 후 Claim READ 행 없음).
 */
describe('청구·EDI 문서 열람은 감사 대상이다', () => {
  const isPhi = (p: string) => PHI_READ_PATTERNS.some((r) => r.test(p));
  const CID = 'ed93fe3d-4698-41c6-a824-2da4e68a0cc7';

  it('claims 상세·xml·edi 열람이 기록된다', () => {
    expect(isPhi(`/api/v1/claims/${CID}`)).toBe(true);
    expect(isPhi(`/api/v1/claims/${CID}/xml`)).toBe(true);
    expect(isPhi(`/api/v1/claims/${CID}/edi`)).toBe(true);
  });
  it('hira-edi 문서 열람이 기록된다', () => {
    expect(isPhi(`/api/v1/hira-edi/${CID}`)).toBe(true);
  });
  it('목록·집계는 대상이 아니다(billings 목록과 동급 — 대조군)', () => {
    expect(isPhi('/api/v1/claims')).toBe(false);
    expect(isPhi('/api/v1/hira-edi')).toBe(false);
    expect(isPhi('/api/v1/hira-edi/stats')).toBe(false);
  });
});

/**
 * 🔴 판독문·검진 결과서 반출 감사(2026-09-01) — lab/results/:id 는 등재돼 있는데
 *    같은 급인 영상 판독·검진 결과서 PDF 가 빠져 열람 감사 0 이었다.
 */
describe('판독문·검진 결과서 반출은 감사 대상이다', () => {
  const isPhi = (p: string) => PHI_READ_PATTERNS.some((r) => r.test(p));
  const U = 'ed93fe3d-4698-41c6-a824-2da4e68a0cc7';

  it('pacs 판독 상세·환자 지목 판독 목록이 기록된다(비UUID id 포함)', () => {
    expect(isPhi('/api/v1/pacs/reports/RPT-2026-0001')).toBe(true);
    expect(isPhi(`/api/v1/pacs/patients/${U}/reports`)).toBe(true);
    expect(isPhi('/api/v1/pacs/patients/P123/reports')).toBe(true);
  });
  it('imaging 결과 상세·AI 구조화 판독이 기록된다', () => {
    expect(isPhi(`/api/v1/imaging/results/${U}`)).toBe(true);
    expect(isPhi(`/api/v1/imaging/results/${U}/ai-structured-report`)).toBe(true);
  });
  it('검진 결과서 PDF 가 기록된다', () => {
    expect(isPhi(`/api/v1/checkup/visits/${U}/result-pdf`)).toBe(true);
  });
  it('목록·현황은 대상이 아니다(대조군)', () => {
    expect(isPhi('/api/v1/pacs/reports')).toBe(false);
    expect(isPhi('/api/v1/pacs/his/report-status')).toBe(false);
    expect(isPhi(`/api/v1/checkup/visits/${U}`)).toBe(false); // 상세 화면(문서 반출 아님)
    expect(isPhi('/api/v1/imaging/results')).toBe(false);
  });
  it('pacs 는 PacsReport 로 귀속된다(파생 Pac 방지)', () => {
    expect(deriveResourceType('/api/v1/pacs/reports/RPT-1')).toBe('PacsReport');
  });
});
