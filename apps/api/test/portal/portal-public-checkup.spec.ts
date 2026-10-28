import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 🔴 공개 검진 안내 계약(2026-09-01) — /portal/checkup-programs 는 "(공개)"라 적혔지만
 *    클래스 가드(PortalOrPatientGuard)가 덮어 401 이었다. 홈페이지는 public 네임스페이스로 온다.
 */
const ROOT = join(__dirname, '../../src/modules/portal');
const pub = readFileSync(join(ROOT, 'portal-public.controller.ts'), 'utf8');
const mod = readFileSync(join(ROOT, 'portal.module.ts'), 'utf8');
const web = readFileSync(join(__dirname, '../../../web/src/app/(homepage)/checkup/page.tsx'), 'utf8');
const hp = readFileSync(join(__dirname, '../../../homepage/src/app/checkup/page.tsx'), 'utf8');

describe('portal-public-checkup: 공개 검진 안내 계약', () => {
  it('public 컨트롤러가 존재하고 인증 가드가 없다', () => {
    expect(pub).toContain("@Controller('api/v1/public')");
    expect(pub).toContain("@Get('checkup-programs')");
    expect(pub).toContain("@Get('checkup-capacity')");
    expect(pub).not.toContain('UseGuards'); // 공개 — 가드를 붙이면 홈페이지가 다시 401
  });
  it('정본은 PortalService 하나다(구현 복제 금지)', () => {
    expect(pub).toContain('getPublicCheckupPrograms()');
    expect(pub).toContain('getCheckupCapacity(from, to)');
    expect(pub).not.toContain('prisma'); // 직접 조회 복제 금지 — 정본이 둘이면 갈라진다
  });
  it('모듈에 등록되어 있다(만들고 안 꽂으면 404)', () => {
    expect(mod).toContain('PortalPublicCheckupController');
    expect(/controllers:\s*\[[^\]]*PortalPublicCheckupController/.test(mod)).toBe(true);
  });
  it('🔴 실공개 앱(apps/homepage) 사본도 public 경로를 부른다 — 사본은 갈라진다', () => {
    expect(hp).toContain('/api/v1/public/checkup-programs');
    expect(hp).not.toContain("'/api/v1/portal/checkup-programs'");
    expect(hp).toContain('loadError');
  });

  it('홈페이지 검진 페이지는 public 경로를 부른다(포털 경로는 401)', () => {
    expect(web).toContain('/api/v1/public/checkup-programs');
    expect(web).toContain('/api/v1/public/checkup-capacity');
    expect(web).not.toContain("'/api/v1/portal/checkup-programs'");
    // 실패를 빈 목록으로 번역하지 않는다
    expect(web).toContain('loadError');
  });
});
