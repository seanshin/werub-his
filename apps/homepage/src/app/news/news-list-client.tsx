'use client';

import { useState } from 'react';
import Link from 'next/link';

interface NewsItem {
  id: string; slug: string; title: string; content: string;
  metadata: { subType?: string; importance?: string; author?: string; sourceUrl?: string; thumbnailUrl?: string };
  imageUrl: string | null; tags: string[]; isPinned: boolean; updatedAt: string;
}

const SUB_TYPES = [
  { value: '', label: '전체' },
  { value: 'NOTICE', label: '공지사항' },
  { value: 'PRESS', label: '언론보도' },
  { value: 'EVENT', label: '행사/이벤트' },
  { value: 'AWARD', label: '수상/인증' },
];

const TYPE_BADGE: Record<string, string> = {
  NOTICE: 'bg-blue-100 text-blue-800 border-blue-200',
  PRESS: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  EVENT: 'bg-purple-100 text-purple-800 border-purple-200',
  AWARD: 'bg-amber-100 text-amber-800 border-amber-200',
};

const TYPE_LABEL: Record<string, string> = {
  NOTICE: '공지', PRESS: '보도', EVENT: '행사', AWARD: '수상',
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function NewsListClient({ items, initialType }: { items: NewsItem[]; initialType?: string }) {
  const [subType, setSubType] = useState(initialType ?? '');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = subType ? items.filter(i => i.metadata?.subType === subType) : items;

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">병원 소식</h1>
        <p className="text-sm text-gray-500 mt-1">위루비병원의 공지사항, 언론보도, 행사 소식을 안내합니다</p>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="소식 유형 필터">
        {SUB_TYPES.map(t => (
          <button
            key={t.value}
            onClick={() => setSubType(t.value)}
            role="tab"
            aria-selected={subType === t.value}
            className={`text-xs px-3 py-1.5 rounded-full border transition whitespace-nowrap ${
              subType === t.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">등록된 소식이 없습니다</div>
      ) : (
        <div className="space-y-2" role="list">
          {filtered.map(item => {
            const st = item.metadata?.subType ?? 'NOTICE';
            const isOpen = expanded === item.id;

            return (
              <article key={item.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden" role="listitem">
                <button
                  onClick={() => setExpanded(isOpen ? null : item.id)}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition text-left"
                  aria-expanded={isOpen}
                >
                  {item.isPinned && (
                    <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded font-bold whitespace-nowrap flex-shrink-0">중요</span>
                  )}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap flex-shrink-0 ${TYPE_BADGE[st] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                    {TYPE_LABEL[st] ?? st}
                  </span>
                  <span className="text-sm font-medium text-gray-900 flex-1 truncate">{item.title}</span>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">{formatDate(item.updatedAt)}</span>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isOpen && item.slug && (
                  <div className="px-5 pb-1 flex justify-end">
                    <Link href={`/news/${item.slug}`} className="text-[11px] text-blue-500 hover:underline">상세 보기 &rarr;</Link>
                  </div>
                )}
                {isOpen && (
                  <div className="px-5 pb-5 border-t border-gray-50">
                    <div className="pt-4 text-sm text-gray-700 leading-relaxed whitespace-pre-line">{item.content}</div>
                    <div className="flex items-center gap-3 mt-4 text-[11px] text-gray-400">
                      {item.metadata?.author && <span>작성: {item.metadata.author}</span>}
                      {item.metadata?.sourceUrl && (
                        <a href={item.metadata.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                          원문 보기
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
