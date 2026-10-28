import { describe, it, expect } from 'vitest';
import { UserRole } from '@prisma/client';
import { Permission, ROLE_PERMISSIONS } from '../../src/modules/auth/rbac/permission.types';

/**
 * 환자관리 권한 매트릭스 계약 — 2026-07-31.
 *
 * 🔴 종전엔 `PATIENT_VIEW` 하나가 목록·상세·**보호자 연락처**·가족관계를 전부 열었고,
 *    9개 역할 전부가 그것을 갖고 있었다(경영진·마케팅·검사기사 포함·프로드 실측 200).
 *    "보는 것"도 층이 다르다 → 기본 인적 / 연락처 / 신원식별정보로 쪼개고 역할별로 정의한다.
 *
 * 이 스펙은 **정의 자체**를 고정한다(라우트 적용은 컨트롤러 데코레이터 + 라이브 프로브로 검증).
 */
const has = (role: UserRole, p: Permission) => ROLE_PERMISSIONS[role].has(p);

/**
 * 환자 접점이 없는 지원역할 — 업무상 환자를 식별할 일이 없다.
 * 🔴 ADMIN_STAFF(총무·시설·자재)는 v3.96 신설. 배선 실측상 재고·장비·교육·ESS·HR 만 쓰고
 *    그 5개 모듈은 PATIENT_VIEW 를 한 번도 요구하지 않는다(요구처는 전부 임상·원무·검진).
 *    종전 "모든 역할" 단언은 전 역할이 임상·원무이던 시절(2026-07-31)의 전제였다.
 */
const NON_PATIENT_FACING_ROLES: UserRole[] = [UserRole.ADMIN_STAFF];

describe('기본 인적 열람은 환자 접점이 있는 전 역할', () => {
  it('환자를 업무상 식별하는 역할은 목록·기본 인적을 본다', () => {
    const patientFacing = Object.values(UserRole).filter((r) => !NON_PATIENT_FACING_ROLES.includes(r as UserRole));
    for (const role of patientFacing) {
      expect(has(role as UserRole, Permission.PATIENT_VIEW)).toBe(true);
    }
  });

  it('🔴 환자 접점 없는 지원역할은 기본 인적도 보지 않는다(최소권한)', () => {
    for (const role of NON_PATIENT_FACING_ROLES) {
      expect(has(role, Permission.PATIENT_VIEW)).toBe(false);
    }
  });
});

describe('🔴 연락처·보호자는 진료·간호·관리자만', () => {
  it('의사·간호사·관리자만 접촉 정보를 본다', () => {
    for (const role of [UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN]) {
      expect(has(role, Permission.PATIENT_VIEW_CONTACT)).toBe(true);
    }
  });

  it('약사·검사기사·마케팅·경영진·READ 는 접촉 정보를 보지 못한다', () => {
    for (const role of [UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.CRM_MANAGER, UserRole.CRM_STAFF, UserRole.EXECUTIVE, UserRole.READ]) {
      expect(has(role, Permission.PATIENT_VIEW_CONTACT)).toBe(false);
    }
  });
});

describe('🔴 신원식별정보(주민번호)는 원무·관리자만', () => {
  it('원무(신원 확인·보험 자격이 업무)와 관리자만 보유 — 임상 역할도 못 본다', () => {
    const allowed: UserRole[] = [UserRole.ADMIN, UserRole.RECEPTIONIST];
    for (const role of Object.values(UserRole)) {
      expect(has(role as UserRole, Permission.PATIENT_VIEW_IDENTITY)).toBe(allowed.includes(role as UserRole));
    }
  });

  it('의사·간호사도 주민번호는 보지 못한다(진료에 불필요)', () => {
    expect(has(UserRole.DOCTOR, Permission.PATIENT_VIEW_IDENTITY)).toBe(false);
    expect(has(UserRole.NURSE, Permission.PATIENT_VIEW_IDENTITY)).toBe(false);
  });
});

describe('쓰기 권한은 업무 주체에 맞춘다', () => {
  it('인적정보 수정은 간호(원무)·관리자 — 의사는 임상만', () => {
    expect(has(UserRole.NURSE, Permission.PATIENT_EDIT)).toBe(true);
    expect(has(UserRole.ADMIN, Permission.PATIENT_EDIT)).toBe(true);
    expect(has(UserRole.DOCTOR, Permission.PATIENT_EDIT)).toBe(false); // 라우트도 원래 의사 불가였다(정의를 실제에 맞춤)
  });

  it('사망 처리는 의학적 판단 — 의사·관리자', () => {
    expect(has(UserRole.DOCTOR, Permission.PATIENT_DECEASED)).toBe(true);
    expect(has(UserRole.ADMIN, Permission.PATIENT_DECEASED)).toBe(true);
    expect(has(UserRole.NURSE, Permission.PATIENT_DECEASED)).toBe(false);
  });

  it('보호자·가족관계 등록은 간호(원무)·관리자', () => {
    expect(has(UserRole.NURSE, Permission.PATIENT_RELATION_EDIT)).toBe(true);
    expect(has(UserRole.DOCTOR, Permission.PATIENT_RELATION_EDIT)).toBe(false);
  });
});

describe('🔴 되돌리기 어렵거나 대량인 조작은 관리자만', () => {
  it('삭제·병합·대량 반출은 관리자 전용', () => {
    for (const p of [Permission.PATIENT_DELETE, Permission.PATIENT_MERGE, Permission.PATIENT_EXPORT]) {
      for (const role of Object.values(UserRole)) {
        expect(has(role as UserRole, p)).toBe(role === UserRole.ADMIN);
      }
    }
  });

  it('대량 등록은 간호(원무)·관리자 — 현장 접수 실무를 막지 않는다', () => {
    expect(has(UserRole.NURSE, Permission.PATIENT_IMPORT)).toBe(true);
    expect(has(UserRole.ADMIN, Permission.PATIENT_IMPORT)).toBe(true);
    expect(has(UserRole.DOCTOR, Permission.PATIENT_IMPORT)).toBe(false);
  });
});

describe('읽기 전용 역할은 어떤 쓰기 권한도 갖지 않는다', () => {
  const writes = [
    Permission.PATIENT_CREATE, Permission.PATIENT_EDIT, Permission.PATIENT_DELETE,
    Permission.PATIENT_MERGE, Permission.PATIENT_IMPORT, Permission.PATIENT_EXPORT,
    Permission.PATIENT_RELATION_EDIT, Permission.PATIENT_DECEASED,
  ];
  it('EXECUTIVE·READ·CRM 은 쓰기 0', () => {
    for (const role of [UserRole.EXECUTIVE, UserRole.READ, UserRole.CRM_MANAGER, UserRole.CRM_STAFF]) {
      for (const p of writes) expect(has(role, p)).toBe(false);
    }
  });
});

describe('원무(RECEPTIONIST) — 신설 역할', () => {
  it('인적정보·보험·수납 실무 권한을 갖는다', () => {
    for (const p of [Permission.PATIENT_VIEW, Permission.PATIENT_VIEW_CONTACT, Permission.PATIENT_VIEW_IDENTITY,
                     Permission.PATIENT_CREATE, Permission.PATIENT_EDIT, Permission.PATIENT_RELATION_EDIT,
                     Permission.BILLING_VIEW, Permission.BILLING_CREATE]) {
      expect(has(UserRole.RECEPTIONIST, p)).toBe(true);
    }
  });

  it('🔴 임상 권한은 갖지 않는다 — 접수 담당이 처방·기록을 쓸 이유가 없다', () => {
    for (const p of [Permission.PRESCRIPTION_CREATE, Permission.ENCOUNTER_CREATE, Permission.ENCOUNTER_EDIT,
                     Permission.ORDER_CREATE, Permission.PATIENT_DECEASED]) {
      expect(has(UserRole.RECEPTIONIST, p)).toBe(false);
    }
  });

  it('🔴 관리자 전용 조작(삭제·병합·반출)도 갖지 않는다', () => {
    for (const p of [Permission.PATIENT_DELETE, Permission.PATIENT_MERGE, Permission.PATIENT_EXPORT]) {
      expect(has(UserRole.RECEPTIONIST, p)).toBe(false);
    }
  });

  it('진료 열람은 되지만 작성은 안 된다(수납 확인 목적)', () => {
    expect(has(UserRole.RECEPTIONIST, Permission.ENCOUNTER_VIEW)).toBe(true);
    expect(has(UserRole.RECEPTIONIST, Permission.ENCOUNTER_CREATE)).toBe(false);
  });
});
