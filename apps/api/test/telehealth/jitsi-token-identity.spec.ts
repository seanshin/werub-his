import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { NotFoundException } from '@nestjs/common';
import { TelehealthService } from '../../src/modules/telehealth/telehealth.service';
import { signJitsiToken, readJitsiEnv } from '../../src/common/jitsi/jitsi-token';

/**
 * 원격진료 Jitsi 토큰의 **표시명** — 외부 점검(HIS → Jitsi).
 *
 * 무엇이 틀려 있었나: `getJitsiToken` 이 담당의가 **아닌** 직원에게도 토큰을 내주면서
 * 표시명을 **환자 이름**으로 채웠다. 그 직원이 방에 들어가면 이름표가 환자 이름으로 뜬다 —
 * 회의방이 "누가 그 자리에 있는가"를 거짓으로 말하고, 담당의·환자에게는 환자가 둘로 보인다.
 * (EP 자체를 닫는 것은 답이 아니다 — 간호사·약사가 같은 방에 들어가야 하는 협업 자리다. §5)
 *
 * 🔴 재주입하면 반드시 실패한다(2026-09-22 main 위에서 실제로 되돌려 확인):
 *   - `userName` 을 환자 이름 폴백으로 되돌리면 → '담당의가 아닌 직원은 자기 이름으로 들어간다' 실패
 *   - 비담당의에게 moderator 를 주면 → 같은 케이스의 moderator 단언 실패
 *   - 사용자 행이 없을 때 환자 이름으로 떨어지면 → '모르면 남의 이름을 쓰지 않는다' 실패
 */
describe('원격진료 Jitsi 토큰 신원 (§2)', () => {
  let service: TelehealthService;
  let prisma: any;

  const session = {
    id: 's-1',
    roomId: 'th-room-1',
    doctorId: 'doc-1',
    patientId: 'pat-1',
    doctor: { id: 'doc-1', familyName: '김', givenName: '의사', email: 'doc@h.example' },
    // 🔴 재주입 대비 — 정본이 patient 를 더 이상 include 하지 않지만, 폴백 코드가 되살아나면 이 이름이 새어 나간다
    patient: { id: 'pat-1', familyName: '이', givenName: '환자' },
  };

  beforeEach(() => {
    prisma = {
      telehealthSession: { findUnique: vi.fn().mockResolvedValue(session) },
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'nur-9', familyName: '박', givenName: '간호', email: 'nur@h.example' }),
      },
    };
    const config = { get: (k: string) => ({ JITSI_JWT_SECRET: 'sekret', JITSI_JWT_APP_ID: 'hospitalrun', JITSI_JWT_DOMAIN: 'meet.jitsi' } as any)[k] };
    service = new TelehealthService(prisma as any, config as any, {} as any);
  });

  const decode = (t: string) => jwt.verify(t, 'sekret') as any;

  it('담당의가 아닌 직원은 **자기 이름**으로 토큰을 받는다 — 환자 이름이 아니다', async () => {
    const token = await service.getJitsiToken('s-1', 'nur-9');
    const p = decode(token);
    expect(p.context.user.name).toBe('박간호');
    expect(p.context.user.email).toBe('nur@h.example');
    expect(p.moderator).toBe(false); // 모더레이터는 담당의만
    expect(JSON.stringify(p)).not.toContain('환자'); // 환자 이름이 어디에도 실리지 않는다
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'nur-9' } }));
  });

  it('🔴 모르면 남의 이름을 쓰지 않는다 — 사용자 행이 없으면 404(환자 이름으로 떨어지지 않는다)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getJitsiToken('s-1', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  // 대조군 — 담당의 경로는 종전 그대로(고치면서 멀쩡한 것을 깨지 않았다)
  it('[대조군] 담당의는 자기 이름·모더레이터로 받는다 — 사용자 재조회 없이', async () => {
    const token = await service.getJitsiToken('s-1', 'doc-1');
    const p = decode(token);
    expect(p.context.user.name).toBe('김의사');
    expect(p.context.user.email).toBe('doc@h.example');
    expect(p.moderator).toBe(true);
    expect(p.room).toBe('th-room-1');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  // 대조군 — 환자용 토큰은 환자 이름 그대로(그 자리에 있는 사람이 환자이므로 사실이다)
  it('[대조군] 환자용 토큰은 환자 이름·게스트다', async () => {
    const token = await service.getPatientJitsiToken('s-1');
    const p = decode(token);
    expect(p.context.user.name).toBe('이환자 (환자)');
    expect(p.moderator).toBe(false);
  });
});

/**
 * 서명 정본이 하나인지 — P12(같은 사실에 정본이 셋이었다: telehealth·consult·remote-consultation).
 * 🔴 재주입: 세 모듈 중 하나에 `jwt.sign(` 을 되살리면 이 테스트가 실패한다.
 */
describe('Jitsi 서명 정본 (P12)', () => {
  it('telehealth·consult·remote-consultation 어디에도 자체 jwt.sign 이 없다', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const root = join(__dirname, '../../src/modules');
    for (const f of [
      'telehealth/telehealth.service.ts',
      'consult/consult.service.ts',
      'remote-consultation/remote-consultation.service.ts',
    ]) {
      const src = readFileSync(join(root, f), 'utf8');
      expect(src, `${f} 에 자체 jwt.sign 이 남아 있다`).not.toMatch(/\bjwt\.sign\(/);
      expect(src, `${f} 가 jsonwebtoken 을 직접 import 한다`).not.toMatch(/from 'jsonwebtoken'/);
      expect(src, `${f} 가 서명 정본을 쓰지 않는다`).toContain('signJitsiToken');
    }
  });

  it('[대조군] 정본은 정상 payload 를 만든다(막기만 하는 가드가 아니다)', () => {
    // 🔴 정본 시그니처는 `readJitsiEnv({ get })` — ConfigService 모양(`.env.example` 대조 스캐너가 `cfg.get('KEY')` 를 찾는다)
    const env = readJitsiEnv({ get: (k) => ({ JITSI_JWT_SECRET: 's' } as Record<string, string | undefined>)[k] });
    expect(env).not.toBeNull();
    const t = signJitsiToken(env!, { roomName: 'r', userName: '홍길동', userId: 'u', isModerator: true });
    const p = jwt.verify(t, 's') as any;
    expect(p).toMatchObject({ room: 'r', moderator: true, aud: 'hospitalrun', iss: 'hospitalrun', sub: 'meet.jitsi' });
    expect(p.context.user).toMatchObject({ id: 'u', name: '홍길동', email: '', avatar: '', affiliation: 'owner' });
  });

  it('JITSI_JWT_SECRET 이 없으면 null — 비밀 없이 서명하지 않는다', () => {
    expect(readJitsiEnv({ get: () => undefined })).toBeNull();
  });
});
