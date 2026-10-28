import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { SmartAuthService } from '../../src/modules/smart-auth/smart-auth.service';

/**
 * SMART 환자 스코프 격리 계약 — 2026-07-30(cerno 연동으로 FHIR read 6EP 개방 시 봉합).
 *
 * 배경: 단건(:id) 조회에는 subject 파라미터가 없어 가드가 막을 수 없었고, 검색은 subject 를
 * 생략하면 핸들러가 전 환자를 반환했다. 두 경로 모두 fail-closed 로 고정한다.
 */
function svc(): SmartAuthService {
  // 스코프 판정만 쓰므로 의존성은 최소 목
  return new SmartAuthService({ get: vi.fn() } as never, { safeLog: vi.fn() } as never, { patient: { findUnique: vi.fn() } } as never, {} as never);
}

const patientToken = (patient?: string) => ({ client_id: 'cerno', scope: 'patient/MedicationRequest.read', patient, token_type: 'smart' }) as never;
const systemToken = { client_id: 'lis', scope: 'system/MedicationRequest.read', token_type: 'smart' } as never;

describe('assertPatientAccess — 단건 소유 검증', () => {
  it('내부 직원 경로(smartClient 없음)는 통과 — 기존 동작 불변', () => {
    expect(() => svc().assertPatientAccess(undefined, 'MedicationRequest', 'p-1')).not.toThrow();
  });

  it('토큰 환자와 리소스 소유자가 같으면 통과', () => {
    expect(() => svc().assertPatientAccess(patientToken('p-1'), 'MedicationRequest', 'p-1')).not.toThrow();
  });

  it('🔴 다른 환자 리소스는 차단(ID 만으로 타 환자 열람 불가)', () => {
    expect(() => svc().assertPatientAccess(patientToken('p-1'), 'MedicationRequest', 'p-2')).toThrow(ForbiddenException);
  });

  it('소유자 정보가 없으면 차단(불명 = 허용 아님·fail-closed)', () => {
    expect(() => svc().assertPatientAccess(patientToken('p-1'), 'MedicationRequest', null)).toThrow(ForbiddenException);
    expect(() => svc().assertPatientAccess(patientToken('p-1'), 'MedicationRequest', undefined)).toThrow(ForbiddenException);
  });

  it('환자 컨텍스트 없는 patient/* 토큰은 차단(client_credentials 전체열람 방지)', () => {
    expect(() => svc().assertPatientAccess(patientToken(undefined), 'MedicationRequest', 'p-1')).toThrow(ForbiddenException);
  });

  it('system/* 스코프는 인구단위 판독 허용(LIS·트윈)', () => {
    expect(() => svc().assertPatientAccess(systemToken, 'MedicationRequest', 'p-2')).not.toThrow();
  });
});
