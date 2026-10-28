'use client';

import { T, Tf, Data } from '@/components/ui/i18n-text';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';

import { EmptyState } from '@/components/ui/display';

interface NewsItem {
  id: string;
  slug: string;
  title: string;
  content: string;
  metadata: { subType?: string; importance?: string; author?: string; sourceUrl?: string; thumbnailUrl?: string };
  imageUrl: string | null;
  tags: string[];
  isPinned: boolean;
  updatedAt: string;
}

const SUB_TYPES = [
  { value: '', label: '전체', icon: '📋' },
  { value: 'NOTICE', label: '공지사항', icon: '📢' },
  { value: 'PRESS', label: '언론보도', icon: '📰' },
  { value: 'EVENT', label: '행사/이벤트', icon: '🎉' },
  { value: 'AWARD', label: '수상/인증', icon: '🏆' },
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

export default function NewsPage() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [subType, setSubType] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const url = subType ? `/api/v1/public/news?subType=${subType}` : '/api/v1/public/news';
    apiClient.get<{ data: NewsItem[] }>(url)
      .then(res => setItems(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [subType]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="병원 소식" /></h1>
        {/* 🔴 배선하지 않는다 — 병원명이 문장에 박혀 있다(§12-C 병원명 하드코딩 축). 키로 등재하면
            기관명이 언어마다 복제돼 기관 정체성 정본과 갈린다. 그 축이 먼저다. */}
        <p className="text-sm text-gray-500 mt-1">위루비병원의 공지사항, 언론보도, 행사 소식을 안내합니다</p>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap gap-1.5">
        {SUB_TYPES.map(t => (
          <button
            key={t.value}
            onClick={() => setSubType(t.value)}
            className={`text-xs px-3 py-1.5 rounded-full border transition whitespace-nowrap ${
              subType === t.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
            }`}
          >
            {t.icon} <T k={t.label} />
          </button>
        ))}
      </div>

      {/* 목록 */}
      {items.length === 0 ? (
        <EmptyState icon="📋" title="등록된 소식이 없습니다" />
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            const st = item.metadata?.subType ?? 'NOTICE';
            const isOpen = expanded === item.id;

            return (
              <div key={item.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : item.id)}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition text-left"
                >
                  {item.isPinned && (
                    <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded font-bold whitespace-nowrap flex-shrink-0"><T k="중요" /></span>
                  )}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap flex-shrink-0 ${TYPE_BADGE[st] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                    {/* 🔴 미등록 유형은 서버 원문 그대로(지어내지 않는다) */}
                    {TYPE_LABEL[st] ? <T k={TYPE_LABEL[st]} /> : <Data>{st}</Data>}
                  </span>
                  <span className="text-sm font-medium text-gray-900 flex-1 truncate">{item.title}</span>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">{formatDate(item.updatedAt)}</span>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 border-t border-gray-50">
                    <div className="pt-4 text-sm text-gray-700 leading-relaxed whitespace-pre-line">{item.content}</div>
                    <div className="flex items-center gap-3 mt-4 text-[11px] text-gray-400">
                      {item.metadata?.author && <span><Tf k="작성: {작성자}" params={{ 작성자: String(item.metadata.author) }} /></span>}
                      {item.metadata?.sourceUrl && (
                        <a href={item.metadata.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                          <T k="원문 보기" />
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
