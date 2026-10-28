'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ContentRenderer } from '@/components/homepage/ContentRenderer';

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
  createdAt: string;
}

const TYPE_BADGE: Record<string, string> = {
  NOTICE: 'bg-blue-100 text-blue-800 border-blue-200',
  PRESS: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  EVENT: 'bg-purple-100 text-purple-800 border-purple-200',
  AWARD: 'bg-amber-100 text-amber-800 border-amber-200',
};

const TYPE_LABEL: Record<string, string> = {
  NOTICE: '공지사항', PRESS: '언론보도', EVENT: '행사/이벤트', AWARD: '수상/인증',
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function NewsDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [item, setItem] = useState<NewsItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/public/news')
      .then(r => r.json())
      .then(res => {
        const found = (res.data ?? []).find((n: NewsItem) => n.slug === slug);
        setItem(found ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400 text-lg">소식을 찾을 수 없습니다</p>
        <Link href="/news" className="text-blue-600 text-sm mt-2 inline-block hover:underline">목록으로 돌아가기</Link>
      </div>
    );
  }

  const st = item.metadata?.subType ?? 'NOTICE';

  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-8 py-10 space-y-6">
      {/* 뒤로가기 */}
      <Link href="/news" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        목록으로
      </Link>

      {/* 헤더 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-medium whitespace-nowrap ${TYPE_BADGE[st] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
            {TYPE_LABEL[st] ?? st}
          </span>
          {item.isPinned && (
            <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded font-bold whitespace-nowrap">중요</span>
          )}
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{item.title}</h1>
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
          <span>{formatDate(item.updatedAt)}</span>
          {item.metadata?.author && <span>작성: {item.metadata.author}</span>}
        </div>
      </div>

      {/* 이미지 */}
      {(item.imageUrl || item.metadata?.thumbnailUrl) && (
        <div className="rounded-2xl overflow-hidden border border-gray-100">
          <img
            src={item.imageUrl || item.metadata?.thumbnailUrl}
            alt={item.title}
            className="w-full h-auto max-h-[400px] object-cover"
          />
        </div>
      )}

      {/* 본문 */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6">
        <ContentRenderer content={item.content} className="text-sm text-gray-700 leading-relaxed" />
      </div>

      {/* 원문 링크 */}
      {item.metadata?.sourceUrl && (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
          <a href={item.metadata.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            원문 보기
          </a>
        </div>
      )}

      {/* 태그 */}
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.tags.map(tag => (
            <span key={tag} className="text-[11px] bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">#{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}
