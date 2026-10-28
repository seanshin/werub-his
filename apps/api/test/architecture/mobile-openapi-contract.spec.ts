import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **모바일 OpenAPI 계약 스냅샷이 코드와 어긋나지 않는다** (CONTRACT-01 · 2026-08-31).
 *
 * 전체 Swagger 는 EP 한 덩어리라 앱팀에게 줄 계약이 없었다(회신 §5 미구현).
 * `npm run gen:mobile-openapi` 가 모바일 태그만 뽑아 `openapi-mobile.json` 으로 동결한다.
 * 이 가드는 그 계약이 **실제 존재하고, 앱이 쓰는 EP 를 담고 있는지** 확인한다 —
 * 스냅샷이라 자동 갱신되지 않으므로, 컨트롤러에 모바일 태그를 새로 붙였는데 계약을
 * 재생성하지 않으면 여기서 드러난다.
 */
const ROOT = join(process.cwd(), '..', '..');
const contractPath = join(ROOT, 'docs/05-reference/openapi-mobile.json');
const manualPath = join(ROOT, 'docs/05-reference/mobile-api-manual.md');

describe('🔴 모바일 API 계약이 존재하고 앱 EP 를 담는다', () => {
  it('계약 파일과 매뉴얼이 있다', () => {
    expect(existsSync(contractPath), 'openapi-mobile.json 없음 — npm run gen:mobile-openapi').toBe(true);
    expect(existsSync(manualPath), 'mobile-api-manual.md 없음').toBe(true);
  });

  const doc = existsSync(contractPath) ? JSON.parse(readFileSync(contractPath, 'utf8')) : { paths: {}, tags: [] };

  it('모바일 태그 5종이 모두 담겨 있다', () => {
    const names = new Set((doc.tags ?? []).map((t: any) => t.name));
    for (const t of ['Patient Auth', 'Patient Portal', 'Patient Portal — 검진', 'mobile-device-push', 'mobile-app-integrity']) {
      expect(names.has(t), `태그 누락: ${t}`).toBe(true);
    }
  });

  it('🔴 앱이 실제로 쓰는 핵심 EP 가 계약에 있다', () => {
    const paths = Object.keys(doc.paths ?? {});
    const has = (p: string) => paths.some((x) => x === p || x.replace(/\{[^}]+\}/g, ':x') === p.replace(/:[^/]+/g, ':x'));
    for (const ep of [
      '/api/v1/patient-auth/login',
      '/api/v1/portal/lab-results',
      '/api/v1/portal/notices',
      '/api/v1/portal/billings',
      '/api/v1/portal/appointments',
    ]) {
      expect(has(ep), `계약에 없다: ${ep} — 재생성 필요`).toBe(true);
    }
  });

  it('🔴 시드 EP 는 계약에서 제외된다(앱이 부르면 안 되는 것)', () => {
    const paths = Object.keys(doc.paths ?? {});
    expect(paths.some((p) => p.includes('seed-test-accounts')), '시드가 계약에 노출됐다').toBe(false);
  });

  it('🔴 핵심 EP 는 응답 스키마(반환 필드)를 계약에 못박는다', () => {
    // 앱이 서버에 없는 필드를 읽어 공지 날짜·검사 날짜가 빈칸이던 사고의 재발 방지.
    // 이 EP 들의 응답 스키마를 떼면(또는 필드 오타) 여기서 드러난다.
    const core = [
      '/api/v1/patient-auth/login',
      '/api/v1/patient-auth/token/refresh',
      '/api/v1/portal/lab-results',
      '/api/v1/portal/notices',
      '/api/v1/portal/billings',
      '/api/v1/portal/medications',
      '/api/v1/portal/vaccinations',
      '/api/v1/portal/encounters',
      '/api/v1/portal/allergies',
    ];
    for (const ep of core) {
      const methods = (doc.paths ?? {})[ep];
      expect(methods, `계약에 없다: ${ep}`).toBeTruthy();
      const op = Object.values(methods).find((o: any) => o && typeof o === 'object' && o.responses) as any;
      const ok = op?.responses?.['200'] ?? op?.responses?.['201'];
      const schema = ok?.content && Object.values(ok.content)[0] as any;
      expect(schema?.schema, `응답 스키마 없음: ${ep} — @ApiOkResponse 확인`).toBeTruthy();
    }
    // 🔴 lab-results 는 orderedAt(≠completedAt) 을, notices 는 date(≠createdAt) 를 계약이 담아야 한다
    const labProps = ((doc.paths['/api/v1/portal/lab-results'] as any).get.responses['200'].content['application/json'].schema
      .properties.data.items.properties);
    expect(Object.keys(labProps), 'lab-results 에 orderedAt 없음').toContain('orderedAt');
    const noticeProps = ((doc.paths['/api/v1/portal/notices'] as any).get.responses['200'].content['application/json'].schema
      .properties.data.items.properties);
    expect(Object.keys(noticeProps), 'notices 에 date 없음').toContain('date');
    expect(Object.keys(noticeProps), 'notices 가 createdAt 을 계약에 잘못 넣음').not.toContain('createdAt');
  });

  it('충분한 규모다 — 필터가 죽으면 전체가 빨려 들어가거나 0이 된다', () => {
    const n = Object.keys(doc.paths ?? {}).length;
    expect(n).toBeGreaterThan(80);
    expect(n).toBeLessThan(400);
  });

  it('응답·인증 규약이 계약 설명에 있다', () => {
    expect(doc.info?.description ?? '').toMatch(/data, meta/);
    const schemes = doc.components?.securitySchemes ?? {};
    expect(Object.keys(schemes)).toContain('PortalToken');
  });
});
