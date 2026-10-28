import { describe, it, expect } from 'vitest';
import {
  orderEntryMode, orderEntryModes, resolveProfession, ORDER_ENTRY_TYPES, CLINICAL_PROFESSIONS,
  DEFAULT_ORDER_ENTRY_SCOPE, SELF_ELIGIBLE, PROFESSION_ROLE,
} from './order-entry-scope';

describe('오더 입력 범위 — 직종별 본인 권한/의사 승인/불가', () => {
  it('의사·관리자는 전 유형 본인 권한(종전 동작)', () => {
    for (const t of ORDER_ENTRY_TYPES) {
      expect(orderEntryMode('DOCTOR', null, t)).toBe('SELF');
      expect(orderEntryMode('ADMIN', null, t)).toBe('SELF');
    }
  });

  it('간호사: 간호 오더는 본인 권한 · 약·검사 등은 의사 승인(구두처방 대리입력)', () => {
    expect(orderEntryMode('NURSE', null, 'NURSING')).toBe('SELF');
    for (const t of ['MEDICATION', 'LAB', 'IMAGING', 'THERAPY', 'DIET', 'ACTIVITY']) expect(orderEntryMode('NURSE', null, t)).toBe('DELEGATE');
  });

  it('물리치료사(LAB_TECH+직종): 치료 오더만 의사 승인 · 약은 불가', () => {
    expect(orderEntryMode('LAB_TECH', 'PHYSICAL_THERAPIST', 'THERAPY')).toBe('DELEGATE');
    expect(orderEntryMode('LAB_TECH', 'PHYSICAL_THERAPIST', 'MEDICATION')).toBe('NONE');
    expect(orderEntryMode('LAB_TECH', 'PHYSICAL_THERAPIST', 'LAB')).toBe('NONE');
  });

  it('직종 미지정 LAB_TECH 는 임상병리사로 본다(종전 워크인 검사 흐름 유지)', () => {
    expect(resolveProfession('LAB_TECH', null)).toEqual({ profession: 'CLINICAL_LAB_TECHNOLOGIST', source: 'ROLE_DEFAULT' });
    expect(orderEntryMode('LAB_TECH', null, 'LAB')).toBe('DELEGATE');
    expect(orderEntryMode('LAB_TECH', null, 'THERAPY')).toBe('NONE');
  });

  it('🔴 역할과 맞지 않는 직종은 무시한다 — LAB_TECH 에 "의사"를 적어 권한을 올릴 수 없다', () => {
    expect(resolveProfession('LAB_TECH', 'DOCTOR').source).toBe('MISMATCH_IGNORED');
    expect(orderEntryMode('LAB_TECH', 'DOCTOR', 'MEDICATION')).toBe('NONE');
    expect(orderEntryMode('NURSE', 'DOCTOR', 'MEDICATION')).toBe('DELEGATE');
  });

  it('🔴 원내 설정으로도 비의사의 약·검사를 본인 권한으로 올릴 수 없다(상한)', () => {
    const o = { NURSE: { MEDICATION: 'SELF', NURSING: 'DELEGATE' }, PHYSICAL_THERAPIST: { THERAPY: 'SELF' } };
    expect(orderEntryMode('NURSE', null, 'MEDICATION', o)).toBe('DELEGATE');
    expect(orderEntryMode('LAB_TECH', 'PHYSICAL_THERAPIST', 'THERAPY', o)).toBe('DELEGATE');
    // 낮추기는 된다
    expect(orderEntryMode('NURSE', null, 'NURSING', o)).toBe('DELEGATE');
  });

  it('모르는 역할·유형은 입력 불가(모르면 안전측)', () => {
    expect(orderEntryMode('READ', null, 'LAB')).toBe('NONE');
    expect(orderEntryMode('CRM_STAFF', null, 'NURSING')).toBe('NONE');
    expect(orderEntryMode('NURSE', null, 'SURGERY')).toBe('NONE');
    expect(orderEntryMode('PHARMACIST', null, 'MEDICATION')).toBe('NONE');
  });

  it('구조 — 기본 범위의 SELF 는 전부 상한 안이다 · 모든 직종이 역할을 갖는다', () => {
    for (const p of CLINICAL_PROFESSIONS) {
      expect(PROFESSION_ROLE[p]).toBeTruthy();
      for (const [t, m] of Object.entries(DEFAULT_ORDER_ENTRY_SCOPE[p])) if (m === 'SELF') expect(SELF_ELIGIBLE[p]).toContain(t);
    }
    expect(Object.keys(orderEntryModes('NURSE', null))).toEqual([...ORDER_ENTRY_TYPES]);
  });
});

describe('치료 시행 직종', () => {
  it('물리치료사는 재활·치료 시행 · 임상병리사·직종 미지정 LAB_TECH 는 불가 · 의사·간호사는 종전대로', async () => {
    const { canExecuteTherapy, REHAB_EXECUTOR_PROFESSIONS, THERAPY_EXECUTOR_PROFESSIONS } = await import('./order-entry-scope');
    expect(canExecuteTherapy('LAB_TECH', 'PHYSICAL_THERAPIST', REHAB_EXECUTOR_PROFESSIONS)).toBe(true);
    expect(canExecuteTherapy('LAB_TECH', 'CLINICAL_LAB_TECHNOLOGIST', REHAB_EXECUTOR_PROFESSIONS)).toBe(false);
    expect(canExecuteTherapy('LAB_TECH', null, THERAPY_EXECUTOR_PROFESSIONS)).toBe(false);
    expect(canExecuteTherapy('LAB_TECH', 'RADIOLOGIC_TECHNOLOGIST', REHAB_EXECUTOR_PROFESSIONS)).toBe(false);
    expect(canExecuteTherapy('LAB_TECH', 'RADIOLOGIC_TECHNOLOGIST', THERAPY_EXECUTOR_PROFESSIONS)).toBe(true);
    expect(canExecuteTherapy('NURSE', null, REHAB_EXECUTOR_PROFESSIONS)).toBe(true);
    expect(canExecuteTherapy('PHARMACIST', null, THERAPY_EXECUTOR_PROFESSIONS)).toBe(false);
  });
});

describe('오더 시행·결과 기록 범위', () => {
  it('간호사는 간호·투약 완료 · 검사·영상 완료는 불가(결과 없이 완료 금지) · 치료사는 치료만', async () => {
    const { canExecuteOrder, parseOrderResult } = await import('./order-entry-scope');
    expect(canExecuteOrder('NURSE', null, 'NURSING')).toBe(true);
    expect(canExecuteOrder('NURSE', null, 'LAB')).toBe(false);
    expect(canExecuteOrder('NURSE', null, 'IMAGING')).toBe(false);
    expect(canExecuteOrder('LAB_TECH', null, 'IMAGING')).toBe(true); // 종전 방사선사 흐름(직종 미지정)
    expect(canExecuteOrder('LAB_TECH', null, 'THERAPY')).toBe(false);
    expect(canExecuteOrder('LAB_TECH', 'PHYSICAL_THERAPIST', 'THERAPY')).toBe(true);
    expect(canExecuteOrder('LAB_TECH', 'PHYSICAL_THERAPIST', 'MEDICATION')).toBe(false);
    expect(canExecuteOrder('PHARMACIST', null, 'MEDICATION')).toBe(true);
    expect(canExecuteOrder('RECEPTIONIST', null, 'NURSING')).toBe(false);
    expect(parseOrderResult('legacy string')).toEqual({ entries: [], attachments: [] });
  });
});
