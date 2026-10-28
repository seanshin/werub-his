import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { TranslationOverrideStatus } from '@prisma/client';
import { StaffQualificationController } from '../../src/modules/staff-qualification/staff-qualification.controller';
import type { StaffQualificationService } from '../../src/modules/staff-qualification/staff-qualification.service';
import { emptyState, makeService, overrideRow, realTranslatedKey } from '../architecture/i18n-review-fixture';

/**
 * I(2026-09-21) — **역할 미지정 축의 "③ 다른 축이 이미 막는다" 면제에 대조 코드를 붙인다.**
 *
 * 🔴 E3 는 `staff-qualification`(2)·`i18n-review`(9) 를 "서비스가 주체를 좁힌다"며 면제했고,
 *    `handler-authz-guard.spec.ts` 는 그 자리를 **"열린 채로 둔다"** 고 못박았다.
 *    그런데 **좁히는 코드 자체를 보는 가드는 어디에도 없었다** — 그 한 줄을 지워도
 *    동결 가드는 계속 초록이고, 오히려 "판정 완료"라고 말한다(판정 규칙 §3 ·
 *    "이름만 적으면 대조 코드를 지워도 통과한다" · H3 가 `qr`·`app-key` 에서 같은 구멍을 냈다).
 *
 * 🔴 이 스펙은 **소스 문자열이 아니라 동작**을 본다. 목은 넘겨받은 인자만 기록한다 —
 *    스코프를 빠뜨린 코드는 실제 Prisma 처럼 남의 행을 그대로 내준다.
 */

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('🔴 직원 자격·교육 — 역할이 아니라 컨트롤러가 본인으로 좁힌다', () => {
  /** 서비스는 **넘겨받은 필터 그대로** 조회한다 — 좁히기는 컨트롤러 한 줄이 전부다 */
  const mk = () => {
    const svc = {
      listCredentials: vi.fn(async () => []),
      listEducation: vi.fn(async () => []),
    } as unknown as StaffQualificationService;
    return { ctl: new StaffQualificationController(svc), svc: svc as unknown as Record<string, ReturnType<typeof vi.fn>> };
  };

  it('🔴 비ADMIN 이 ?userId= 로 남의 면허를 겨눠도 본인 것만 조회된다(IDOR)', async () => {
    const { ctl, svc } = mk();
    await ctl.listCredentials(ME, 'NURSE', OTHER);
    expect(svc.listCredentials).toHaveBeenCalledTimes(1);
    expect(svc.listCredentials.mock.calls[0][0].userId,
      '비ADMIN 의 userId 질의가 그대로 내려갔다 — 타인 면허번호·자격스캔 URL 이 나간다').toBe(ME);
  });

  it('🔴 userId 를 아예 안 넘겨도 전건이 되지 않는다(undefined = 전체 조회)', async () => {
    const { ctl, svc } = mk();
    await ctl.listCredentials(ME, 'DOCTOR', undefined);
    expect(svc.listCredentials.mock.calls[0][0].userId).toBe(ME);
  });

  it('🔴 교육 이수 이력도 같다', async () => {
    const { ctl, svc } = mk();
    await ctl.listEducation(ME, 'LAB_TECH', OTHER);
    expect(svc.listEducation.mock.calls[0][0].userId).toBe(ME);
  });

  it('대조군 — ADMIN 은 지정한 직원 것을 그대로 본다(오버사이트가 죽지 않았다)', async () => {
    const { ctl, svc } = mk();
    await ctl.listCredentials(ME, 'ADMIN', OTHER);
    expect(svc.listCredentials.mock.calls[0][0].userId).toBe(OTHER);
  });

  it('대조군 — ADMIN 이 userId 를 비우면 전건이다(관리 화면의 기본 목록)', async () => {
    const { ctl, svc } = mk();
    await ctl.listCredentials(ME, 'ADMIN', undefined);
    expect(svc.listCredentials.mock.calls[0][0].userId).toBeUndefined();
  });

  it('대조군 — 다른 필터(type·status)는 그대로 전달된다(좁히기가 질의를 삼키지 않는다)', async () => {
    const { ctl, svc } = mk();
    await ctl.listCredentials(ME, 'NURSE', OTHER, 'LICENSE', 'VALID');
    expect(svc.listCredentials.mock.calls[0][0]).toMatchObject({ userId: ME, type: 'LICENSE', status: 'VALID' });
  });
});

describe('🔴 언어팩 검수 — 역할이 아니라 검수자 명부가 쓰기를 막는다', () => {
  const LOCALE = 'en';
  const reviewerState = (over: Record<string, unknown> = {}) =>
    emptyState({ reviewersConfig: { [LOCALE]: ['reviewer-1'] }, ...over });

  it('🔴 명부에 없는 직원의 제안은 403 이다 — 읽기가 열려 있다고 쓰기까지 열리지 않는다', async () => {
    const { key } = realTranslatedKey(LOCALE);
    const svc = makeService(reviewerState());
    await expect(svc.propose({ id: 'nobody', role: 'DOCTOR' }, { locale: LOCALE, key, draftValue: '내 맘대로' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('🔴 승인도 막힌다(제안만 막고 승인을 잊으면 아무것도 막지 못한 것이다)', async () => {
    const { key } = realTranslatedKey(LOCALE);
    const id = '00000000-0000-4000-9000-000000000001';
    const svc = makeService(reviewerState({
      overrides: [overrideRow({ id, locale: LOCALE, key, status: TranslationOverrideStatus.PROPOSED, proposedBy: 'reviewer-1' })],
    }));
    await expect(svc.decide({ id: 'nobody', role: 'NURSE' }, id, 'APPROVED', '통과'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('🔴 "코드 반영 표시"는 검수자여도 막힌다(ADMIN 몫)', async () => {
    const { key } = realTranslatedKey(LOCALE);
    const id = '00000000-0000-4000-9000-000000000002';
    const svc = makeService(reviewerState({
      overrides: [overrideRow({ id, locale: LOCALE, key, status: TranslationOverrideStatus.APPROVED })],
    }));
    await expect(svc.markMerged({ id: 'reviewer-1', role: 'DOCTOR' }, id, '반영했다'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('🔴 명부를 읽지 못하면 "검수자 없음"이 아니라 **판정 불가**로 막는다(실패 ≠ 없음)', async () => {
    const { key } = realTranslatedKey(LOCALE);
    const svc = makeService(emptyState({ reviewersConfig: 'throw' }));
    await expect(svc.propose({ id: 'reviewer-1', role: 'DOCTOR' }, { locale: LOCALE, key, draftValue: 'x' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    const p = await svc.permissionFor({ id: 'reviewer-1', role: 'DOCTOR' }, LOCALE);
    expect(p.reviewerCount, '조회 실패를 0명으로 그리면 "지정 안 됨"과 구분되지 않는다').toBeNull();
    expect(p.reason).toContain('판정할 수 없어');
  });

  it('대조군 — 명부에 있는 검수자는 제안이 통과한다(막는 가드가 아니라 명부 가드다)', async () => {
    const { key } = realTranslatedKey(LOCALE);
    const svc = makeService(reviewerState());
    const r = await svc.propose({ id: 'reviewer-1', role: 'DOCTOR' }, { locale: LOCALE, key, draftValue: '검수자가 고친 값' });
    expect(r.status).toBe(TranslationOverrideStatus.PROPOSED);
  });

  it('대조군 — 읽기는 계속 열려 있다(숨기지 않고 사유를 말한다)', async () => {
    const p = await makeService(reviewerState()).permissionFor({ id: 'nobody', role: 'NURSE' }, LOCALE);
    expect(p.canPropose).toBe(false);
    expect(p.reason, '왜 못 하는지를 화면이 그대로 말해야 한다').toContain('읽기는 열려 있고');
  });
});
