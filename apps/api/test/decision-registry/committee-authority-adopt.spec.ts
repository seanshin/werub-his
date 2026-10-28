/**
 * 위원회 결정권한자 표 — 원내 채택 기록 경로(2026-10-12 기획 P3 G7).
 *  · 🔴 종전엔 쓰는 경로가 없어 개발 시드(DEV-SEED)가 영원히 남았다 — 원내 규정으로 정해도 남길 곳이 없었다
 *  · 근거(규정·의결 번호) 필수 · 🔴 시드 표식을 근거로 적으면 거부(채택을 시드로 위장하지 않는다) · 빈 칸 거부 · 관리자만
 *  · 기록하면 출처가 RECORDED(원내 채택)로 읽힌다 · 기록자·시각이 남는다
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { committeeAuthorityConfigKey, committeeAuthoritySourceOf, COMMITTEE_AUTHORITY_SEED_REF } from '@hospital-run/shared';
import { DecisionService } from '../../src/modules/decision-registry/decision.service';
import { DecisionController } from '../../src/modules/decision-registry/decision.controller';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

const mk = () => {
  const set = vi.fn(async () => ({}));
  const svc = new DecisionService({} as never, { set } as never, {} as never, {} as never, { log: vi.fn() } as never);
  return { svc, set };
};
const BODY = { chair: '진료부원장', secretary: '의무기록팀장', verifier: '의무기록팀', votingRule: '재적 과반 출석·출석 과반 찬성', exOfficio: ['원무팀장'], basisRef: '의무기록위원회 규정 제3조(2026-11-01 개정)' };

describe('🔴 결정권한자 표 원내 채택 기록', () => {
  it('근거와 함께 기록 → 출처 RECORDED · 기록자·시각', async () => {
    const { svc, set } = mk();
    const r = await svc.recordCommitteeAuthority('MRC', '00000000-0000-4000-a000-0000000000a1', BODY);
    expect(r.source).toBe('RECORDED');
    const [key, value, by] = set.mock.calls[0] as unknown as [string, Record<string, unknown>, string];
    expect(key).toBe(committeeAuthorityConfigKey('MRC'));
    expect(by).toBe('00000000-0000-4000-a000-0000000000a1');
    expect(value).toMatchObject({ ...BODY, recordedByUserId: '00000000-0000-4000-a000-0000000000a1' });
    expect(typeof value.recordedAt).toBe('string');
    expect(committeeAuthoritySourceOf(value)).toBe('RECORDED');
  });
  it('🔴 시드 표식 근거 거부 · 빈 칸 거부 · 없는 위원회 404 — 아무것도 쓰지 않는다', async () => {
    const { svc, set } = mk();
    await expect(svc.recordCommitteeAuthority('MRC', 'u', { ...BODY, basisRef: COMMITTEE_AUTHORITY_SEED_REF })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.recordCommitteeAuthority('MRC', 'u', { ...BODY, chair: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.recordCommitteeAuthority('NOPE', 'u', BODY)).rejects.toBeInstanceOf(NotFoundException);
    expect(set).not.toHaveBeenCalled();
  });
  it('EP 는 관리자만', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DecisionController.prototype.committeeAuthority)).toEqual(['ADMIN']);
  });
});
