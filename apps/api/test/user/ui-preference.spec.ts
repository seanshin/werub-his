import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateUiPreferenceDto } from '../../src/modules/user/dto/update-ui-preference.dto';
import { UserService } from '../../src/modules/user/user.service';

/**
 * 사용자 화면 표시 선호(P2 — 기기 간 동기화) 가드.
 *  1. DTO 는 class + shared 어휘(지어낸 모드 400)
 *  2. 🔴 행 없음 = null(미설정) — 기본값 KO 를 만들어 넣지 않는다(미설정≠KO 선택)
 *  3. 🔴 me 라우트가 :id 라우트보다 먼저다 — 뒤면 'me' 가 UUID 파이프에 걸려 400
 *  4. 역할은 shared 정본 파생(EVERY_STAFF_ROLE) — 손목록이면 신설 직군이 403 을 본다
 */

describe('UpdateUiPreferenceDto', () => {
  const make = (over: Record<string, unknown> = {}) =>
    plainToInstance(UpdateUiPreferenceDto, { termLang: 'EN', ...over });

  it('정상 모드는 통과(대조군)', () => {
    for (const m of ['KO', 'EN', 'BOTH']) expect(validateSync(make({ termLang: m }))).toHaveLength(0);
  });

  it('🔴 지어낸 모드를 400 으로 문다', () => {
    expect(validateSync(make({ termLang: 'JP' })).length).toBeGreaterThan(0);
    expect(validateSync(make({ termLang: '' })).length).toBeGreaterThan(0);
  });
});

describe('UserService ui-preferences', () => {
  const makeSvc = (row: unknown) => {
    const prisma = {
      userUiPreference: {
        findUnique: vi.fn().mockResolvedValue(row),
        upsert: vi.fn(async (a: { create: Record<string, unknown> }) => ({ ...a.create, updatedAt: new Date() })),
      },
    };
    return { svc: new UserService(prisma as never), prisma };
  };

  it('🔴 행 없음 = termLang null — 미설정을 기본값으로 만들어 넣지 않는다', async () => {
    const { svc } = makeSvc(null);
    const r = await svc.getUiPreferences('u-1');
    expect(r.termLang).toBeNull();
    expect(r.updatedAt).toBeNull();
  });

  it('저장은 자기 userId 로 upsert 한다(대조군)', async () => {
    const { svc, prisma } = makeSvc(null);
    const r = await svc.setUiPreferences('u-1', { termLang: 'EN' });
    expect(r.termLang).toBe('EN');
    const arg = prisma.userUiPreference.upsert.mock.calls[0][0] as { where: { userId: string } };
    expect(arg.where.userId).toBe('u-1');
  });
});

describe('컨트롤러 배선(소스 대조)', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'modules', 'user', 'user.controller.ts'), 'utf8');

  it("🔴 'me/ui-preferences' 가 ':id' 라우트보다 먼저 선언돼 있다", () => {
    const me = src.indexOf("me/ui-preferences");
    const byId = src.indexOf("(':id')");
    expect(me).toBeGreaterThan(-1);
    expect(byId).toBeGreaterThan(-1);
    expect(me, "'me' 가 :id 뒤면 UUID 파이프가 400 을 던진다").toBeLessThan(byId);
  });

  it('🔴 역할은 shared 정본 파생 — 자기 스코프 EP 에 손목록 금지', () => {
    const block = /me\/ui-preferences'\)[\s\S]{0,300}?EVERY_STAFF_ROLE/;
    expect(block.test(src)).toBe(true);
  });
});
