/**
 * 공개 홈페이지 진실성 가드 (W9 · 화면 실사용 점검)
 *
 * 공개 화면은 환자·일반인이 보고 그대로 행동한다(전화를 걸고, 그 시간에 찾아오고, 그 비용을 예상한다).
 * 여기서 고정하는 것은 "화면이 사실을 말하는가"이지 렌더 결과가 아니다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as facts from '../../src/components/homepage/hospital-facts';
import { HOSPITAL, isDialable, telHref } from '../../src/components/homepage/hospital-facts';
import { effectiveStatus } from '../../src/app/(homepage)/news/recruit/recruit-list-client';

const ROOT = resolve(__dirname, '../..');
const HOMEPAGE_DIR = join(ROOT, 'src/app/(homepage)');
const COMPONENTS_DIR = join(ROOT, 'src/components/homepage');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(tsx?|ts)$/.test(full) ? [full] : [];
  });
}

const FILES = [...walk(HOMEPAGE_DIR), ...walk(COMPONENTS_DIR)];
const sources = FILES.map(f => ({ file: f.replace(ROOT + '/', ''), text: readFileSync(f, 'utf8') }));

/**
 * 주석(설명으로 원 결함을 적어둔 줄)은 검사에서 뺀다 — 코드에 남은 값만 본다.
 * JS 주석 `//` `/*` `*` 과 JSX 주석 `{/* ... *\/}` 를 모두 제외한다.
 */
function codeLines(text: string): string[] {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, ''); // /* ... */ 와 {/* ... */} 본문
  return withoutBlocks.split('\n').filter(l => !l.trim().startsWith('//'));
}

describe('공개 홈페이지 — 전화번호', () => {
  it('플레이스홀더 번호(02-1234-5678)가 어디에도 남아 있지 않다', () => {
    // 🔴 원 결함: 모바일 플로팅 '전화' 버튼(전 페이지)·고객지원 대표전화·채용 인사팀 번호가
    //    전부 02-1234-5678 이었다. 방문자가 누르면 병원이 아닌 곳으로 걸린다.
    const hits = sources.filter(s => codeLines(s.text).some(l => l.includes('02-1234-5678')));
    expect(hits.map(h => h.file)).toEqual([]);
  });

  it('대표전화 정본은 02-000-0000 하나뿐이다', () => {
    expect(HOSPITAL.phone).toBe('02-000-0000');
    expect(HOSPITAL.emergencyPhone).toBe('02-000-0119');
  });

  it('내선 번호는 tel: 링크로 만들 수 없다', () => {
    // 🔴 원 결함: 진료과 상세가 metadata.phone "내선 2100" 에서 숫자만 뽑아 tel:2100 을 만들었다.
    //    운영 22개 진료과 중 21개가 내선이라, '전화 예약' 버튼이 사실상 전부 죽어 있었다.
    expect(isDialable('내선 2100')).toBe(false);
    expect(telHref('내선 2100')).toBeNull();
    expect(isDialable('02-000-0119')).toBe(true);
    expect(telHref('02-000-0000')).toBe('tel:020000000');
    expect(isDialable(undefined)).toBe(false);
    expect(isDialable('')).toBe(false);
  });
});

describe('공개 홈페이지 — 진료시간 정본이 하나인가', () => {
  it('진료시간 코드 상수가 없다 — 정본은 CMS(lib/clinic-hours) 하나(2026-09-15 T6)', () => {
    // 🔴 T6: 푸터·진료과·JSON-LD·챗봇이 CMS 를 읽지 않고 CLINIC_HOURS 상수를 병원 사실로 그렸다.
    expect((facts as Record<string, unknown>).CLINIC_HOURS).toBeUndefined();
    expect((facts as Record<string, unknown>).CLINIC_HOURS_ISO).toBeUndefined();
  });

  it('옛 진료시간 문자열(09:00 ~ 18:00 / 12:30 ~ 14:00 / 08:30~17:30)이 코드에 남아 있지 않다', () => {
    // 🔴 원 결함(P12): 푸터·진료과 목록·진료과 상세·예약 챗봇·JSON-LD 가 09:00~18:00 을 말하는 동안
    //    '진료시간' 페이지는 09:00~17:30 을 말했다. 같은 페이지의 본문과 푸터가 서로 달랐다.
    const stale = [/09:00\s*[~-]\s*18:00/, /12:30\s*[~-]\s*14:00/, /08:30\s*[~-]\s*17:30/];
    const hits: string[] = [];
    for (const s of sources) {
      for (const line of codeLines(s.text)) {
        if (stale.some(re => re.test(line))) hits.push(`${s.file}: ${line.trim().slice(0, 100)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("JSON-LD 시간도 같은 원천에서 나온다(별도 리터럴 금지)", () => {
    const layout = sources.find(s => s.file.endsWith('(homepage)/layout.tsx'))!;
    expect(layout.text).toContain("from '@/lib/clinic-hours'");
    expect(layout.text).toMatch(/hours\.source === 'cms'/);
    expect(codeLines(layout.text).some(l => /opens:\s*'\d{2}:\d{2}'/.test(l))).toBe(false);
  });
});

describe('공개 홈페이지 — 채용 공고 상태', () => {
  const day = 86_400_000;
  const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

  it('마감일이 지났으면 metadata.status 가 OPEN 이어도 마감이다', () => {
    // 🔴 원 결함(P1, 운영 실측 2026-08-14): 공고 3건이 전부 status='OPEN' 인데 마감일은
    //    2026-07-31 / 2026-08-31 / 2026-07-15 였다. 같은 줄에서 배지는 '모집중', D-day 는 '마감'이라
    //    동시에 말했고 상단 요약은 '모집중 3'이라 끝난 공고로 지원자를 불러들였다.
    expect(effectiveStatus({ status: 'OPEN', deadline: iso(-1) })).toBe('CLOSED');
    expect(effectiveStatus({ status: 'OPEN', deadline: iso(-30) })).toBe('CLOSED');
  });

  it('마감이 임박하면(7일 이내) 마감임박으로 승격한다', () => {
    expect(effectiveStatus({ status: 'OPEN', deadline: iso(3) })).toBe('CLOSING_SOON');
  });

  it('마감일이 넉넉하면 모집중을 유지한다', () => {
    expect(effectiveStatus({ status: 'OPEN', deadline: iso(30) })).toBe('OPEN');
  });

  it('마감일이 없으면 선언된 상태를 그대로 쓴다(모르는 것을 지어내지 않는다)', () => {
    expect(effectiveStatus({ status: 'OPEN' })).toBe('OPEN');
    expect(effectiveStatus({ status: 'CLOSED' })).toBe('CLOSED');
    expect(effectiveStatus({})).toBe('OPEN');
  });

  it('명시적으로 마감된 공고는 마감일이 남아도 마감이다', () => {
    expect(effectiveStatus({ status: 'CLOSED', deadline: iso(30) })).toBe('CLOSED');
  });
});

describe('공개 홈페이지 — 저장소 규약', () => {
  it("(homepage) 는 apiClient 를 쓰지 않는다 (규약: fetch 직접 사용)", () => {
    // 🔴 원 결함: booking 페이지가 apiClient 를 썼고, apiClient 가 읽는 localStorage 키는
    //    직원 토큰('accessToken')이라 환자 포털 토큰('portal-token')과 어긋나 자동 로그인이
    //    한 번도 동작하지 않았다(반대로 직원 토큰이 /portal/profile 로 전송됐다).
    const hits = sources.filter(s =>
      codeLines(s.text).some(l => /from ['"]@\/lib\/api-client['"]/.test(l)),
    );
    expect(hits.map(h => h.file)).toEqual([]);
  });
});

describe('공개 홈페이지 — sitemap', () => {
  const sitemapPath = join(HOMEPAGE_DIR, 'sitemap.ts');
  const sitemap = readFileSync(sitemapPath, 'utf8');

  it('/sitemap.xml 을 만드는 파일은 하나뿐이다', () => {
    // 🔴 원 결함(P12): app/sitemap.ts 와 app/(homepage)/sitemap.ts 가 동시에 있었고
    //    서로 다른 도메인·다른 경로 목록을 말했다(하나는 조용히 죽어 있었다).
    expect(existsSync(join(ROOT, 'src/app/sitemap.ts'))).toBe(false);
    expect(existsSync(sitemapPath)).toBe(true);
  });

  it('API 헬스체크 경로(/health)를 콘텐츠 페이지로 광고하지 않는다', () => {
    // 🔴 원 결함: sitemap 이 /health 를 weekly·priority 0.7 로 실었다. 그 경로는 화면이 아니라
    //    {"status":"ok","version":"..."} 를 돌려주는 API 라, 검색엔진에 JSON 과 가동 버전을 광고했다.
    expect(sitemap).not.toMatch(/path:\s*'\/health'/);
    expect(sitemap).toMatch(/path:\s*'\/health-info'/);
  });

  it('robots 가 가리키는 호스트와 같은 도메인을 쓴다(크로스도메인 sitemap 금지)', () => {
    // 🔴 원 결함: robots 는 his.example.org/sitemap.xml 을 가리키는데 그 sitemap 이 돌려주는 URL 은
    //    전부 hospitalrun.kr 이었다. 크로스도메인 sitemap 은 검색엔진이 통째로 무시한다.
    // robots 원천은 정적 파일(public/robots.txt) 또는 라우트((homepage)/robots.ts) 둘 중 하나다.
    const staticRobots = join(ROOT, 'public/robots.txt');
    const routeRobots = join(HOMEPAGE_DIR, 'robots.ts');
    const robotsText = existsSync(staticRobots)
      ? readFileSync(staticRobots, 'utf8')
      : readFileSync(routeRobots, 'utf8');
    const robotsHost = robotsText.match(/(?:Sitemap:\s*|NEXT_PUBLIC_SITE_URL\s*\|\|\s*')(https?:\/\/[^/'\s]+)/)?.[1];
    const sitemapHost = sitemap.match(/NEXT_PUBLIC_SITE_URL\s*\|\|\s*'(https?:\/\/[^']+)'/)?.[1];
    expect(robotsHost).toBeTruthy();
    expect(sitemapHost).toBe(robotsHost);
  });

  it('광고하는 정적 경로에는 실제 page 파일이 있다(404 를 색인시키지 않는다)', () => {
    const paths = [...sitemap.matchAll(/path:\s*'([^']+)'/g)].map(m => m[1]);
    expect(paths.length).toBeGreaterThan(20);
    const missing = paths.filter(p => {
      const dir = join(HOMEPAGE_DIR, p);
      return !existsSync(join(dir, 'page.tsx')) && !existsSync(join(dir, 'page.ts'));
    });
    expect(missing).toEqual([]);
  });
});
