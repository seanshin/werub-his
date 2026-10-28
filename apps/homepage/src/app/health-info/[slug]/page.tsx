'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ContentRenderer } from '@/components/homepage/ContentRenderer';

interface HealthItem {
  id: string;
  slug: string;
  title: string;
  content: string;
  metadata: { category?: string; season?: string; ageGroup?: string; source?: string };
  imageUrl: string | null;
  tags: string[];
  isPinned: boolean;
  updatedAt: string;
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

export default function HealthDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [item, setItem] = useState<HealthItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/public/health-info')
      .then(r => r.json())
      .then(res => {
        const found = (res.data ?? []).find((h: HealthItem) => h.slug === slug);
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
        <p className="text-gray-400 text-lg">건강정보를 찾을 수 없습니다</p>
        <Link href="/health-info" className="text-blue-600 text-sm mt-2 inline-block hover:underline">목록으로 돌아가기</Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-8 py-10 space-y-6">
      {/* 뒤로가기 */}
      <Link href="/health-info" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        목록으로
      </Link>

      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{item.title}</h1>
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
          <span>{formatDate(item.updatedAt)}</span>
          {item.metadata?.source && <span>출처: {item.metadata.source}</span>}
          {item.metadata?.ageGroup && <span>대상: {item.metadata.ageGroup}</span>}
        </div>
      </div>

      {/* 이미지 */}
      {item.imageUrl && (
        <div className="rounded-2xl overflow-hidden border border-gray-100">
          <img src={item.imageUrl} alt={item.title} className="w-full h-auto max-h-[400px] object-cover" />
        </div>
      )}

      {/* 본문 */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6">
        <ContentRenderer content={item.content} className="text-sm text-gray-700 leading-relaxed" />
      </div>

      {/* 태그 */}
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.tags.map(tag => (
            <Link
              key={tag}
              href={`/health-info?tag=${encodeURIComponent(tag)}`}
              className={`text-[11px] px-2.5 py-1 rounded-full hover:opacity-80 transition ${TAG_COLORS[tag] ?? 'bg-gray-100 text-gray-600'}`}
            >
              #{tag}
            </Link>
          ))}
        </div>
      )}

      {/* 관련 진료과 안내 */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
        <h3 className="text-sm font-bold text-blue-800 mb-2">진료 상담이 필요하신가요?</h3>
        <p className="text-xs text-blue-600 mb-3">정확한 진단과 치료를 위해 전문의 상담을 받아보세요</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/care/departments" className="text-xs bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
            진료과 안내
          </Link>
          <Link href="/booking" className="text-xs bg-white text-blue-600 border border-blue-200 px-4 py-2 rounded-lg hover:bg-blue-50 transition">
            진료 예약
          </Link>
        </div>
      </div>
    </div>
  );
}
