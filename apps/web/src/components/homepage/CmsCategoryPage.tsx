'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ContentRenderer } from './ContentRenderer';

interface CmsItem {
  id: string; slug: string; title: string; content: string;
  metadata: Record<string, unknown>; tags: string[];
  isPinned: boolean; imageUrl: string | null; updatedAt: string;
}

interface Props {
  category: string;
  pageTitle: string;
  pageDescription?: string;
  renderMode?: 'accordion' | 'cards' | 'list' | 'single';
  singleSlug?: string;
  /** 카드 클릭 시 이동할 상세 페이지 경로 (예: '/checkup') → /checkup/{slug} */
  detailBasePath?: string;
}

const CATEGORY_BANNER: Record<string, string> = {
  FACILITY: '/images/homepage/facilities/facility-lobby.png',
  CHECKUP_INFO: '/images/homepage/checkup/checkup-program.png',
  PARKING: '/images/homepage/guide/guide-parking.png',
  DINING: '/images/homepage/facilities/facility-cafeteria.png',
  DEPARTMENT: '/images/homepage/banners/banner-3.png',
  FAQ: '/images/homepage/guide/guide-reception.png',
  VOC: '/images/homepage/guide/guide-reception.png',
  GALLERY: '/images/homepage/facilities/facility-lobby.png',
  GENERAL: '/images/homepage/banners/banner-2.png',
};

const CATEGORY_COLOR: Record<string, { bg: string; accent: string; badge: string }> = {
  CHECKUP_INFO: { bg: 'from-emerald-50 to-teal-50', accent: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' },
  FAQ: { bg: 'from-blue-50 to-indigo-50', accent: 'text-blue-600', badge: 'bg-blue-100 text-blue-700' },
  FACILITY: { bg: 'from-sky-50 to-blue-50', accent: 'text-sky-600', badge: 'bg-sky-100 text-sky-700' },
  VOC: { bg: 'from-amber-50 to-orange-50', accent: 'text-amber-600', badge: 'bg-amber-100 text-amber-700' },
  GALLERY: { bg: 'from-violet-50 to-purple-50', accent: 'text-violet-600', badge: 'bg-violet-100 text-violet-700' },
};

const SLUG_IMAGES: Record<string, string> = {
  'checkup-process': '/images/homepage/checkup/checkup-process.png',
  'checkup-preparation': '/images/homepage/checkup/checkup-result.png',
  'checkup-program-a': '/images/homepage/checkup/checkup-program.png',
  'checkup-program-b': '/images/homepage/checkup/checkup-vip.png',
  'checkup-national': '/images/homepage/checkup/checkup-program.png',
  'checkup-corporate': '/images/homepage/checkup/checkup-vip.png',
};

export function CmsCategoryPage({ category, pageTitle, pageDescription, renderMode = 'accordion', singleSlug, detailBasePath }: Props) {
  const [items, setItems] = useState<CmsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/public/hospital-info?category=${category}`)
      .then(r => r.json())
      .then(res => {
        let data: CmsItem[] = res.data ?? [];
        if (singleSlug) data = data.filter(i => i.slug === singleSlug);
        setItems(data);
        // 첫 항목 자동 펼침 (accordion)
        if (data.length > 0 && renderMode === 'accordion') setExpanded(data[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [category, singleSlug, renderMode]);

  const colors = CATEGORY_COLOR[category] ?? { bg: 'from-gray-50 to-slate-50', accent: 'text-blue-600', badge: 'bg-blue-100 text-blue-700' };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  // 단일 콘텐츠
  if (renderMode === 'single' || (singleSlug && items.length === 1)) {
    const item = items[0];
    if (!item) return <div className="text-center py-20 text-gray-400">콘텐츠가 없습니다</div>;

    // 연혁(history) — 타임라인 렌더링
    const isHistory = singleSlug === 'history' || item.slug === 'history';
    if (isHistory) {
      return <HistoryTimeline title={item.title} content={item.content} />;
    }

    return (
      <div className="bg-gray-50/40 min-h-[60vh]">
        {/* 히어로 — 그라데이션 + 브레드크럼 */}
        <div className={`bg-gradient-to-br ${colors.bg}`}>
          <div className="max-w-4xl mx-auto px-4 lg:px-8 pt-9 pb-14">
            <nav className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
              <Link href="/" className="hover:text-gray-600 transition-colors">홈</Link>
              <span aria-hidden>·</span>
              <span className="text-gray-600 font-medium">{pageTitle}</span>
            </nav>
            <h1 className="text-[26px] lg:text-[32px] font-bold text-gray-900 tracking-tight">{pageTitle}</h1>
            {pageDescription && <p className="text-sm text-gray-500 mt-2.5 max-w-xl leading-relaxed">{pageDescription}</p>}
          </div>
        </div>

        {/* 본문 — 플로팅 카드 + 세련된 prose */}
        <div className="max-w-4xl mx-auto px-4 lg:px-8 -mt-7 pb-20">
          <div className="bg-white rounded-3xl border border-gray-100 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] p-6 lg:p-10">
            <ContentRenderer content={item.content} className="text-[14px] text-gray-600" />
          </div>
        </div>
      </div>
    );
  }

  const bannerSrc = CATEGORY_BANNER[category];

  return (
    <div>
      {/* 히어로 배너 */}
      {bannerSrc ? (
        <div className="relative h-52 lg:h-60 overflow-hidden">
          <img src={bannerSrc} alt={pageTitle} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
          <div className="absolute bottom-6 left-0 right-0">
            <div className="max-w-6xl mx-auto px-4 lg:px-8">
              <h1 className="text-2xl lg:text-3xl font-bold text-white drop-shadow-md">{pageTitle}</h1>
              {pageDescription && <p className="text-sm text-white/80 mt-1.5 max-w-lg">{pageDescription}</p>}
            </div>
          </div>
        </div>
      ) : (
        <div className={`bg-gradient-to-br ${colors.bg} py-12`}>
          <div className="max-w-6xl mx-auto px-4 lg:px-8">
            <h1 className="text-2xl lg:text-3xl font-extrabold text-gray-900">{pageTitle}</h1>
            {pageDescription && <p className="text-sm text-gray-500 mt-2">{pageDescription}</p>}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10">
        {items.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
            등록된 콘텐츠가 없습니다
          </div>

        ) : renderMode === 'cards' ? (
          /* ═══ 카드 모드 — 이미지 + 태그 + 펼침 ═══ */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {items.map((item, i) => {
              const imgSrc = SLUG_IMAGES[item.slug] || item.imageUrl;
              const isOpen = expanded === item.id;
              return (
                <div key={item.id} className="bg-white border border-gray-100 rounded-2xl overflow-hidden hover:shadow-lg transition-shadow duration-300 flex flex-col">
                  {imgSrc && (
                    <div className="h-36 overflow-hidden relative">
                      <img src={imgSrc} alt={item.title} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                    </div>
                  )}
                  <div className="p-5 flex-1 flex flex-col">
                    <div className="flex items-start gap-3 mb-2">
                      <span className={`w-7 h-7 rounded-lg ${colors.badge} flex items-center justify-center text-xs font-bold flex-shrink-0`}>{i + 1}</span>
                      <h3 className="text-sm font-bold text-gray-900 leading-snug">{item.title}</h3>
                    </div>
                    {item.isPinned && <span className="inline-block text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-bold mb-2 w-fit">추천</span>}
                    <p className="text-xs text-gray-500 leading-relaxed flex-1 line-clamp-3">
                      {item.content.replace(/<[^>]*>/g, '').slice(0, 120)}
                    </p>
                    {item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {item.tags.slice(0, 3).map(t => (
                          <span key={t} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${colors.badge}`}>{t}</span>
                        ))}
                      </div>
                    )}
                    {detailBasePath ? (
                      <Link href={`${detailBasePath}/${item.slug}`}
                        className={`mt-3 text-xs font-semibold ${colors.accent} hover:underline inline-flex items-center gap-1`}>
                        자세히 보기
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      </Link>
                    ) : (
                      <>
                        <button onClick={() => setExpanded(isOpen ? null : item.id)}
                          className={`mt-3 text-xs font-semibold ${colors.accent} hover:underline text-left`}>
                          {isOpen ? '접기' : '자세히 보기 →'}
                        </button>
                        {isOpen && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <ContentRenderer content={item.content} className="text-xs text-gray-700" />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

        ) : renderMode === 'list' ? (
          /* ═══ 리스트 모드 — 스텝 번호 + 이미지 ═══ */
          <div className="space-y-5">
            {items.map((item, i) => {
              const imgSrc = SLUG_IMAGES[item.slug] || item.imageUrl;
              return (
                <div key={item.id} className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex flex-col md:flex-row">
                    {imgSrc && (
                      <div className="md:w-56 h-40 md:h-auto flex-shrink-0 overflow-hidden">
                        <img src={imgSrc} alt={item.title} className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="p-5 lg:p-6 flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <span className={`w-8 h-8 rounded-full ${colors.badge} flex items-center justify-center text-sm font-bold flex-shrink-0`}>{i + 1}</span>
                        <h3 className="text-base font-bold text-gray-900">{item.title}</h3>
                      </div>
                      <ContentRenderer content={item.content} className="text-sm text-gray-700" />
                      {item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-4">
                          {item.tags.map(t => (
                            <span key={t} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${colors.badge}`}>{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

        ) : (
          /* ═══ 아코디언 모드 — 아이콘 + 열림 애니메이션 ═══ */
          <div className="space-y-3">
            {items.map((item, i) => {
              const isOpen = expanded === item.id;
              return (
                <div key={item.id} className={`border rounded-2xl overflow-hidden transition-all duration-300 ${isOpen ? 'border-blue-200 shadow-md bg-white' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : item.id)}
                    className="w-full flex items-center gap-4 px-5 py-4 text-left transition"
                  >
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 transition-colors ${isOpen ? 'bg-blue-600 text-white' : colors.badge}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-semibold transition-colors ${isOpen ? 'text-blue-700' : 'text-gray-900'}`}>{item.title}</span>
                      {!isOpen && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{item.content.replace(/<[^>]*>/g, '').slice(0, 80)}</p>}
                    </div>
                    {item.tags.length > 0 && !isOpen && (
                      <div className="hidden sm:flex gap-1">
                        {item.tags.slice(0, 2).map(t => (
                          <span key={t} className={`text-[9px] px-1.5 py-0.5 rounded-full ${colors.badge} whitespace-nowrap`}>{t}</span>
                        ))}
                      </div>
                    )}
                    <svg className={`w-5 h-5 text-gray-400 transition-transform duration-300 flex-shrink-0 ${isOpen ? 'rotate-180 text-blue-500' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                    <div className="px-5 pb-5 pt-2 ml-12">
                      <ContentRenderer content={item.content} className="text-sm text-gray-700 leading-relaxed" />
                      {item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-gray-100">
                          {item.tags.map(t => (
                            <span key={t} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${colors.badge}`}>{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 연혁 타임라인 컴포넌트 ──
const YEAR_COLORS = [
  { dot: 'bg-blue-500', ring: 'ring-blue-100', year: 'text-blue-600 bg-blue-50 border-blue-200', line: 'bg-blue-200' },
  { dot: 'bg-emerald-500', ring: 'ring-emerald-100', year: 'text-emerald-600 bg-emerald-50 border-emerald-200', line: 'bg-emerald-200' },
  { dot: 'bg-violet-500', ring: 'ring-violet-100', year: 'text-violet-600 bg-violet-50 border-violet-200', line: 'bg-violet-200' },
  { dot: 'bg-amber-500', ring: 'ring-amber-100', year: 'text-amber-600 bg-amber-50 border-amber-200', line: 'bg-amber-200' },
  { dot: 'bg-rose-500', ring: 'ring-rose-100', year: 'text-rose-600 bg-rose-50 border-rose-200', line: 'bg-rose-200' },
  { dot: 'bg-teal-500', ring: 'ring-teal-100', year: 'text-teal-600 bg-teal-50 border-teal-200', line: 'bg-teal-200' },
];

function HistoryTimeline({ title, content }: { title: string; content: string }) {
  // "2020년 3월 — 개원" 형태의 라인을 파싱
  const lines = content.split('\n').filter(l => l.trim());
  const entries: { year: string; month: string; desc: string }[] = [];

  for (const line of lines) {
    const match = line.match(/^(\d{4})년\s*(\d{1,2}월)?\s*[—\-–]\s*(.+)/);
    if (match) {
      entries.push({ year: match[1], month: match[2] || '', desc: match[3].trim() });
    }
  }

  // 연도별 그룹핑
  const grouped = new Map<string, { month: string; desc: string }[]>();
  entries.forEach(e => {
    const list = grouped.get(e.year) || [];
    list.push({ month: e.month, desc: e.desc });
    grouped.set(e.year, list);
  });

  const years = Array.from(grouped.entries()).sort((a, b) => Number(b[0]) - Number(a[0]));

  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-8 py-10">
      {/* 헤더 */}
      <div className="text-center mb-12">
        <p className="text-teal-600 font-semibold text-sm tracking-wide uppercase mb-2">History</p>
        <h1 className="text-3xl lg:text-4xl font-extrabold text-gray-900">{title}</h1>
        <p className="text-gray-500 mt-3 text-sm">위루비병원의 발자취</p>
      </div>

      {/* 타임라인 */}
      <div className="relative">
        {/* 중앙 수직선 */}
        <div className="absolute left-[120px] lg:left-[140px] top-0 bottom-0 w-0.5 bg-gray-200" />

        <div className="space-y-0">
          {years.map(([year, items], yi) => {
            const color = YEAR_COLORS[yi % YEAR_COLORS.length];
            return (
              <div key={year} className="relative">
                {/* 연도 배지 */}
                <div className="flex items-center gap-4 mb-4">
                  <div className={`w-[120px] lg:w-[140px] flex justify-end pr-4`}>
                    <span className={`inline-block text-lg font-extrabold px-4 py-1.5 rounded-full border ${color.year}`}>
                      {year}
                    </span>
                  </div>
                  <div className={`w-4 h-4 rounded-full ${color.dot} ring-4 ${color.ring} relative z-10`} />
                </div>

                {/* 항목 */}
                <div className="space-y-3 mb-8">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-4">
                      <div className="w-[120px] lg:w-[140px] text-right pr-4 pt-1 flex-shrink-0">
                        <span className="text-xs font-medium text-gray-400">{item.month}</span>
                      </div>
                      <div className="relative flex-shrink-0 w-4 flex justify-center pt-2">
                        <div className={`w-2 h-2 rounded-full ${color.dot} opacity-40`} />
                      </div>
                      <div className="flex-1 pb-1">
                        <p className="text-sm font-medium text-gray-800 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
