/**
 * 실제 공개 사이트(apps/homepage · hospital.example.org) 진실성 가드 — W9
 *
 * ⚠️ `apps/web/src/app/(homepage)/**` 는 HIS 안의 사본이고, 방문자가 실제로 보는 것은 `apps/homepage` 다.
 *    두 곳에 같은 결함이 있으면 그것이 곧 정본이 둘(P12)이므로 양쪽 모두 가드한다.
 *    apps/homepage 에는 테스트 러너가 없어 여기(web vitest)에서 파일을 직접 읽어 검사한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseClinicHours } from '../../../homepage/src/lib/clinic-hours';
import { SITE_INFO, isDialable } from '../../../homepage/src/lib/site-info';

const SITE_ROOT = resolve(__dirname, '../../../homepage');
const SRC = join(SITE_ROOT, 'src');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(full) ? [full] : [];
  });
}

const sources = walk(SRC).map(f => ({ file: f.replace(SITE_ROOT + '/', ''), text: readFileSync(f, 'utf8') }));

/** 주석(원 결함 설명)은 검사 대상에서 뺀다 — 코드에 남은 값만 본다 */
function codeLines(text: string): string[] {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlocks.split('\n').filter(l => !l.trim().startsWith('//'));
}

describe('공개 사이트(apps/homepage) — 진료시간 정본', () => {
  it('SITE_INFO 에 진료시간 상수가 없다(정본은 CMS 하나 — 2026-09-15 T6)', () => {
    // 🔴 원 결함(P12→T6): SITE_INFO.hours 가 CMS 조회 실패 폴백으로 쓰였는데, 폴백을 구분해 그리는 화면이 0 이라 상수가 병원 사실로 나갔다.
    expect((SITE_INFO as Record<string, unknown>).hours).toBeUndefined();
  });

  it('옛 진료시간 문자열이 코드 어디에도 남아 있지 않다', () => {
    // 🔴 원 결함: Footer·care/departments·dept-tabs 가 SITE_INFO 를 두고도 각자 문자열을 박아 뒀다.
    const stale = [/09:00\s*[~-]\s*18:00/, /12:30\s*[~-]\s*14:00/, /08:30\s*[~-]\s*17:30/];
    const hits: string[] = [];
    for (const s of sources) {
      for (const line of codeLines(s.text)) {
        if (stale.some(re => re.test(line))) hits.push(`${s.file}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('CMS 본문에서 진료시간을 읽어낸다(정본이 DB 로 옮겨졌다)', () => {
    const cms = '<h3>외래 진료시간</h3><ul><li>평일: 09:00 ~ 17:30</li><li>토요일: 09:00 ~ 13:00 (일부 진료과)</li><li>점심시간: 12:30 ~ 13:30</li><li>일요일·공휴일 휴진 (응급실은 24시간 운영)</li></ul>';
    const h = parseClinicHours(cms);
    expect(h.source).toBe('cms');
    expect(h.weekday).toBe('09:00 ~ 17:30');
    expect(h.saturday).toBe('09:00 ~ 13:00');
    expect(h.lunch).toBe('12:30 ~ 13:30');
  });

  it('병원이 진료시간을 바꾸면 화면도 바뀐다(하절기 08:30~17:30 반영)', () => {
    // 🔴 원 결함: 진료시간이 코드에만 있어 병원이 시간을 바꿔도 공개 사이트가 옛 시간을 계속 말했다.
    const summer = '<ul><li>평일: 08:30 ~ 17:30</li><li>토요일: 08:30 ~ 12:30</li><li>점심시간: 12:00 ~ 13:00</li></ul>';
    const h = parseClinicHours(summer);
    expect(h.weekday).toBe('08:30 ~ 17:30');
    expect(h.saturday).toBe('08:30 ~ 12:30');
    expect(h.source).toBe('cms');
  });

  it('CMS 를 못 읽으면 상수로 채우지 않고 모른다고 밝힌다(T6)', () => {
    expect(parseClinicHours(null)).toEqual({ source: 'missing', weekday: null, saturday: null, lunch: null, closed: null });
    expect(parseClinicHours('형식이 완전히 다른 본문')).toEqual({ source: 'unparsed', weekday: null, saturday: null, lunch: null, closed: null });
  });

  it('평일만 못 읽어도 반쪽 정본을 만들지 않고, 본문에 없는 칸은 null 이다(T6)', () => {
    const broken = '<ul><li>토요일: 09:00 ~ 13:00</li></ul>';
    expect(parseClinicHours(broken).source).toBe('unparsed');
    const weekdayOnly = parseClinicHours('<ul><li>평일: 09:00 ~ 17:30</li></ul>');
    expect(weekdayOnly).toEqual({ source: 'cms', weekday: '09:00 ~ 17:30', saturday: null, lunch: null, closed: null });
  });
});

describe('공개 사이트(apps/homepage) — 전화번호', () => {
  it('내선 번호는 tel: 링크 대상이 아니다', () => {
    // 🔴 원 결함: 진료과 상세가 "내선 2100" → tel:2100 링크를 만들어 22개 중 21개 과의
    //    '전화 예약' 버튼이 아무 데도 걸리지 않았다.
    expect(isDialable('내선 2100')).toBe(false);
    expect(isDialable(SITE_INFO.phone)).toBe(true);
    expect(isDialable(SITE_INFO.emergencyPhone)).toBe(true);
    expect(isDialable('')).toBe(false);
    expect(isDialable(null)).toBe(false);
  });

  it('진료과 상세가 내선을 그대로 tel: 로 만들지 않는다', () => {
    const deptTabs = sources.find(s => s.file.endsWith('care/departments/[slug]/dept-tabs.tsx'))!;
    expect(deptTabs.text).toContain('isDialable');
    // 숫자만 뽑아 링크를 만들던 옛 코드가 남아 있으면 실패
    expect(codeLines(deptTabs.text).join('\n')).not.toContain("phone.replace(/[^0-9-]/g, '')");
  });
});

describe('공개 사이트(apps/homepage) — 하지 않은 일을 했다고 말하지 않기', () => {
  it('푸터에 동작하지 않는 뉴스레터 구독 폼이 없다', () => {
    // 🔴 원 결함(P16): 이메일 입력창 + '구독하기' 버튼이 있었지만 state·핸들러·API 가 전부 없었고
    //    버튼은 /support/voc 로 가는 링크였다. 방문자가 적은 이메일은 그대로 버려졌다.
    const footer = sources.find(s => s.file.endsWith('components/homepage/Footer.tsx'))!;
    const code = codeLines(footer.text).join('\n');
    expect(code).not.toMatch(/type="email"/);
    expect(code).not.toContain('구독하기');
  });

  it('근거 없는 의료광고 사전심의 번호를 싣지 않는다', () => {
    // 🔴 원 결함: "사전심의를 받았습니다 (심의번호: 제2026-가상-0042호)" 가 하드코딩돼 있었으나
    //    심의필증 근거가 저장소·DB 어디에도 없다(의료법 제56조 거짓·과장 광고 위험).
    const hits = sources.filter(s => codeLines(s.text).some(l => /심의번호/.test(l)));
    expect(hits.map(h => h.file)).toEqual([]);
  });
});

describe('공개 사이트(apps/homepage) — 관리 화면에 등록한 것이 방문자에게 보이는가', () => {
  it('히어로 슬라이더가 CMS 배너를 소비한다(하드코딩 배열 아님)', () => {
    // 🔴 원 결함: 이미지 5장이 하드코딩돼 CMS BANNER 3건(HERO 2·STRIP 1)의 소비자가 0이었다.
    //    관리 화면에는 '등록됨'으로 보이는데 방문자는 영원히 옛 이미지를 봤다 — 등록≠노출.
    const slider = sources.find(s => s.file.endsWith('components/homepage/HeroSlider.tsx'))!;
    expect(slider.text).toMatch(/banners\??\s*[:=]/);
    expect(slider.text).toContain('FALLBACK_IMAGES'); // 정적 이미지는 표본 없을 때만
  });

  it('홈이 BANNER 카테고리를 실제로 조회한다', () => {
    const home = sources.find(s => s.file.endsWith('app/home/page.tsx'))!;
    expect(home.text).toContain('category=BANNER');
    expect(home.text).toContain('HERO');
    expect(home.text).toContain('STRIP'); // 현재 유효한 하절기 진료시간 공지가 여기 들어 있다
  });
});
