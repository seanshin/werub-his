import { describe, it, expect, vi } from 'vitest';
import { dobMatches } from '../../src/modules/kiosk/kiosk-verify';
import { KioskService } from '../../src/modules/kiosk/kiosk.service';

/**
 * 키오스크 본인확인 게이트 계약 — `/api/v1/kiosk/*` (무인증·병원 내 물리 단말).
 *
 * 키오스크는 로그인 없이 열리므로 **등록번호(MRN)+생년월일 본인확인**만이 PHI(미납 청구·결제)를
 * 가리는 유일한 문턱이다. dob 가 없거나 틀리면 청구 데이터가 **한 건도** 나가면 안 된다(fail-closed).
 */

describe('dobMatches — 본인확인 순수 규칙', () => {
  it('8자리 전체 일치', () => {
    expect(dobMatches('19900101', '19900101')).toBe(true);
  });
  it('6자리(YYMMDD)는 뒤 6자리로 매칭', () => {
    expect(dobMatches('19900101', '900101')).toBe(true);
  });
  it('불일치는 false', () => {
    expect(dobMatches('19900101', '19900102')).toBe(false);
  });
  it('🔴 빈 입력은 통과시키지 않는다(본인확인 우회 차단)', () => {
    expect(dobMatches('19900101', '')).toBe(false);
    expect(dobMatches('19900101', '   ')).toBe(false);
    expect(dobMatches('19900101', undefined as never)).toBe(false);
  });
});

const PATIENT = {
  id: 'p1', familyName: '홍', givenName: '길동',
  dateOfBirth: new Date('1990-01-01T00:00:00Z'),
};

function makeSvc(patient: unknown = PATIENT) {
  const prisma = {
    patient: { findUnique: vi.fn().mockResolvedValue(patient) },
    billing: { findMany: vi.fn().mockResolvedValue([
      { id: 'b1', createdAt: new Date('2026-08-01T00:00:00Z'), totalAmount: 50000, patientCopay: 30000, discountAmount: 0, paidAmount: 0, status: 'PENDING', encounter: { visitType: 'FIRST', createdAt: new Date() } },
    ]) },
  };
  return new KioskService(prisma as never, {} as never, {} as never);
}

describe('KioskService.getBilling — dob 게이트(fail-closed)', () => {
  it('본인확인 통과 시에만 미납 청구를 반환', async () => {
    const res = await makeSvc().getBilling('HR-1', '19900101');
    expect(res.count).toBe(1);
    expect(res.totalOutstanding).toBe(30000);
    expect(res.patientName).toBe('홍길동'); // 본인 단말이라 실명 노출(마스킹 대상 아님)
  });

  // 🔴 2026-08-19 정정: 이 아래 두 단언은 **오라클을 계약으로 못박고 있었다.**
  //    "미등록 MRN — 존재 여부만으로 PHI 유추 불가"라는 제목을 달고 `toThrow('등록번호')` 를 단언했는데,
  //    그것은 등록번호 부존재를 **다른 문구·다른 상태코드로 답한다**는 뜻이라 정확히 열거 오라클이었다.
  //    (제목이 막겠다고 말한 것을 본문이 고정하고 있었다 — 가드가 결함을 보증한 형태다.)
  //    이제 두 실패는 **구분 불가**여야 한다.

  it('🔴 dob 불일치와 미등록 MRN 이 같은 응답이다 — 구분되면 그것이 열거 오라클이다', async () => {
    const wrongDob = await makeSvc().getBilling('HR-1', '19991231').catch((e) => e);
    const noSuchMrn = await makeSvc(null).getBilling('NOPE', '19900101').catch((e) => e);

    expect(wrongDob.constructor.name).toBe(noSuchMrn.constructor.name); // 같은 예외 타입
    expect(wrongDob.message).toBe(noSuchMrn.message);                   // 같은 문구
    expect(wrongDob.getStatus?.()).toBe(noSuchMrn.getStatus?.());       // 같은 상태코드
  });

  it('🔴 어느 쪽이 틀렸는지 알려주지 않는다', async () => {
    const e = await makeSvc().getBilling('HR-1', '19991231').catch((x) => x);
    expect(e.message).not.toMatch(/^생년월일이 일치하지 않습니다/);
    expect(e.message).not.toMatch(/등록번호를 찾을 수 없습니다/);
  });

  it('🔴 빈 dob — 본인확인 우회 시도 차단', async () => {
    await expect(makeSvc().getBilling('HR-1', '')).rejects.toThrow();
  });
});
