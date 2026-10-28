import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { SmartAuthService } from '../../src/modules/smart-auth/smart-auth.service';
import { fakeRedis } from './fake-redis';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * authorization_code 교환의 스코프 교차 — 2026-09-21.
 *
 * 🔴 종전에는 **요청 ∩ 등록 이 비면 등록 스코프 전부**를 부여했다. 요청보다 넓게 주는 분기다.
 *    같은 판정을 하는 client_credentials 경로는 반대로 401 'No valid scopes' 로 좁게 실패한다 —
 *    같은 사실에 규칙이 둘이었고 그중 하나가 여는 쪽으로 틀려 있었다(외부 코드 대조 2026-09-11).
 *    표기가 어긋나기 쉬운 자리라(관리 화면 선택지가 비표준 표기이고 system/* 선택지가 없다)
 *    "교집합 없음"은 드문 사고가 아니라 흔한 상태였다.
 */
describe('exchangeAuthorizationCode — 스코프 교차', () => {
  let service: SmartAuthService;
  let mockPrisma: any;

  const client = {
    id: 'client-uuid',
    clientId: 'twin',
    scopes: ['system/Procedure.read', 'system/Condition.read'],
    isActive: true,
  };

  let redis: ReturnType<typeof fakeRedis>;

  async function putCode(scope: string | undefined) {
    await redis.set('smart:authcode:code-1', JSON.stringify({
      clientId: 'twin', redirectUri: 'https://twin/cb', scope,
      expiresAt: Date.now() + 60_000, patient: 'pat-A',
    }), 'EX', 300);
  }

  beforeEach(() => {
    mockPrisma = { smartClient: { findUnique: vi.fn().mockResolvedValue(client), update: vi.fn() } };
    redis = fakeRedis();
    service = new SmartAuthService(mockPrisma, { sign: vi.fn().mockReturnValue('jwt'), verify: vi.fn() } as never, {} as never, redis as never);
  });

  it('요청 ∩ 등록 만 부여한다', async () => {
    await putCode('system/Procedure.read system/Observation.read');
    const res = await service.exchangeAuthorizationCode('code-1', 'twin', 'https://twin/cb');
    expect(res.scope).toBe('system/Procedure.read');
  });

  it('🔴 교집합이 비면 401 — 등록 스코프 전부를 대신 주지 않는다', async () => {
    await putCode('system/MedicationRequest.read');
    await expect(service.exchangeAuthorizationCode('code-1', 'twin', 'https://twin/cb'))
      .rejects.toMatchObject({ response: { error: 'invalid_scope' } });
  });

  it('오류가 무엇이 어긋났는지 말한다(등록 스코프를 고칠 근거)', async () => {
    await putCode('system/MedicationRequest.read');
    await service.exchangeAuthorizationCode('code-1', 'twin', 'https://twin/cb').catch((e) => {
      expect(e.response.details.requested).toEqual(['system/MedicationRequest.read']);
      expect(e.response.details.registered).toEqual(client.scopes);
    });
  });

  it('요청 스코프를 생략하면 등록 스코프가 그대로 쓰인다(대조군 — 정상 경로는 막지 않는다)', async () => {
    await putCode(undefined);
    const res = await service.exchangeAuthorizationCode('code-1', 'twin', 'https://twin/cb');
    expect(res.scope).toBe('system/Procedure.read system/Condition.read');
  });
});


/**
 * 인가 코드·launch 문맥의 저장 위치 계약 — 2026-09-21.
 *
 * 🔴 프로세스 메모리 Map 이면 API 가 여러 프로세스로 뜰 때 launch 를 발급한 프로세스와
 *    authorize 를 처리하는 프로세스가 달라 조용히 실패한다. 현재 운영(pm2 fork 1 프로세스)에서는
 *    드러나지 않아 **테스트도 화면도 초록이면서 컨테이너 설치에서만 깨진다** — 그래서 구조로 고정한다.
 */
describe('저장 위치 — Redis 하나가 정본', () => {
  const src = readFileSync(join(__dirname, '../../src/modules/smart-auth/smart-auth.service.ts'), 'utf-8');
  const ctrl = readFileSync(join(__dirname, '../../src/modules/smart-auth/smart-auth.controller.ts'), 'utf-8');

  it('서비스에 인가 코드·launch 문맥용 Map 이 없다(메모리 폴백 금지)', () => {
    expect(src).not.toMatch(/authCodes\s*=\s*new Map/);
    expect(src).not.toMatch(/launchContexts\s*=\s*new Map/);
    expect(src).toContain("`smart:authcode:${code}`");
    expect(src).toContain("`smart:launch:${launch}`");
  });

  it('코드 교환은 원자적 1회용(getdel) — get→검증→delete 의 동시 교환 창을 남기지 않는다', () => {
    expect(src).toContain('await this.redis.getdel(this.codeKey(code))');
  });

  it('🔴 컨트롤러가 hasLaunchContext 를 await 한다 — `!Promise` 는 항상 false 라 무인증 분기가 죽는다', () => {
    expect(ctrl).toContain('!(await this.smartAuthService.hasLaunchContext(launch))');
  });
});
