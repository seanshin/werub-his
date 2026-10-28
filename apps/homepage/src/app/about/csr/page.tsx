'use client';

import { useState, useEffect } from 'react';
import { ContentRenderer } from '@/components/homepage/ContentRenderer';

interface CmsItem {
  id: string; slug: string; title: string; content: string;
  metadata: { subType?: string; date?: string; location?: string; participants?: number; thumbnailUrl?: string };
  imageUrl: string | null; tags: string[]; updatedAt: string;
}

const TYPE_ICON: Record<string, string> = {
  VOLUNTEER: '🤝', FREE_CLINIC: '🏥', EDUCATION: '📚', DONATION: '💝',
};

const TYPE_LABEL: Record<string, string> = {
  VOLUNTEER: '의료봉사', FREE_CLINIC: '무료진료', EDUCATION: '건강교육', DONATION: '나눔활동',
};

const TYPE_COLOR: Record<string, string> = {
  VOLUNTEER: 'bg-emerald-50 border-emerald-200',
  FREE_CLINIC: 'bg-blue-50 border-blue-200',
  EDUCATION: 'bg-amber-50 border-amber-200',
  DONATION: 'bg-pink-50 border-pink-200',
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function CsrPage() {
  const [items, setItems] = useState<CmsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/public/hospital-info?category=CSR')
      .then(r => r.json())
      .then(res => setItems(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10 space-y-8">
      {/* 헤더 */}
      <div className="text-center">
        <p className="text-teal-600 font-semibold text-sm tracking-wide uppercase mb-2">Social Responsibility</p>
        <h1 className="text-3xl font-extrabold text-gray-900">사회공헌</h1>
        <p className="text-gray-500 mt-3 text-sm max-w-lg mx-auto">위루비병원이 가상 지역사회와 함께하는 나눔과 봉사 활동을 소개합니다</p>
      </div>

      {/**
        * 🔴 **근거 없는 통계를 공개 사이트에 적지 않는다**(2026-09-02).
        *    종전엔 "500+ 연간 수혜자 · 2,400 누적 봉사시간 · 12 장학생 · 8 CSR 프로그램"이
        *    JSX 리터럴로 박혀 있었다 — CMS·DB 어디에서도 오지 않는 값이다.
        *    같은 저장소가 `about/page.tsx` 의 'KTAS 정확도 98.7%' 등 같은 형태를 이미 날조로 판정해
        *    철회했는데 이 축만 남아 있었다. 산출 근거가 생기면 CMS 항목으로 되살린다.
        */}

      {items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">등록된 사회공헌 활동이 없습니다</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {items.map(item => {
            const st = item.metadata?.subType ?? 'VOLUNTEER';
            const isOpen = expanded === item.id;
            return (
              <div key={item.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-lg transition-shadow">
                {/* 이미지 */}
                {item.imageUrl && (
                  <div className="h-44 overflow-hidden relative">
                    <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                    <span className={`absolute top-3 left-3 inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1 rounded-lg text-white ${
                      st === 'VOLUNTEER' ? 'bg-emerald-600' : st === 'FREE_CLINIC' ? 'bg-blue-600' : st === 'EDUCATION' ? 'bg-amber-600' : 'bg-pink-600'
                    }`}>
                      {TYPE_ICON[st] ?? '🤝'} {TYPE_LABEL[st] ?? st}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => setExpanded(isOpen ? null : item.id)}
                  className="w-full text-left p-5"
                >
                  <h3 className="text-base font-bold text-gray-900">{item.title}</h3>
                  <p className="text-xs text-gray-500 mt-2 line-clamp-2 leading-relaxed">{item.content.replace(/<[^>]*>/g, '').replace(/[■•\-]/g, '').slice(0, 120)}</p>
                  <div className="flex items-center gap-3 mt-3 text-[11px] text-gray-400">
                    {item.metadata?.date && <span>{formatDate(item.metadata.date)}</span>}
                    {item.metadata?.participants && <span>참여 {item.metadata.participants}명</span>}
                    <span className="ml-auto text-blue-500 font-medium">{isOpen ? '접기' : '자세히 →'}</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 border-t border-gray-100 pt-4">
                    <ContentRenderer content={item.content} className="text-sm text-gray-700" />
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
