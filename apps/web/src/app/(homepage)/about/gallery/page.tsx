'use client';

import { useState, useEffect } from 'react';

interface GalleryItem {
  id: string; slug: string; title: string; content: string;
  metadata: { subType?: string; images?: { url: string; caption: string; order: number }[]; date?: string };
  imageUrl: string | null; tags: string[]; updatedAt: string;
}

const SUB_TYPES = [
  { value: '', label: '전체' },
  { value: 'FACILITY', label: '시설' },
  { value: 'EVENT', label: '행사' },
  { value: 'AWARD', label: '수상' },
  { value: 'CONSTRUCTION', label: '건축' },
];

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [lightbox, setLightbox] = useState<{ src: string; caption: string } | null>(null);

  useEffect(() => {
    fetch('/api/v1/public/hospital-info?category=GALLERY')
      .then(r => r.json())
      .then(res => setItems(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = items.filter(i => !filter || i.metadata?.subType === filter);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">갤러리</h1>
        <p className="text-sm text-gray-500 mt-1">위루비병원의 시설 및 주요 활동 사진입니다</p>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap gap-1.5">
        {SUB_TYPES.map(t => (
          <button
            key={t.value}
            onClick={() => setFilter(t.value)}
            className={`text-xs px-3 py-1.5 rounded-full border transition whitespace-nowrap ${
              filter === t.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 갤러리 그리드 */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">등록된 사진이 없습니다</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map(item => {
            const images = item.metadata?.images ?? [];
            const mainImage = item.imageUrl || (images.length > 0 ? images[0].url : null);

            return (
              <div key={item.id} className="group">
                <button
                  onClick={() => mainImage && setLightbox({ src: mainImage, caption: item.title })}
                  className="w-full aspect-square rounded-xl overflow-hidden bg-gray-100 border border-gray-200 relative"
                >
                  {mainImage ? (
                    <img src={mainImage} alt={item.title} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  {images.length > 1 && (
                    <span className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                      +{images.length - 1}
                    </span>
                  )}
                </button>
                <p className="text-xs font-medium text-gray-700 mt-2 line-clamp-1">{item.title}</p>
                {item.metadata?.date && (
                  <p className="text-[10px] text-gray-400">{item.metadata.date}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 라이트박스 */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="max-w-4xl max-h-[90vh] relative" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setLightbox(null)}
              className="absolute -top-10 right-0 text-white text-sm hover:text-gray-300"
            >
              닫기 &times;
            </button>
            <img src={lightbox.src} alt={lightbox.caption} className="max-w-full max-h-[80vh] rounded-xl object-contain" />
            <p className="text-white text-sm text-center mt-3">{lightbox.caption}</p>
          </div>
        </div>
      )}
    </div>
  );
}
