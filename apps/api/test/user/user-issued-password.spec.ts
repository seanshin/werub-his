/**
 * 🔴 (2026-09-14) 관리자 직원 등록·초기화 화면이 공용 기본값(시드 계정과 같은 문자열)을 채웠다 — 공용 번역 청크로 모든 사용자에게 내려갔고
 *    그 값은 정본 정책(12자·대소문자·숫자·특수문자)을 통과하지도 못했다. 이제 비밀번호를 비우면 서버가 일회용 임의 비밀번호를 발급한다.
 * 지키는 것:
 *  ① 생성 — 비밀번호 없으면 정책을 통과하는 값을 발급해 응답에 1회 싣고, 그 값의 해시를 저장 · passwordChangedAt=null(최초 설정 필요)
 *  ② 생성 대조군 — 비밀번호를 주면 발급하지 않고(응답에 issuedPassword 없음) 정책 검사는 그대로
 *  ③ 초기화 — 비우면 발급·passwordChangedAt=null · 주면 발급 없음
 *  ④ 발급기 — 항상 정책 통과·호출마다 다름·난수원이 고정값이면 약한 값을 내지 않고 실패
 */
import { describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { BadRequestException } from '@nestjs/common';
import { UserService } from '../../src/modules/user/user.service';
import { generateCompliantPassword, passwordPolicyViolations } from '../../src/modules/auth/password-policy';

function make() {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'u1', email: data.email })),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const svc = new UserService(prisma as never);
  // resetPassword 가 부르는 존재 확인
  vi.spyOn(svc, 'findById').mockResolvedValue({ id: 'u1' } as never);
  return { svc, prisma };
}
const base = { email: 'new@x.example', familyName: '김', givenName: '직원', role: 'DOCTOR' as never };

describe('직원 계정 일회용 비밀번호 발급', () => {
  it('① 생성 — 비밀번호 없으면 발급·1회 반환·해시 일치·passwordChangedAt null', async () => {
    const { svc, prisma } = make();
    const res = (await svc.create(base as never)) as { issuedPassword?: string };
    expect(typeof res.issuedPassword).toBe('string');
    expect(passwordPolicyViolations(res.issuedPassword!)).toEqual([]);
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.passwordChangedAt).toBeNull();
    expect(await bcrypt.compare(res.issuedPassword!, data.passwordHash)).toBe(true);
  });

  it('② 생성 대조군 — 비밀번호를 주면 발급하지 않고 정책 위반은 400', async () => {
    const { svc } = make();
    const ok = (await svc.create({ ...base, password: 'Abcdefgh12#x' } as never)) as { issuedPassword?: string };
    expect(ok.issuedPassword).toBeUndefined();
    await expect(svc.create({ ...base, password: 'short1!' } as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('③ 초기화 — 비우면 발급·passwordChangedAt null, 주면 발급 없음', async () => {
    const { svc, prisma } = make();
    const r1 = (await svc.resetPassword('u1')) as { issuedPassword?: string };
    expect(passwordPolicyViolations(r1.issuedPassword!)).toEqual([]);
    expect(prisma.user.update.mock.calls[0][0].data.passwordChangedAt).toBeNull();
    const r2 = (await svc.resetPassword('u1', 'Abcdefgh12#x')) as { issuedPassword?: string };
    expect(r2.issuedPassword).toBeUndefined();
    expect(prisma.user.update.mock.calls[1][0].data.passwordChangedAt).toBeNull();
  });

  it('④ 발급기 — 정책 통과·매번 다름·고정 난수원이면 실패', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = generateCompliantPassword(null);
      expect(passwordPolicyViolations(p)).toEqual([]);
      seen.add(p);
    }
    expect(seen.size).toBe(50);
    expect(generateCompliantPassword(20).length).toBeGreaterThanOrEqual(20);
    expect(() => generateCompliantPassword(null, () => 0)).toThrow();
  });
});
