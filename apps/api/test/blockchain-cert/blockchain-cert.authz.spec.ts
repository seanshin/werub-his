/**
 * 전자인증서 컨트롤러 인가 가드 스펙 (🔴 W7 2026-08)
 *
 * 배경: 발급은 본문(userId·subjectDn·licenseNumber·identityVerified)을 그대로 믿었고,
 *       renew·pin-fail·pin-success·상세조회는 **소유 검증이 없어** certId 만 알면
 *       타인 인증서를 재발급(명의 서명 위조)·정지·잠금해제·열람할 수 있었다.
 *       특히 pin-* 는 자체발급 게이트(blockchain.selfIssuanceEnabled)를 타지 않아
 *       인증서가 하나라도 생기면 즉시 노출되는 잠복 결함이었다.
 *
 * 이 스펙은 (1) 모든 핸들러의 @Roles 존재를 기계로 확인하고,
 *          (2) 객체수준 인가가 필요한 핸들러가 소유 검증을 **실제로 호출**하는지 확인한다.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PATH_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { BlockchainCertController } from '../../src/modules/blockchain-cert/blockchain-cert.controller';

type AnyProto = Record<string, (...args: unknown[]) => unknown>;

/**
 * 의도적으로 역할 제한을 두지 않는 핸들러 — 이유를 여기 적는다(비워두는 것이 아니라 결정으로 남긴다).
 * - capability : 자체발급 UI 노출 여부만 반환(민감정보 없음)
 * - getCrl     : 폐기목록(serial·fingerprint) — PKI 에서 CRL 공개는 표준. 인증 사용자 전체 허용
 * - verifyByFingerprint : 서명 검증 경로. 지문을 이미 가진 쪽만 조회 가능
 */
const OPEN_BY_DESIGN = new Set(['capability', 'getCrl', 'verifyByFingerprint']);

/** 객체수준 인가(소유 검증)가 반드시 필요한 핸들러 */
const OWNERSHIP_REQUIRED = ['getCertById', 'renew', 'recordPinFail', 'recordPinSuccess'];

function routeHandlers(ctor: new (...args: never[]) => unknown): string[] {
  const proto = ctor.prototype as AnyProto;
  return Object.getOwnPropertyNames(proto).filter(
    (k) => k !== 'constructor' && typeof proto[k] === 'function' && Reflect.hasMetadata(PATH_METADATA, proto[k]),
  );
}

function rolesOf(handler: string): UserRole[] | undefined {
  const proto = BlockchainCertController.prototype as unknown as AnyProto;
  return Reflect.getMetadata(ROLES_KEY, proto[handler]) as UserRole[] | undefined;
}

describe('BlockchainCertController 인가 가드', () => {
  it('클래스에 JwtAuthGuard + RolesGuard 가 걸려 있다', () => {
    const guards = ((Reflect.getMetadata(GUARDS_METADATA, BlockchainCertController) as Array<{ name?: string }>) ?? [])
      .map((g) => g?.name);
    expect(guards).toEqual(expect.arrayContaining(['JwtAuthGuard', 'RolesGuard']));
  });

  it('설계상 공개로 둔 3개를 제외한 모든 핸들러가 @Roles 를 갖는다', () => {
    const unguarded = routeHandlers(BlockchainCertController)
      .filter((h) => !OPEN_BY_DESIGN.has(h))
      .filter((h) => (rolesOf(h) ?? []).length === 0);
    expect(unguarded).toEqual([]);
  });
});

describe('BlockchainCertController 객체수준 인가(소유 검증)', () => {
  let controller: BlockchainCertController;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    service = {
      issue: vi.fn(),
      issueForSelf: vi.fn().mockResolvedValue({ id: 'cert-new' }),
      getCertById: vi.fn().mockResolvedValue({ id: 'cert-1' }),
      renew: vi.fn().mockResolvedValue({ id: 'cert-2' }),
      recordPinFail: vi.fn().mockResolvedValue({ id: 'cert-1' }),
      recordPinSuccess: vi.fn().mockResolvedValue({ id: 'cert-1' }),
      requireOwnership: vi.fn().mockRejectedValue(new NotFoundException('인증서를 찾을 수 없습니다')),
    };
    controller = new BlockchainCertController(service as never, { get: vi.fn(), set: vi.fn() } as never);
  });

  // 🔴 소유 검증을 통과하지 못하면 어떤 부수효과도 없어야 한다
  it.each(OWNERSHIP_REQUIRED)('%s 는 소유 검증 실패 시 404 이고 서비스 부수효과가 없다', async (handler) => {
    const call: Record<string, () => Promise<unknown>> = {
      getCertById: () => controller.getCertById('cert-1', 'attacker-1', UserRole.DOCTOR),
      renew: () => controller.renew('cert-1', { publicKey: 'attacker-pk' }, 'attacker-1'),
      recordPinFail: () => controller.recordPinFail({ certId: 'cert-1' }, 'attacker-1'),
      recordPinSuccess: () => controller.recordPinSuccess({ certId: 'cert-1' }, 'attacker-1'),
    };
    await expect(call[handler]()).rejects.toThrow(NotFoundException);
    expect(service.requireOwnership).toHaveBeenCalledWith('cert-1', 'attacker-1');
    expect(service[handler]).not.toHaveBeenCalled();
  });

  // 🔴 발급 명의는 본문이 아니라 토큰에서만
  it('issue 는 본문의 userId·identityVerified 를 신뢰하지 않는다', async () => {
    await controller.issue(
      { userId: 'victim-1', identityVerified: true, subjectDn: 'CN=피해자', publicKey: 'pk', algorithm: 'RSA-2048' },
      'attacker-1',
    );
    expect(service.issue).not.toHaveBeenCalled();
    expect(service.issueForSelf).toHaveBeenCalledWith('attacker-1', expect.objectContaining({ publicKey: 'pk' }));
  });
});
