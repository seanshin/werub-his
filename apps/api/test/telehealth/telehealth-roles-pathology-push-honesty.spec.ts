/**
 * 🔴 (2026-09-15 M2) 권한·기록 흉내 묶음.
 * ① 원격진료 컨트롤러: 클래스 RolesGuard 는 @Roles 없는 핸들러를 **모든 인증 직원**(READ·CRM·원무 포함)에게 열었다.
 *    직원 JWT 평가 EP(`PATCH sessions/:id/rate`)는 아무 직원이나 환자 만족도를 써넣게 했다 — 평가는 환자 본인의 진술이고
 *    포털 본인 경로가 따로 있어 **제거**했다. 나머지는 원격진료 메뉴 역할(ADMIN·DOCTOR·NURSE)·세션 방 역할(+PHARMACIST).
 * ② 병리 보고서 이미지 등록: 저장 모델이 없는데 "이미지 메타데이터 저장 완료"를 돌려줬다(P16).
 * ③ 환자 FCM 토큰 갱신·기기 원격 로그아웃: updateMany 0건이어도 success:true.
 */
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { TelehealthController } from '../../src/modules/telehealth/telehealth.controller';
import { PathologyService } from '../../src/modules/pathology/pathology.service';
import { PatientAuthService } from '../../src/modules/patient-auth/patient-auth.service';

const proto = TelehealthController.prototype as unknown as Record<string, unknown>;
const handlers = Object.getOwnPropertyNames(proto).filter((k) => k !== 'constructor' && typeof proto[k] === 'function'
  && Reflect.getMetadata(METHOD_METADATA, proto[k] as object) !== undefined);
const roles = (h: string) => new Reflector().get<string[]>(ROLES_KEY, proto[h] as never);

describe('① 원격진료 컨트롤러 — 역할 없는 핸들러 0', () => {
  it('HTTP 핸들러를 실제로 찾았다(대조군 — 0개면 아래 검사는 증거가 아니다)', () => {
    expect(handlers.length).toBeGreaterThan(15);
  });
  it('모든 HTTP 핸들러에 @Roles 가 있다', () => {
    expect(handlers.filter((h) => !(roles(h)?.length))).toEqual([]);
  });
  it('🔴 직원 JWT 환자 평가 EP 는 없다(평가는 포털 본인 경로만)', () => {
    expect(handlers).not.toContain('rateSession');
  });
  it.each(['getSession', 'getJitsiToken', 'getPharmacyReview', 'getSessionPrescriptions'])('%s — 세션 방 역할(약사 포함)', (h) => {
    expect([...(roles(h) ?? [])].sort()).toEqual(['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST']);
  });
  it.each(['getSessions', 'getStats', 'getPatientSessions', 'createDemoSession', 'getPatientJitsiToken', 'classifyPatientMessage'])('%s — 원격진료 메뉴 역할', (h) => {
    expect([...(roles(h) ?? [])].sort()).toEqual(['ADMIN', 'DOCTOR', 'NURSE']);
  });
  it('AI 답변 초안은 답변 권한과 같다(DOCTOR·ADMIN) · 대조군 submitDoctorReply', () => {
    expect([...(roles('suggestReply') ?? [])].sort()).toEqual(['ADMIN', 'DOCTOR']);
    expect([...(roles('submitDoctorReply') ?? [])].sort()).toEqual(['ADMIN', 'DOCTOR']);
  });
});

describe('② 병리 보고서 이미지 — 저장하지 않았으면 저장했다고 말하지 않는다', () => {
  const mk = (report: unknown) => new PathologyService({ pathologyReport: { findUnique: vi.fn().mockResolvedValue(report) } } as never);
  it('recorded:false · NOT_PERSISTED · 받은 값을 되돌려주지 않는다', async () => {
    const r = await mk({ id: 'r1' }).addReportImage('r1', { filename: 'a.png', description: 'H&E', magnification: '40x' }) as Record<string, unknown>;
    expect(r).toMatchObject({ recorded: false, reason: 'NOT_PERSISTED', recordedAt: null });
    expect(JSON.stringify(r)).not.toContain('저장 완료');
    expect(r).not.toHaveProperty('image');
  });
  it('대조군 — 보고서가 없으면 404', async () => {
    await expect(mk(null).addReportImage('x', { filename: 'a', description: 'b' })).rejects.toThrow(/not found/i);
  });
});

describe('③ 환자 기기 — 0건 갱신을 성공이라 말하지 않는다', () => {
  const mk = (count: number) => {
    const svc = Object.create(PatientAuthService.prototype) as PatientAuthService;
    (svc as unknown as { prisma: unknown }).prisma = { patientDevice: { updateMany: vi.fn().mockResolvedValue({ count }) } };
    return svc;
  };
  it('🔴 FCM 토큰 갱신 0건 → success:false · updated:0 · DEVICE_NOT_REGISTERED', async () => {
    expect(await mk(0).updateFcmToken('a', 'd', 't')).toEqual({ success: false, updated: 0, reason: 'DEVICE_NOT_REGISTERED' });
  });
  it('대조군 — 1건 갱신은 success:true · updated:1', async () => {
    expect(await mk(1).updateFcmToken('a', 'd', 't')).toEqual({ success: true, updated: 1 });
  });
  it('🔴 원격 로그아웃 0건 → success:false · 대조군 1건 → success:true', async () => {
    expect(await mk(0).removeDevice('a', 'x')).toMatchObject({ success: false, updated: 0 });
    expect(await mk(1).removeDevice('a', 'x')).toMatchObject({ success: true, updated: 1 });
  });
});
