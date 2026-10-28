'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { IconBox, PATHS } from '@/components/homepage/SvgIcon';

interface SearchResult {
  id: string; slug: string; title: string; content: string;
  category: string; tags: string[]; updatedAt: string;
}

const CATEGORY_INFO: Record<string, { label: string; iconName: keyof typeof PATHS; gradient: string; href: (slug: string) => string }> = {
  DEPARTMENT: { label: '진료과', iconName: 'stethoscope', gradient: 'from-blue-500 to-indigo-500', href: (s) => `/care/departments/${s}` },
  CENTER: { label: '전문센터', iconName: 'heart', gradient: 'from-rose-500 to-pink-500', href: (s) => `/care/centers/${s}` },
  GENERAL: { label: '병원안내', iconName: 'building', gradient: 'from-gray-500 to-slate-500', href: (s) => `/about/${s}` },
  FAQ: { label: 'FAQ', iconName: 'question', gradient: 'from-amber-500 to-orange-500', href: () => '/support/faq' },
  NEWS: { label: '소식', iconName: 'document', gradient: 'from-blue-500 to-sky-500', href: (s) => `/news/${s}` },
  HEALTH_INFO: { label: '건강정보', iconName: 'heart', gradient: 'from-emerald-500 to-teal-500', href: (s) => `/health-info/${s}` },
  RECRUIT: { label: '채용', iconName: 'user', gradient: 'from-indigo-500 to-violet-500', href: () => '/news/recruit' },
  CHECKUP_INFO: { label: '건강검진', iconName: 'clipboard', gradient: 'from-purple-500 to-violet-500', href: () => '/checkup' },
  PARKING: { label: '주차', iconName: 'building', gradient: 'from-gray-400 to-gray-500', href: () => '/guide/parking' },
  DINING: { label: '편의시설', iconName: 'building', gradient: 'from-pink-400 to-rose-500', href: () => '/guide/dining' },
  FUNERAL: { label: '장례식장', iconName: 'heart', gradient: 'from-gray-500 to-slate-600', href: () => '/guide/funeral' },
  CSR: { label: '사회공헌', iconName: 'heart', gradient: 'from-emerald-400 to-green-500', href: () => '/about/csr' },
  GALLERY: { label: '갤러리', iconName: 'photo', gradient: 'from-cyan-500 to-blue-500', href: () => '/about/gallery' },
  NON_COVERED: { label: '비급여', iconName: 'money', gradient: 'from-rose-500 to-pink-500', href: () => '/care/non-covered' },
  VOC: { label: '고객의 소리', iconName: 'chat', gradient: 'from-violet-500 to-purple-500', href: () => '/support/voc' },
  BANNER: { label: '배너', iconName: 'photo', gradient: 'from-sky-400 to-blue-500', href: () => '/home' },
  FACILITY: { label: '시설', iconName: 'building', gradient: 'from-teal-500 to-cyan-500', href: () => '/about/facility' },
};

// 카테고리 우선순위
const CATEGORY_ORDER = ['DEPARTMENT', 'CENTER', 'FAQ', 'NEWS', 'HEALTH_INFO', 'GENERAL', 'CHECKUP_INFO', 'RECRUIT', 'PARKING', 'DINING', 'FUNERAL', 'CSR', 'GALLERY', 'NON_COVERED', 'VOC', 'FACILITY', 'BANNER'];

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function SearchClient() {
  const searchParams = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(q);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (q) {
      setQuery(q);
      doSearch(q);
    }
  }, [q]);

  function doSearch(term: string) {
    if (!term.trim()) return;
    setLoading(true);
    setSearched(true);
    fetch(`/api/v1/public/hospital-info/search?q=${encodeURIComponent(term)}`)
      .then(res => res.json())
      .then(json => setResults(json.data ?? []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    doSearch(query);
  }

  // 카테고리별 그룹핑
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, item) => {
    const cat = item.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const sortedCategories = Object.keys(grouped).sort(
    (a, b) => (CATEGORY_ORDER.indexOf(a) === -1 ? 99 : CATEGORY_ORDER.indexOf(a)) - (CATEGORY_ORDER.indexOf(b) === -1 ? 99 : CATEGORY_ORDER.indexOf(b))
  );

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">통합 검색</h1>
        <p className="text-sm text-gray-500 mt-1">위루비병원 홈페이지의 모든 콘텐츠를 검색합니다</p>
      </div>

      {/* 검색 폼 */}
      <form onSubmit={handleSubmit} className="relative max-w-xl">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="검색어를 입력하세요 (예: 주차, 내과, 검진)"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full pl-12 pr-24 py-3.5 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          autoFocus
        />
        <button
          type="submit"
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-blue-600 text-white text-sm px-5 py-2 rounded-xl hover:bg-blue-700 transition"
        >
          검색
        </button>
      </form>

      {/* 결과 */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : searched && results.length === 0 ? (
        <div className="text-center py-16">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-gray-500 text-sm">&quot;{q || query}&quot;에 대한 검색 결과가 없습니다</p>
          <p className="text-gray-400 text-xs mt-1">다른 키워드로 검색해 보세요</p>
        </div>
      ) : (
        <>
          {searched && (
            <p className="text-sm text-gray-500">
              총 <span className="font-bold text-blue-600">{results.length}</span>건의 결과
            </p>
          )}
          <div className="space-y-8">
            {sortedCategories.map(cat => {
              const info = CATEGORY_INFO[cat] ?? { label: cat, icon: '📄', href: () => '#' };
              const catItems = grouped[cat];
              return (
                <div key={cat}>
                  <h2 className="text-base font-bold text-gray-900 flex items-center gap-2.5 mb-3">
                    <IconBox name={info.iconName} gradient={info.gradient} size="w-7 h-7" />
                    <span>{info.label}</span>
                    <span className="text-xs font-normal text-gray-400">({catItems.length})</span>
                  </h2>
                  <div className="space-y-2">
                    {catItems.map(item => (
                      <Link
                        key={item.id}
                        href={info.href(item.slug)}
                        className="block bg-white border border-gray-100 rounded-xl p-4 hover:border-blue-200 hover:shadow-sm transition"
                      >
                        <h3 className="text-sm font-medium text-gray-900">{item.title}</h3>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                          {item.content.replace(/<[^>]*>/g, '').slice(0, 150)}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          {item.tags.slice(0, 3).map(t => (
                            <span key={t} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{t}</span>
                          ))}
                          <span className="text-[10px] text-gray-400 ml-auto">{formatDate(item.updatedAt)}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
