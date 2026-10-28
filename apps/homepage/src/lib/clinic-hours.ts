/* eslint-disable */
// 🔴 이 파일은 `apps/web/src/lib/clinic-hours.ts` 의 **기계 대조 사본**이다.
//    `apps/homepage` 는 격리 빌드(자체 npm install)라 web 을 참조할 수 없어 사본을 둔다.
//    정본은 apps/web 이며, 갈라지면 `apps/web/test/architecture/homepage-lib-copy-parity.spec.ts` 가 실패한다.
//    **여기를 직접 고치지 말 것** — 정본을 고치고 이 파일에 그대로 복사한다.
import { publicFetchResult } from './public-fetch';

/**
 * 외래 진료시간 정본 — CMS `GENERAL/operating-hours` 만 사실로 쓴다(W9 · 2026-09-15 T6).
 *
 * 🔴 원 결함(P12 → W9): 진료시간이 코드 상수 네 벌에 박혀 있어 CMS 에서 바꿔도 공개 사이트가 옛 시간을 말했다.
 * 🔴 두 번째 결함(2026-09-15 T6 · P1/P15): W9 가 CMS 를 읽게 했지만 **조회 실패·본문 형식 불일치 시 코드 상수를
 *    `source:'fallback'` 으로 돌려주고, 이를 구분해 그리는 화면이 0 이었다** — Footer·진료과 목록·진료과 상세·JSON-LD 가
 *    상수를 병원 사실로 방문자와 검색엔진에 내보냈다. 게다가 평일만 읽히면 `source:'cms'` 라 하면서
 *    토요일·점심·휴진을 상수로 채웠다(반쪽 정본). web `(homepage)` 는 아예 CMS 를 읽지 않고 상수만 썼다.
 *    → 상수를 없앤다. 모르면 모른다고 말한다:
 *      - `cms`         — CMS 본문에서 읽음. 본문에 없는 칸은 `null`(채우지 않는다)
 *      - `missing`     — CMS 에 진료시간 글이 없음(등록 안 됨)
 *      - `unparsed`    — 글은 있으나 평일 시간을 읽지 못함(형식이 바뀜 — 확인되지 않음)
 *      - `unavailable` — 공개 API 조회 실패(모름)
 *
 * 🔴 이 파일은 `apps/homepage/src/lib/clinic-hours.ts` 로 **기계 대조 사본**이 있다(homepage-lib-copy-parity).
 */

export type ClinicHoursSource = 'cms' | 'missing' | 'unparsed' | 'unavailable';

export interface ClinicHours {
  source: ClinicHoursSource;
  weekday: string | null;
  saturday: string | null;
  lunch: string | null;
  closed: string | null;
}

const EMPTY = (source: Exclude<ClinicHoursSource, 'cms'>): ClinicHours => ({ source, weekday: null, saturday: null, lunch: null, closed: null });

/** CMS 본문에서 "평일: 09:00 ~ 17:30" 같은 항목을 뽑는다. 못 찾으면 null — 억지로 맞추지 않는다. */
function pickHour(plain: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:：]?\\s*(\\d{1,2}:\\d{2}\\s*[~-]\\s*\\d{1,2}:\\d{2})`);
    const m = plain.match(re);
    if (m) return m[1].replace(/\s*[~-]\s*/, ' ~ ');
  }
  return null;
}

export function parseClinicHours(htmlContent: string | null | undefined): ClinicHours {
  if (!htmlContent || !htmlContent.trim()) return EMPTY('missing');
  const plain = htmlContent.replace(/<[^>]*>/g, '\n').replace(/&nbsp;/g, ' ');
  const weekday = pickHour(plain, ['평일']);
  // 평일 시간조차 못 읽으면 본문 형식이 바뀐 것 — 반쪽 정본을 만들지 않는다
  if (!weekday) return EMPTY('unparsed');
  return {
    source: 'cms',
    weekday,
    saturday: pickHour(plain, ['토요일', '토']),
    lunch: pickHour(plain, ['점심시간', '점심']),
    closed: /일요일\s*[·,]?\s*공휴일\s*휴진|일요일\/공휴일\s*휴진/.test(plain) ? '일요일·공휴일 휴진' : null,
  };
}

interface CmsItem { slug: string; content: string }

/** 서버 컴포넌트에서 호출 — ISR 캐시(기본 1시간). 조회 실패는 `unavailable`(없음으로 번역하지 않는다). */
export async function getClinicHours(revalidate = 3600): Promise<ClinicHours> {
  const r = await publicFetchResult<CmsItem[]>('/api/v1/public/hospital-info?category=GENERAL', revalidate);
  if (!r.ok) return EMPTY('unavailable');
  const doc = (r.data ?? []).find((i) => i.slug === 'operating-hours');
  return parseClinicHours(doc?.content);
}

/** CMS 에서 읽지 못했을 때 방문자에게 할 한 문장 — 연락처는 부르는 쪽 정본에서 붙인다 */
export function clinicHoursNotice(source: ClinicHoursSource): string | null {
  if (source === 'cms') return null;
  return source === 'unavailable' ? '진료시간을 불러오지 못했습니다' : '등록된 진료시간 없음';
}

/** 한 줄 표기 — CMS 에서 읽은 칸만. 읽지 못했으면 null */
export function hoursLineOf(h: ClinicHours): string | null {
  if (h.source !== 'cms') return null;
  return [
    h.weekday && `평일 ${h.weekday}`,
    h.saturday && `토요일 ${h.saturday}`,
    h.lunch && `점심시간 ${h.lunch}`,
    h.closed,
  ].filter(Boolean).join(' | ');
}

/** JSON-LD `OpeningHoursSpecification` 용 — "09:00 ~ 17:30" → { opens, closes } (못 읽으면 null) */
export function toIsoRange(range: string | null): { opens: string; closes: string } | null {
  const m = range?.match(/(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})/);
  return m ? { opens: m[1], closes: m[2] } : null;
}
