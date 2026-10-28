'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { cmsCategoryDef, cmsDisplayGaps, CMS_CATEGORIES } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface CategoryStat { category: string; count: number; gaps: number }

/**
 * 🔴 카테고리 → 편집 화면. **전용 화면이 있으면 전용 화면이 편집 정본**이다(구조화 폼·미충족 표시).
 *    종전엔 전용 화면 9개가 존재하는데 허브가 전부 `/admin/hospital-info?category=` 로 보내
 *    **전용 화면이 어디서도 도달 불가**였고, 같은 데이터의 편집 정본이 둘이었다.
 *    라벨·아이콘은 shared `CMS_CATEGORIES` 정본에서 가져온다(여기서 다시 적으면 갈라진다).
 */
const hrefFor = (category: string) =>
  cmsCategoryDef(category)?.adminHref ?? `/admin/hospital-info?category=${category}`;

const CAT_COLOR: Record<string, string> = {
  DEPARTMENT: 'bg-blue-50 text-blue-700', CENTER: 'bg-emerald-50 text-emerald-700',
  NEWS: 'bg-indigo-50 text-indigo-700', HEALTH_INFO: 'bg-teal-50 text-teal-700',
  HEALTH_VIDEO: 'bg-pink-50 text-pink-700', CHECKUP_INFO: 'bg-cyan-50 text-cyan-700',
  GALLERY: 'bg-violet-50 text-violet-700', CSR: 'bg-green-50 text-green-700',
  FAQ: 'bg-amber-50 text-amber-700', RECRUIT: 'bg-orange-50 text-orange-700',
  BANNER: 'bg-gray-50 text-gray-700', FACILITY: 'bg-sky-50 text-sky-700',
  NON_COVERED: 'bg-rose-50 text-rose-700', VOC: 'bg-yellow-50 text-yellow-700',
  GENERAL: 'bg-slate-50 text-slate-700',
};

const QUICK_LINKS = [
  { label: '전체 콘텐츠 조회', href: '/admin/hospital-info', icon: '🔎', desc: '카테고리 교차 검색' },
  { label: '배너 관리', href: '/admin/homepage/banners', icon: '🖼️', desc: '히어로/띠배너 관리' },
  { label: '공지/팝업', href: '/admin/homepage/popups', icon: '📢', desc: '팝업 생성 및 스케줄' },
  { label: '뉴스/소식', href: '/admin/homepage/news', icon: '📰', desc: '공지/보도/행사 작성' },
  { label: '갤러리', href: '/admin/homepage/gallery', icon: '📸', desc: '시설/행사 사진 등록' },
  { label: '미디어 라이브러리', href: '/admin/homepage/media', icon: '📁', desc: '이미지/파일 관리' },
];

export default function HomepageDashboardPage() {
  const tAttr = useTAttr();
  const [stats, setStats] = useState<CategoryStat[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  /** 🔴 조회 실패를 "콘텐츠 0건"으로 말하지 않는다(종전 `.catch(() => {})` 는 장애를 빈 병원으로 그렸다). */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revalidating, setRevalidating] = useState(false);

  /**
   * 🔴 (2026-09-15) '즉시 반영'은 **CMS 콘텐츠 캐시만** 갱신한다 — 코드 수정(예약 화면 등)은 새 빌드가 필요하다.
   *    종전엔 "완료 (8개 경로 갱신)"만 떠서 코드 변경도 반영된 것처럼 읽혔다(라이브는 6일 전 빌드였다).
   *    라이브 빌드 최신성을 같은 자리에서 말한다 — 조회 실패는 '낡음'이 아니라 '확인 불가'.
   */
  const [live, setLive] = useState<{ checked: boolean; fresh: boolean | null; detail: string } | null>(null);
  const [liveError, setLiveError] = useState(false);
  const loadLive = useCallback(() => {
    apiClient.get<{ data: { live?: { checked: boolean; fresh: boolean | null; detail: string } } }>('/api/v1/hospital-info/deploy-homepage/status')
      .then(r => { setLive(r.data?.live ?? null); setLiveError(false); })
      .catch(() => setLiveError(true));
  }, []);
  useEffect(() => { loadLive(); }, [loadLive]);

  const revalidateHomepage = async () => {
    if (revalidating) return;
    setRevalidating(true);
    try {
      const r = await apiClient.post<{ data: { revalidated?: string[] } }>('/api/v1/hospital-info/revalidate-homepage', {});
      const n = r.data?.revalidated?.length ?? 0;
      toast.success(`${tAttr('홈페이지 즉시 반영 완료')} (${n}개 경로 갱신)`);
      loadLive();
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? tAttr('즉시 반영 실패 — 홈페이지 연결/시크릿 확인'));
    } finally {
      setRevalidating(false);
    }
  };

  useEffect(() => {
    apiClient.get<{ data: any[] }>('/api/v1/hospital-info?limit=1000')
      .then(res => {
        const items = res.data ?? [];
        const map = new Map<string, { count: number; gaps: number }>();
        items.forEach((i: any) => {
          const cat = i.category ?? 'GENERAL';
          const e = map.get(cat) ?? { count: 0, gaps: 0 };
          e.count += 1;
          // 공개 화면이 읽는데 비어 있는 항목 — 정본 shared `cmsDisplayGaps`
          if (cmsDisplayGaps(cat, i).length > 0) e.gaps += 1;
          map.set(cat, e);
        });
        setStats(Array.from(map.entries()).map(([category, v]) => ({ category, ...v })).sort((a, b) => b.count - a.count));
        setTotal(items.length);
        setLoadError(null);
      })
      .catch((e: { message?: string }) => setLoadError(e?.message ?? tAttr('콘텐츠 목록을 불러오지 못했습니다')))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-7xl space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="홈페이지 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="홈페이지 콘텐츠를 관리합니다 — 배너, 공지, 뉴스, 진료과, 센터, 갤러리 등" /></p>
        </div>
        <button
          onClick={revalidateHomepage}
          disabled={revalidating}
          title={tAttr('콘텐츠 변경을 hospital.example.org에 즉시 반영(재빌드 없음·ISR 캐시 갱신)')}
          className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-white bg-emerald-600 rounded-xl px-3.5 py-2 hover:bg-emerald-700 disabled:opacity-50"
        >
          <T k={revalidating ? '반영 중…' : '🔄 홈페이지 즉시 반영'} />
        </button>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 flex items-start gap-2 flex-wrap">
        <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 shrink-0 ${
          liveError || !live || !live.checked || live.fresh === null ? 'bg-gray-100 text-gray-600' : live.fresh ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
          <T k={liveError ? '확인 불가' : !live ? '확인 중…' : !live.checked || live.fresh === null ? '확인 불가' : live.fresh ? '최신 빌드' : '낡은 빌드'} />
        </span>
        <p className="text-xs text-gray-600 flex-1 min-w-0">
          <T k="즉시 반영은 콘텐츠(글·사진·배너)만 갱신합니다. 코드·화면 수정은" />{' '}
          <Link href="/admin/homepage/deploy" className="underline font-medium"><T k="홈페이지 배포" /></Link>
          <T k="의 '빌드·발행'이 필요합니다." />
          {live && <span className="block text-[11px] text-gray-500 mt-0.5">{live.detail}</span>}
          {liveError && <span className="block text-[11px] text-gray-500 mt-0.5"><T k="라이브 빌드 상태를 불러오지 못했습니다 — 최신 여부를 판정하지 않습니다." /></span>}
        </p>
      </div>

      {loadError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900"><T k="콘텐츠 현황을 불러오지 못했습니다 —" /> <b><T k="콘텐츠가 없다는 뜻이 아닙니다." /></b></p>
          <p className="text-xs text-amber-800 mt-0.5">{loadError}</p>
        </div>
      )}

      {/* 요약 통계 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <div className="bg-white border border-gray-100 rounded-2xl p-5 text-center shadow-sm">
          <p className="text-3xl font-extrabold text-gray-900">{loadError ? '—' : total}</p>
          <p className="text-xs text-gray-500 mt-1"><T k={loadError ? '조회 실패' : '전체 콘텐츠'} /></p>
        </div>
        {stats.slice(0, 4).map(s => {
          const def = cmsCategoryDef(s.category);
          return (
            <Link key={s.category} href={hrefFor(s.category)} className="bg-white border border-gray-100 rounded-2xl p-5 text-center shadow-sm hover:shadow-md transition">
              <p className="text-2xl font-extrabold text-gray-900">{s.count}</p>
              <p className="text-xs text-gray-500 mt-1">{def?.icon ?? '📄'} <T k={def?.label ?? s.category} /></p>
            </Link>
          );
        })}
      </div>

      {/* 카테고리별 현황 */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
        <h2 className="text-sm font-bold text-gray-900 mb-4"><T k="카테고리별 현황" /></h2>
        {loading ? (
          <div className="h-20 bg-gray-50 rounded-xl animate-pulse" />
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-2">
            {stats.map(s => {
              const def = cmsCategoryDef(s.category);
              return (
                <Link key={s.category} href={hrefFor(s.category)}
                  title={def ? `${tAttr('공개 위치')}: ${def.publicPaths.join(' · ') || tAttr('확인되지 않음')}` : undefined}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border border-transparent hover:border-blue-200 hover:shadow transition ${CAT_COLOR[s.category] ?? 'bg-gray-50 text-gray-700'}`}>
                  <span className="text-lg">{def?.icon ?? '📄'}</span>
                  <span className="text-xs font-medium"><T k={def?.label ?? s.category} /></span>
                  <span className="text-lg font-bold">{s.count}</span>
                  {s.gaps > 0 && (
                    <span className="text-[9px] font-bold bg-amber-100 text-amber-800 px-1.5 rounded-full"><T k="보완" /> {s.gaps}</span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* 🔴 공개 화면이 읽는데 비어 있는 항목 — 분모와 함께 */}
      {!loading && !loadError && total > 0 && (() => {
        const gapTotal = stats.reduce((n, s) => n + s.gaps, 0);
        return (
          <div className={`rounded-2xl border px-4 py-3 ${gapTotal > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-100 bg-emerald-50'}`}>
            <p className={`text-sm font-semibold ${gapTotal > 0 ? 'text-amber-900' : 'text-emerald-800'}`}>
              {gapTotal > 0
                ? <><T k="공개 화면이 읽는 값이 비어 있는 콘텐츠" /> <b>{gapTotal}</b>/{total}<T k="건 — 그 자리는 폴백으로 그려집니다." /></>
                : <><T k="공개 표시에 필요한 값이 모두 채워져 있습니다 (" />{total}/{total}<T k="건)." /></>}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              <T k="카테고리별" /> <b><T k="보완 n" /></b> <T k="배지를 눌러 해당 편집 화면에서 확인하십시오. 값이 비어도 저장은 막지 않습니다." />
            </p>
          </div>
        );
      })()}

      {/* 빠른 편집 */}
      <div>
        <h2 className="text-sm font-bold text-gray-900 mb-3"><T k="빠른 편집" /></h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {QUICK_LINKS.map(link => (
            <Link key={link.href} href={link.href}
              className="bg-white border border-gray-100 rounded-2xl p-4 hover:shadow-md hover:border-blue-200 transition group">
              <span className="text-2xl">{link.icon}</span>
              <p className="text-sm font-bold text-gray-900 mt-2 group-hover:text-blue-600 transition"><T k={link.label} /></p>
              <p className="text-[10px] text-gray-400 mt-0.5"><T k={link.desc} /></p>
            </Link>
          ))}
        </div>
      </div>

      {/* 홈페이지 바로가기 */}
      <div className="flex gap-3 pt-4 border-t border-gray-100">
        <a href="/home" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
          <T k="홈페이지 열기" />
        </a>
        <Link href="/admin/hospital-info"
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition">
          <T k="병원 정보(CMS) 전체" />
        </Link>
      </div>
    </div>
  );
}
