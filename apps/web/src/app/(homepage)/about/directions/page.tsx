'use client';

import { useState, useEffect } from 'react';
import { ContentRenderer } from '@/components/homepage/ContentRenderer';

interface CmsItem {
  id: string; slug: string; title: string; content: string;
  metadata: Record<string, unknown>; tags: string[];
  imageUrl: string | null; updatedAt: string;
}

export default function DirectionsPage() {
  const [item, setItem] = useState<CmsItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/public/hospital-info?category=GENERAL')
      .then(r => r.json())
      .then(res => {
        const found = (res.data ?? []).find((i: CmsItem) => i.slug === 'directions');
        setItem(found ?? null);
      })
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

  const meta = (item?.metadata ?? {}) as Record<string, unknown>;
  const contactInfo = meta.contactInfo as Record<string, string> | undefined;
  const mapCoords = meta.mapCoords as { lat: number; lng: number } | undefined;

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">오시는 길</h1>
        <p className="text-sm text-gray-500 mt-1">위루비병원 방문 안내입니다</p>
      </div>

      {/* Google Maps */}
      <div className="bg-gray-100 border border-gray-200 rounded-2xl overflow-hidden">
        <iframe
          src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3335.0!2d126.510!3d33.253!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMzPCsDE1JzExLjAiTiAxMjbCsDMwJzM2LjAiRQ!5e0!3m2!1sko!2skr!4v1"
          className="w-full h-[400px]"
          title="위루비병원 위치"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      </div>

      {/* 네이버/카카오 지도 바로가기 */}
      <div className="flex flex-wrap gap-3">
        <a href="https://map.naver.com/v5/search/%EC%A0%9C%EC%A3%BC%20%EC%84%9C%EA%B7%80%ED%8F%AC%EC%8B%9C%20%EC%86%94%EC%98%A4%EB%A6%84%EB%A1%9C%20126" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 px-5 py-2.5 bg-green-500 text-white text-sm font-semibold rounded-xl hover:bg-green-600 transition shadow-sm">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
          네이버 지도
        </a>
        <a href="https://map.kakao.com/link/search/%EC%A0%9C%EC%A3%BC%20%EC%84%9C%EA%B7%80%ED%8F%AC%EC%8B%9C%20%EC%86%94%EC%98%A4%EB%A6%84%EB%A1%9C%20126" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 px-5 py-2.5 bg-yellow-400 text-gray-900 text-sm font-semibold rounded-xl hover:bg-yellow-500 transition shadow-sm">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c2.66 0 5.06 1.07 6.81 2.81L12 12.66 5.19 7.81A8.96 8.96 0 0112 5z"/></svg>
          카카오맵
        </a>
        <a href="https://www.google.com/maps/search/%EC%A0%9C%EC%A3%BC+%EC%84%9C%EA%B7%80%ED%8F%AC%EC%8B%9C+%EC%86%94%EC%98%A4%EB%A6%84%EB%A1%9C+126" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-xl hover:bg-blue-600 transition shadow-sm">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z"/></svg>
          Google Maps
        </a>
      </div>

      {/* 연락처 + 교통 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-4">연락처 및 주소</h2>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <div>
                <p className="font-medium text-gray-700">주소</p>
                <p className="text-gray-500">{contactInfo?.address ?? '가상특별자치도 가상시 가상로 126'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              <div>
                <p className="font-medium text-gray-700">대표전화</p>
                <p className="text-gray-500">{contactInfo?.phone ?? '02-000-0000'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
              </svg>
              <div>
                <p className="font-medium text-gray-700">서울사무소</p>
                <p className="text-gray-500">가상구 가상로 1 가상빌딩 5층</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-4">교통 안내</h2>
          <div className="space-y-4 text-sm">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-5 h-5 rounded-full bg-sky-500 text-white text-[10px] flex items-center justify-center font-bold">✈</span>
                <span className="font-medium text-gray-700">가상공항에서</span>
              </div>
              <p className="text-gray-500 ml-7">공항리무진 000번 → 가상관광단지 하차 → 택시 10분</p>
              <p className="text-gray-500 ml-7">약 50분 소요</p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center font-bold">B</span>
                <span className="font-medium text-gray-700">시외버스</span>
              </div>
              <p className="text-gray-500 ml-7">가상시외버스터미널에서 택시 15분</p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-5 h-5 rounded-full bg-gray-500 text-white text-[10px] flex items-center justify-center font-bold">P</span>
                <span className="font-medium text-gray-700">자가용</span>
              </div>
              <p className="text-gray-500 ml-7">가상공항에서 평화로(1135) 이용 약 45분</p>
              <p className="text-gray-500 ml-7">병원 주차장 무료 이용 가능</p>
            </div>
          </div>
        </div>
      </div>

      {/* CMS 추가 내용 */}
      {item && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <ContentRenderer content={item.content} className="text-sm text-gray-700" />
        </div>
      )}
    </div>
  );
}
