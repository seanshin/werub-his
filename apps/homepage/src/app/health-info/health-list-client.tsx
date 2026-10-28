'use client';

import { useState } from 'react';
import Link from 'next/link';

interface HealthItem {
  id: string; slug: string; title: string; content: string;
  metadata: { category?: string; season?: string; ageGroup?: string; source?: string };
  imageUrl: string | null; tags: string[]; isPinned: boolean; updatedAt: string;
}

const TAG_COLORS: Record<string, string> = {
  '심장': 'bg-red-50 text-red-700', '폐': 'bg-sky-50 text-sky-700',
  '소화기': 'bg-amber-50 text-amber-700', '당뇨': 'bg-orange-50 text-orange-700',
  '혈압': 'bg-rose-50 text-rose-700', '암': 'bg-purple-50 text-purple-700',
  '감염': 'bg-emerald-50 text-emerald-700', '피부': 'bg-pink-50 text-pink-700',
  '정신건강': 'bg-indigo-50 text-indigo-700', '운동': 'bg-green-50 text-green-700',
  '영양': 'bg-lime-50 text-lime-700', '수면': 'bg-violet-50 text-violet-700',
  '예방접종': 'bg-teal-50 text-teal-700', '여성': 'bg-pink-50 text-pink-700',
  '소아': 'bg-cyan-50 text-cyan-700', '노인': 'bg-gray-100 text-gray-700',
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function HealthListClient({ items }: { items: HealthItem[] }) {
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState('');

  const allTags = Array.from(new Set(items.flatMap(i => i.tags))).sort();

  const filtered = items.filter(i => {
    if (selectedTag && !i.tags.includes(selectedTag)) return false;
    if (search && !i.title.includes(search) && !i.content.includes(search) && !i.tags.some(t => t.includes(search))) return false;
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">건강정보</h1>
        <p className="text-sm text-gray-500 mt-1">질환별 건강 상식, 예방법, 생활 가이드를 안내합니다</p>
      </div>

      {/* 검색 + 태그 필터 */}
      <div className="space-y-3">
        <div className="relative max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="건강정보 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="건강정보 검색"
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="태그 필터">
            <button
              onClick={() => setSelectedTag('')}
              className={`text-xs px-2.5 py-1 rounded-full border transition whitespace-nowrap ${
                !selectedTag ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'
              }`}
            >
              전체
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
                className={`text-xs px-2.5 py-1 rounded-full border transition whitespace-nowrap ${
                  selectedTag === tag ? 'bg-blue-600 text-white border-blue-600' : `${TAG_COLORS[tag] ?? 'bg-gray-50 text-gray-600'} border-gray-200 hover:border-blue-300`
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 카드 목록 */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">등록된 건강정보가 없습니다</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" role="list">
          {filtered.map(item => (
            <article key={item.id} role="listitem">
              <Link
                href={`/health-info/${item.slug}`}
                className="block bg-white border border-gray-100 rounded-2xl overflow-hidden hover:shadow-md hover:border-blue-200 transition-shadow p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-gray-900 line-clamp-2">{item.title}</h3>
                  {item.isPinned && (
                    <span className="text-[10px] bg-yellow-400 text-yellow-900 px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0">추천</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-2 line-clamp-2">{item.content.replace(/<[^>]*>/g, '').slice(0, 120)}</p>
                <div className="flex items-center gap-2 mt-3">
                  {item.tags.slice(0, 3).map(tag => (
                    <span key={tag} className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${TAG_COLORS[tag] ?? 'bg-gray-100 text-gray-600'}`}>
                      {tag}
                    </span>
                  ))}
                  <span className="text-[10px] text-gray-400 ml-auto">{formatDate(item.updatedAt)}</span>
                </div>
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
