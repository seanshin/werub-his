'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ScrollReveal } from '@/components/homepage/ScrollReveal';

interface CmsItem {
  id: string; slug: string; title: string; content: string;
  imageUrl: string | null;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

const TYPE_ICON: Record<string, { icon: string; bg: string }> = {
  NOTICE: { icon: '📢', bg: 'bg-blue-500' },
  PRESS:  { icon: '📰', bg: 'bg-emerald-500' },
  EVENT:  { icon: '🎉', bg: 'bg-purple-500' },
  AWARD:  { icon: '🏆', bg: 'bg-amber-500' },
};

const PLACEHOLDER_IMAGES = [
  '/images/homepage/facilities/facility-operating-room.png',
  '/images/homepage/banners/banner-1.png',
  '/images/homepage/facilities/facility-lab.png',
  '/images/homepage/facilities/facility-mri.png',
  '/images/homepage/centers/center-cancer.png',
];

export function NewsSliderSection({ news }: { news: CmsItem[] }) {
  const [current, setCurrent] = useState(0);
  const items = news.slice(0, 6);
  const featured = items[current];
  const sideItems = items.filter((_, i) => i !== current).slice(0, 3);

  useEffect(() => {
    if (items.length <= 1) return;
    const timer = setInterval(() => setCurrent((prev: number) => (prev + 1) % items.length), 5000);
    return () => clearInterval(timer);
  }, [items.length]);

  if (!featured) return null;

  const getType = (item: CmsItem) => (item.metadata as Record<string, string>)?.subType || 'NOTICE';
  const getImage = (item: CmsItem, idx: number) => item.imageUrl || PLACEHOLDER_IMAGES[idx % PLACEHOLDER_IMAGES.length];

  return (
    <section className="py-12 lg:py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 lg:px-8">
        <ScrollReveal>
          <div className="flex items-end justify-between mb-6">
            <div>
              <p className="text-teal-600 font-semibold text-sm tracking-wide uppercase mb-1">News & Notice</p>
              <h2 className="text-2xl lg:text-3xl font-extrabold text-gray-900">소식/공지</h2>
            </div>
            <Link href="/news" className="text-sm text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1">
              전체보기 <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </Link>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* 좌측: 메인 슬라이더 (2칸) */}
          <div className="lg:col-span-2 relative">
            <div className="relative aspect-[16/10] rounded-2xl overflow-hidden bg-gray-100">
              <img
                src={getImage(featured, current)}
                alt={featured.title}
                className="w-full h-full object-cover transition-all duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

              {/* 유형 배지 */}
              <div className="absolute top-4 left-4">
                <span className={`inline-flex items-center gap-1.5 text-white text-xs font-bold px-3 py-1.5 rounded-lg ${TYPE_ICON[getType(featured)]?.bg || 'bg-blue-500'}`}>
                  {TYPE_ICON[getType(featured)]?.icon || '📢'} {getType(featured) === 'NOTICE' ? '공지' : getType(featured) === 'PRESS' ? '보도' : getType(featured) === 'EVENT' ? '행사' : '수상'}
                </span>
              </div>

              {/* 하단 텍스트 */}
              <div className="absolute bottom-0 left-0 right-0 p-6">
                <Link href={`/news/${featured.slug ?? featured.id}`} className="group">
                  <h3 className="text-white text-xl lg:text-2xl font-bold group-hover:underline leading-tight">{featured.title}</h3>
                  {featured.content && (
                    <p className="text-white/70 text-sm mt-2 line-clamp-2">{featured.content.slice(0, 120)}</p>
                  )}
                </Link>
              </div>

              {/* 인디케이터 */}
              <div className="absolute bottom-3 right-4 flex gap-1.5">
                {items.slice(0, 5).map((_, i) => (
                  <button key={i} onClick={() => setCurrent(i)}
                    className={`w-2 h-2 rounded-full transition-all ${i === current ? 'bg-white w-5' : 'bg-white/40'}`} />
                ))}
              </div>
            </div>

            {/* 좌우 화살표 */}
            {items.length > 1 && (
              <>
                <button onClick={() => setCurrent((prev: number) => (prev - 1 + items.length) % items.length)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/70 backdrop-blur-sm rounded-full shadow flex items-center justify-center text-gray-500 hover:text-gray-800 transition">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <button onClick={() => setCurrent((prev: number) => (prev + 1) % items.length)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/70 backdrop-blur-sm rounded-full shadow flex items-center justify-center text-gray-500 hover:text-gray-800 transition">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
              </>
            )}
          </div>

          {/* 우측: 카드 리스트 (1칸) */}
          <div className="flex flex-col gap-3">
            {sideItems.map((item, idx) => {
              const type = getType(item);
              const cfg = TYPE_ICON[type] || TYPE_ICON.NOTICE;
              return (
                <ScrollReveal key={item.id} delay={idx * 100}>
                  <Link
                    href={`/news/${item.slug ?? item.id}`}
                    className="group flex gap-3 p-3 rounded-xl border border-gray-100 hover:border-blue-200 hover:shadow-md transition-all bg-white"
                  >
                    {/* 썸네일 */}
                    <div className="flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden bg-gray-100">
                      <img
                        src={getImage(item, idx + 1)}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    {/* 텍스트 */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded w-fit ${cfg.bg} text-white mb-1.5`}>
                        {cfg.icon} {type === 'NOTICE' ? '공지' : type === 'PRESS' ? '보도' : type === 'EVENT' ? '행사' : '수상'}
                      </span>
                      <h4 className="text-sm font-bold text-gray-900 group-hover:text-blue-600 transition line-clamp-2 leading-snug">
                        {item.title}
                      </h4>
                      <p className="text-[11px] text-gray-400 mt-1 line-clamp-1">
                        {item.content?.slice(0, 50)}
                      </p>
                    </div>
                  </Link>
                </ScrollReveal>
              );
            })}

            {/* 전체보기 버튼 */}
            <Link href="/news" className="flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition mt-auto">
              소식 더보기
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
