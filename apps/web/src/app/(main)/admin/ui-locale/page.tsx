'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  RATIO_UNAVAILABLE,
  AREA_CATALOGS,
  CATALOG_LOCALES,
  CATALOG_LOCALE_LABEL,
  DEFERRED_LOCALES,
  type CatalogLocale,
  type UiLocale,
  type MessageCatalog,
} from '@hospital-run/shared';
import { T } from '@/components/ui/i18n-text';
import { ReviewerAssignPanel } from './reviewer-assign';
// COMMON_MESSAGES 는 shared index 미export — 카탈로그 파일 직접 참조(구조 집계만·내용 비의존)
// COMMON_MESSAGES 는 shared index 경유(딥 임포트 제거 — 오케스트레이터 정리)

/**
 * UI 크롬 언어 — 번역 검수 관제 (ui-locale-i18n.plan.md §2.6 · P1-E)
 *
 * 🔴 이 화면은 **현황 관측용**이다 — 기록≠적용. 검수·번역 반영은 전부 카탈로그 파일 커밋으로만
 *    남는다(화면에서 코드 정본을 쓰지 않는다). 서버 조회 없음 — 전부 shared 코드 상수 집계.
 * 🔴 분모 정직성: 여기의 "키 전집"은 **각 카탈로그 파일에 이미 등재된 키의 합집합**이다.
 *    화면 전체에서 번역이 필요한 키의 총수(각 영역 정본 — NAV_SECTIONS·*_LABEL — 의 크기)가 아니다.
 *    카탈로그가 비어 있으면 0 으로 "미채움"이라 말한다 — 100% 로 그리지 않는다.
 */

type Lang = CatalogLocale;
// 🔴 검수 관제는 **카탈로그 언어**를 센다 — 활성 축(3언어)뿐 아니라 별도 트랙으로 분리된
//    아랍어 자산도 함께 관측한다(선택지에 없다고 자산이 없는 것은 아니다 · 정본 §8).
const TARGET_LOCALES = CATALOG_LOCALES as readonly Lang[];
const DEFERRED = new Set<string>(DEFERRED_LOCALES);

interface AreaDef {
  code: string;
  label: string;
  file: string;
  catalog: MessageCatalog;
  /** null = VERIFIED 집합 자체가 파일에 아직 없음(전량 미검수 취급 — 그 사실을 표기) */
  verified: ReadonlySet<string> | null;
}

/**
 * 🔴 영역 목록은 **등록부 정본(`AREA_CATALOGS`)에서 파생한다** — 수기 배열이면 새 카탈로그가 통째로
 *    시야 밖이 된다. 2026-09-09 실측: 등록 카탈로그 29종인데 이 화면은 3종(common·nav·status)만 세고
 *    있었다 — 번역 관제 화면이 **자기 분모를 낡은 채로** 말하고 있었다(같은 라운드에 등록부 조립
 *    누락도 함께 나왔다 · 기획서 §9.3 "조립 누락은 조용하다").
 * 라벨은 영역 코드 그대로 쓴다 — 사람이 읽는 이름을 여기서 지어내면 카탈로그 파일명과 갈라진다.
 */
const AREAS: AreaDef[] = (AREA_CATALOGS as { area: string; c: MessageCatalog; v: ReadonlySet<string> }[]).map(({ area, c, v }) => ({
  code: area,
  label: area,
  file: `packages/shared/src/i18n/messages/${area}.ts`,
  catalog: c,
  // 🔴 빈 집합과 "집합 자체가 없음"은 다른 사실이다 — 등록부는 항상 집합을 주므로 크기 0 이면
  //    전량 미검수(AI_DRAFT)라는 뜻이고, 그것을 null 로 접지 않는다.
  verified: v as ReadonlySet<string>,
}));

interface LangStat {
  lang: Lang;
  enrolled: number; // 비어있지 않은 값으로 등재된 키
  empty: number; // 키는 있으나 값이 '' (자리만 잡힘 — 등재로 세지 않음)
  verified: number; // 등재 ∩ VERIFIED
  draft: number; // 등재 − 검수 = AI_DRAFT(미검수)
  missing: number; // 전집(합집합) − 등재
  verifiedOrphans: number; // VERIFIED 에는 있는데 이 언어 카탈로그에 미등재(불일치 신호)
}

interface AreaStat {
  def: AreaDef;
  unionSize: number; // 3언어 합집합 키 수 = 이 파일이 스스로 밝히는 범위
  langs: LangStat[];
  remaining: number; // Σ(초안 + 누락) — 워크리스트 정렬·"줄어드는" 수치
}

function computeArea(def: AreaDef): AreaStat {
  const union = new Set<string>();
  for (const lang of TARGET_LOCALES) {
    for (const [k, v] of Object.entries(def.catalog[lang] ?? {})) {
      if (v != null) union.add(k); // 빈값 자리도 "이 키가 대상"이라는 선언으로 본다
    }
  }
  const langs: LangStat[] = TARGET_LOCALES.map((lang) => {
    const entries = def.catalog[lang] ?? {};
    const enrolledKeys = Object.keys(entries).filter((k) => entries[k] != null && entries[k] !== '');
    const empty = Object.keys(entries).filter((k) => entries[k] === '').length;
    const verifiedSet = def.verified ?? new Set<string>();
    const verifiedCount = enrolledKeys.filter((k) => verifiedSet.has(k)).length;
    const verifiedOrphans = def.verified
      ? [...def.verified].filter((k) => !enrolledKeys.includes(k)).length
      : 0;
    return {
      lang,
      enrolled: enrolledKeys.length,
      empty,
      verified: verifiedCount,
      draft: enrolledKeys.length - verifiedCount,
      missing: union.size - enrolledKeys.length,
      verifiedOrphans,
    };
  });
  const remaining = langs.reduce((s, l) => s + l.draft + l.missing, 0);
  return { def, unionSize: union.size, langs, remaining };
}

export default function UiLocaleAdminPage() {
  const areas = useMemo(() => AREAS.map(computeArea), []);
  const totals = useMemo(() => {
    return TARGET_LOCALES.map((lang) => {
      let enrolled = 0;
      let verified = 0;
      let draft = 0;
      let missing = 0;
      for (const a of areas) {
        const l = a.langs.find((x) => x.lang === lang)!;
        enrolled += l.enrolled;
        verified += l.verified;
        draft += l.draft;
        missing += l.missing;
      }
      return { lang, enrolled, verified, draft, missing };
    });
  }, [areas]);
  const unionTotal = areas.reduce((s, a) => s + a.unionSize, 0);

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="UI 표기 언어 — 번역 검수 관제" /></h1>
        <p className="text-sm text-gray-500 mt-1">
          <T k="shared 메시지 카탈로그(공통·내비·상태)의 언어별 등재/검수/초안 현황. 서버 조회 없음 — 코드 상수 집계(배포 시점 기준)." />
        </p>
      </div>

      {/* 사람 검수 워크리스트로 — 이 화면은 현황(관측)이고, 실제 교정·판정은 그 화면에서 한다 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm text-blue-900">
          <T k="번역을 직접 읽고 고치고 '검수했다'를 남기려면 사람 검수 워크리스트로 갑니다(건별 승인 · 기록≠적용)." />
        </p>
        <Link
          href="/admin/ui-locale/review"
          className="min-h-[44px] inline-flex items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
        >
          <T k="언어팩 사람 검수" />
        </Link>
      </div>

      {/* 🔴 검수자 지정은 **이 화면**(ADMIN 전용)에 둔다 — 검수 워크리스트(`/review`)는 비관리자
          검수자에게도 열려 있어서, 거기에 두면 그 화면이 ADMIN 전용 EP(직원 목록·설정 쓰기)를
          부르는 모양이 된다(역할×EP 가드가 그 미스매치를 잡았다). 성격에 맞는 자리로 옮겼다. */}
      <ReviewerAssignPanel locale="en" isAdmin />

      {/* 기록≠적용 — 검수 반영 경로 안내 */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 space-y-1">
        <p className="font-semibold"><T k="이 화면은 현황 관측용입니다 — 화면에서 코드 정본을 쓰지 않습니다(기록≠적용)." /></p>
        <p>
          <span className="font-medium">검수 반영</span>: 카탈로그 파일의 <code className="font-mono text-xs bg-amber-100 px-1 rounded">VERIFIED</code> 집합에
          키를 추가하는 <span className="font-medium">커밋</span>으로 남습니다.
          <span className="font-medium ml-1">번역 초안 생성</span>:{' '}
          <code className="font-mono text-xs bg-amber-100 px-1 rounded">
            node scripts/i18n-draft.mjs &lt;메시지파일&gt; --locale en|ja|ar --base &lt;API&gt; --token &lt;JWT&gt;
          </code>{' '}
          — stdout 의 TS 조각을 사람이 검토 후 카탈로그 파일에 붙여넣습니다(스크립트는 파일을 쓰지 않음).
        </p>
      </div>

      {/* 언어별 총괄 — 줄어드는 워크리스트 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">
          <T k="언어별 잔여 작업" /> <span className="font-normal text-gray-400">(키 전집 {unionTotal} — 카탈로그 등재 키의 합집합·화면 전체 필요 키 총수가 아님)</span>
        </h2>
        {unionTotal === 0 ? (
          <p className="text-sm text-gray-500">
            <T k="카탈로그 미채움 — 세 영역 모두 등재 키 0. 등재(P1-A/B 커밋) 전에는 산출할 잔여가 없습니다(0% 도 100% 도 아님)." />
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {totals.map((t) => (
              <div key={t.lang} className="rounded-xl border border-gray-100 p-3">
                <div className="text-xs text-gray-500">{CATALOG_LOCALE_LABEL[t.lang]} ({t.lang}){DEFERRED.has(t.lang) ? ' · 별도 트랙(선택지 밖)' : ''}</div>
                <div className="mt-1 text-lg font-bold text-gray-900">
                  <T k="잔여" /> {t.draft + t.missing}
                  <span className="text-xs font-normal text-gray-400 ml-1">/ 전집 {unionTotal}</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  <T k="미검수 초안" /> {t.draft} · <T k="누락" /> {t.missing} · <T k="검수 완료" /> {t.verified}/{t.enrolled}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 영역별 상세 — 잔여 많은 순 */}
      {[...areas].sort((a, b) => b.remaining - a.remaining).map((a) => (
        <div key={a.def.code} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-baseline justify-between flex-wrap gap-1">
            <h2 className="text-sm font-semibold text-gray-800">
              <T k={a.def.label} />
              <span className="ml-2 text-xs font-normal text-gray-400 font-mono">{a.def.file}</span>
            </h2>
            {a.unionSize === 0 ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"><T k="카탈로그 미채움 (등재 0)" /></span>
            ) : (
              <span className="text-xs text-gray-500">키 전집 {a.unionSize} · 잔여 {a.remaining}</span>
            )}
          </div>
          {a.def.verified === null && (
            <p className="text-xs text-amber-700 mt-1">
              VERIFIED 집합 미도입(P0 수기 시드) — 검수 0 은 "검수 안 됨"이 아니라 <span className="font-medium">검수 기록 자리가 아직 없음</span>. 전량 미검수(AI_DRAFT 취급)로 집계.
            </p>
          )}
          {a.unionSize > 0 && (
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="py-1.5 pr-3 font-medium"><T k="언어" /></th>
                    <th className="py-1.5 pr-3 font-medium"><T k="등재 / 전집" /></th>
                    <th className="py-1.5 pr-3 font-medium"><T k="검수 / 등재" /></th>
                    <th className="py-1.5 pr-3 font-medium"><T k="미검수 초안" /></th>
                    <th className="py-1.5 pr-3 font-medium"><T k="누락" /></th>
                    <th className="py-1.5 font-medium"><T k="비고" /></th>
                  </tr>
                </thead>
                <tbody>
                  {a.langs.map((l) => (
                    <tr key={l.lang} className="border-b border-gray-50 last:border-0">
                      <td className="py-1.5 pr-3 text-gray-800">{CATALOG_LOCALE_LABEL[l.lang]} <span className="text-xs text-gray-400">({l.lang})</span>{DEFERRED.has(l.lang) && <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">별도 트랙</span>}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{l.enrolled} / {a.unionSize}</td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {l.enrolled === 0 ? <span className="text-gray-400">{RATIO_UNAVAILABLE} (등재 0)</span> : <>{l.verified} / {l.enrolled}</>}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">{l.draft > 0 ? <span className="text-amber-700 font-medium">{l.draft}</span> : l.enrolled === 0 ? <span className="text-gray-400">—</span> : 0}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{l.missing > 0 ? <span className="text-red-600 font-medium">{l.missing}</span> : 0}</td>
                      <td className="py-1.5 text-xs text-gray-500">
                        {l.empty > 0 && <span className="mr-2">빈값 자리 {l.empty}</span>}
                        {l.verifiedOrphans > 0 && <span className="text-red-600">검수 표기인데 미등재 {l.verifiedOrphans}건 (불일치)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {/* safetyCritical — 정직 표기 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h2 className="text-sm font-semibold text-gray-800"><T k="safetyCritical 분류" /></h2>
        <p className="text-sm text-gray-500 mt-1">
          미분류 (도입 예정) — 카탈로그에 안전중요(safetyCritical) 분류 필드가 아직 없어 이 화면은 해당 축을 세지 않습니다.
          분류 도입 전까지 "안전중요 키 전량 검수 완료" 같은 판정은 {RATIO_UNAVAILABLE}입니다.
        </p>
      </div>

      <p className="text-xs text-gray-400">
        집계 기준: 등재 = 카탈로그에 비어있지 않은 값으로 존재하는 키 · 검수 = 등재 ∩ VERIFIED · 미검수 초안 = 등재 − 검수 ·
        누락 = (3언어 합집합) − 등재. ko 는 원문 정본이라 카탈로그가 없습니다.
      </p>
    </div>
  );
}
