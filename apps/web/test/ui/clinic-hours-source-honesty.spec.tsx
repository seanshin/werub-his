/**
 * 🔴 (2026-09-15 T6) 공개 사이트 진료시간 — CMS 를 못 읽으면 코드 상수를 병원 사실로 그리지 않는다.
 *
 * 원 결함: `apps/homepage/src/lib/clinic-hours.ts` 가 조회 실패·형식 불일치 시 코드 상수를 `source:'fallback'` 으로 돌려줬는데
 * Footer·진료과 목록·진료과 상세·JSON-LD 어디도 source 를 보지 않았다. 평일만 읽혀도 토요일·점심·휴진을 상수로 채웠다.
 * web `(homepage)` 그룹은 아예 CMS 를 읽지 않고 `CLINIC_HOURS` 상수만 썼다(예약 챗봇·영문 한 줄 포함).
 *
 * 지키는 것:
 *  ① getClinicHours 4상태 — 조회 실패 unavailable · 글 없음 missing · 형식 불일치 unparsed · 정상 cms(없는 칸 null)
 *  ② ClinicHoursNotice — cms 면 아무것도 안 그림(대조군) · unavailable/missing 문구 + 대표전화
 *  ③ 진료시간을 그리는 파일은 source 를 본다(상수를 사실로 그리지 않음) — 두 앱 전수
 *  ④ 코드에 진료시간 리터럴이 남지 않는다(주석 제외) — 두 앱 전수
 *  ⑤ 공개 사이트 앱 사본(ClinicHoursNotice)이 web 정본과 같다
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getClinicHours, parseClinicHours } from '../../src/lib/clinic-hours';
import { ClinicHoursNotice } from '../../src/components/homepage/ClinicHoursNotice';

const CMS_BODY = '<ul><li>평일: 09:00 ~ 17:30</li><li>토요일: 09:00 ~ 13:00</li><li>점심시간: 12:30 ~ 13:30</li><li>일요일·공휴일 휴진</li></ul>';

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('① getClinicHours 4상태', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('조회 실패(네트워크) → unavailable · 값 없음', async () => {
    mockFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    expect(await getClinicHours()).toEqual({ source: 'unavailable', weekday: null, saturday: null, lunch: null, closed: null });
  });

  it('5xx → unavailable', async () => {
    mockFetch(() => json({ error: 'x' }, 503));
    expect((await getClinicHours()).source).toBe('unavailable');
  });

  it('진료시간 글이 없음 → missing(등록 안 됨)', async () => {
    mockFetch(() => json({ data: [{ slug: 'parking', content: '<p>주차</p>' }] }));
    expect((await getClinicHours()).source).toBe('missing');
  });

  it('정상 → cms 값 그대로', async () => {
    mockFetch(() => json({ data: [{ slug: 'operating-hours', content: CMS_BODY }] }));
    expect(await getClinicHours()).toEqual({ source: 'cms', weekday: '09:00 ~ 17:30', saturday: '09:00 ~ 13:00', lunch: '12:30 ~ 13:30', closed: '일요일·공휴일 휴진' });
  });

  it('형식이 바뀐 글 → unparsed · 평일만 있으면 나머지 칸은 null(상수로 채우지 않음)', () => {
    expect(parseClinicHours('<p>진료시간은 전화로 문의</p>').source).toBe('unparsed');
    expect(parseClinicHours('<li>평일: 08:30 ~ 17:00</li>')).toEqual({ source: 'cms', weekday: '08:30 ~ 17:00', saturday: null, lunch: null, closed: null });
  });
});

describe('② ClinicHoursNotice', () => {
  it('cms 면 아무것도 그리지 않는다(대조군)', () => {
    const { container } = render(<ClinicHoursNotice hours={parseClinicHours(CMS_BODY)} phone="02-000-0000" />);
    expect(container.textContent).toBe('');
  });

  it('unavailable → "불러오지 못했습니다" + 대표전화 링크', () => {
    render(<ClinicHoursNotice hours={{ source: 'unavailable', weekday: null, saturday: null, lunch: null, closed: null }} phone="02-000-0000" />);
    expect(screen.getByText(/진료시간을 불러오지 못했습니다/)).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('tel:020000000');
  });

  it('missing → "등록된 진료시간 없음"(시간 숫자를 그리지 않음)', () => {
    const { container } = render(<ClinicHoursNotice hours={parseClinicHours(null)} phone="02-000-0000" />);
    expect(container.textContent).toMatch(/등록된 진료시간 없음/);
    expect(container.textContent).not.toMatch(/\d{2}:\d{2}/);
  });
});

const WEB_SRC = resolve(__dirname, '../../src');
const HP_SRC = resolve(__dirname, '../../../homepage/src');
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : /\.tsx?$/.test(f) ? [f] : [];
  });
}
const code = (t: string) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const publicFiles = [
  ...walk(join(WEB_SRC, 'app/(homepage)')), ...walk(join(WEB_SRC, 'components/homepage')),
  ...walk(join(HP_SRC, 'app')), ...walk(join(HP_SRC, 'components')),
];

describe('③④ 두 앱 전수 — 진료시간은 CMS 정본에서만', () => {
  it('스캔 대상이 비어 있지 않다(하한)', () => {
    expect(publicFiles.length).toBeGreaterThan(80);
  });

  it('③ getClinicHours 를 부르는 화면은 source 를 본다(자식에 넘기면 그 자식이 본다)', () => {
    const rel = (f: string) => f.replace(resolve(__dirname, '../../..') + '/', '');
    const offenders = publicFiles
      .filter((f) => /getClinicHours\(/.test(code(readFileSync(f, 'utf8'))))
      .filter((f) => {
        const src = code(readFileSync(f, 'utf8'));
        if (/\.source\s*===\s*'cms'/.test(src)) return false;
        // 진료과 상세: 값을 DeptTabs 로 넘기고 GuideTab 이 source 를 본다
        if (/hospitalHours=\{hospitalHours\}/.test(src)) {
          const tabs = f.replace(/page\.tsx$/, 'dept-tabs.tsx');
          return !(existsSync(tabs) && /hospitalHours\.source\s*===\s*'cms'/.test(code(readFileSync(tabs, 'utf8'))));
        }
        return true;
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('③ 진료시간 상수(CLINIC_HOURS·SITE_INFO.hours·S.hours·hoursLine·CLINIC_HOURS_FALLBACK)를 쓰는 곳이 없다', () => {
    const hits = publicFiles
      .filter((f) => /\bCLINIC_HOURS(_ISO|_FALLBACK)?\b|SITE_INFO\.hours|\bS\.hours\b|\bhoursLine\(/.test(code(readFileSync(f, 'utf8'))))
      .map((f) => f.replace(resolve(__dirname, '../../..') + '/', ''));
    expect(hits).toEqual([]);
  });

  /**
   * 외래 진료시간과 **다른 사실**의 시각 리터럴 — T6 범위 밖, 목록 동결(늘면 실패 · 사유 필수).
   * 🔴 이 목록은 "괜찮다"는 뜻이 아니다: 건강검진센터 운영시간·앱 챗봇 면회시간도 코드 상수다(기록만 — 후속 대상).
   */
  const OTHER_TIME_LITERALS: Record<string, string> = {
    // 2026-09-15 E1: 검진센터 운영시간 4곳·앱 챗봇 면회시간을 안내 페이지·대표전화 정본으로 옮겨 목록이 비었다(여유 0 — 새로 생기면 실패)
  };

  it('④ 외래 진료시간 리터럴이 코드에 남지 않는다(주석 제외 · 다른 사실은 동결 목록)', () => {
    const re = /\b\d{2}:\d{2}\s*[~-]\s*\d{2}:\d{2}\b/;
    const files = new Set<string>();
    for (const f of [...publicFiles, join(WEB_SRC, 'lib/clinic-hours.ts'), join(HP_SRC, 'lib/clinic-hours.ts'), join(HP_SRC, 'lib/site-info.ts'), join(WEB_SRC, 'components/homepage/hospital-facts.ts')]) {
      if (code(readFileSync(f, 'utf8')).split('\n').some((l) => re.test(l))) files.add(f.replace(resolve(__dirname, '../../..') + '/', ''));
    }
    expect([...files].sort()).toEqual(Object.keys(OTHER_TIME_LITERALS).sort());
    for (const why of Object.values(OTHER_TIME_LITERALS)) expect(why.trim().length).toBeGreaterThan(0);
  });

  it('⑥ (E1) 검진센터 운영시간·내선과 앱 챗봇의 근거 없는 병원 사실 상수가 없다 · 챗봇 안내 문장이 web 사본과 같다', () => {
    const rd = (p: string) => code(readFileSync(p, 'utf8'));
    for (const f of [
      join(WEB_SRC, 'app/(homepage)/checkup/page.tsx'), join(WEB_SRC, 'app/(homepage)/checkup/[slug]/page.tsx'),
      join(HP_SRC, 'app/checkup/page.tsx'), join(HP_SRC, 'app/checkup/[slug]/page.tsx'),
    ]) {
      const src = rd(f);
      expect(src, f).not.toMatch(/내선\s*7100/);
      expect(src, f).not.toMatch(/08:00\s*~\s*17:00/);
      expect(src, f).toMatch(/href="\/checkup\/faq"/);
    }
    const app = rd(join(HP_SRC, 'app/booking/page.tsx'));
    const web = rd(join(WEB_SRC, 'app/(homepage)/booking/page.tsx'));
    for (const bad of [/제한 없이 무료/, /주차장 무료/, /18:00~20:00/, /14:00~14:30/, /\d층:\s*로비/]) expect(app).not.toMatch(bad);
    // 챗봇 주차·면회·층별 안내 문장은 web 사본과 글자 단위로 같다(격리 빌드라 import 대신 대조)
    for (const line of ['주차 요금·할인(외래/입원 진료 시, 장애인·국가유공자 감면)은 안내 페이지에서 확인해 주세요.', '면회 시간과 인원 제한은 감염관리 상황에 따라 달라집니다.', '층별 시설 안내는 시설 안내 페이지에서 확인해 주세요.']) {
      expect(web, line).toContain(line);
      expect(app, line).toContain(line);
    }
  });

  it('⑤ 공개 사이트 앱 ClinicHoursNotice 사본이 web 정본과 같다', () => {
    const canon = readFileSync(join(WEB_SRC, 'components/homepage/ClinicHoursNotice.tsx'), 'utf8');
    const copy = readFileSync(join(HP_SRC, 'components/homepage/ClinicHoursNotice.tsx'), 'utf8');
    expect(copy).toBe(canon);
  });
});
