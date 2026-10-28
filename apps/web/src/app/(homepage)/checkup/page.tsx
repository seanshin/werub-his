'use client';

import { useState, useEffect } from 'react';
import { Unit } from '@/components/ui/display';
import Link from 'next/link';
import { HOSPITAL_CONTACT } from '@/lib/hospital-contact';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { kstToday, kstTodayPlus } from '@/lib/kst-today';

const CATEGORY_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  BASIC: { label: '기본', color: 'text-blue-700', bg: 'bg-blue-100' },
  PLUS: { label: '플러스', color: 'text-sky-700', bg: 'bg-sky-100' },
  PRECISION: { label: '정밀', color: 'text-indigo-700', bg: 'bg-indigo-100' },
  PREMIUM: { label: '프리미엄', color: 'text-purple-700', bg: 'bg-purple-100' },
  PET_PRECISION: { label: 'PET', color: 'text-pink-700', bg: 'bg-pink-100' },
  SPECIAL: { label: '특화', color: 'text-teal-700', bg: 'bg-teal-100' },
};

const GENDER_LABELS: Record<string, string> = { MALE: '남성 전용', FEMALE: '여성 전용', ALL: '' };

interface Program {
  id: string; code: string; name: string; category: string;
  description?: string; gender: string; ageMin?: number; ageMax?: number;
  price: number; discountRate: number; duration: number;
  items: { name: string; category: string }[];
  options?: { id: string; name: string; price: number }[];
}

export default function CheckupPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [capacity, setCapacity] = useState<{ date: string; available: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false); // 조회 실패를 '프로그램 없음'과 구분
  const [filter, setFilter] = useState('');

  useEffect(() => {
    // 🔴 종전 /portal/checkup-* 는 클래스 가드에 걸려 무인증 홈페이지에서 항상 401 이었고
    //    `data ?? []` 가 실패를 빈 목록으로 번역해 프로그램이 개통 이래 비어 보였다 → 공개 EP 로.
    Promise.all([
      fetch('/api/v1/public/checkup-programs').then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch(`/api/v1/public/checkup-capacity?from=${kstToday()}&to=${kstTodayPlus(7)}`).then(r => (r.ok ? r.json() : { data: [] })),
    ]).then(([progRes, capRes]) => {
      setPrograms(progRes.data ?? []);
      setCapacity(capRes.data ?? []);
    }).catch(() => setLoadError(true)).finally(() => setLoading(false));
  }, []);

  const fmt = (n: number) => new Intl.NumberFormat('ko-KR').format(n);
  const weekAvailable = capacity.filter(c => (c as any).available > 0).length;

  const filtered = filter
    ? programs.filter(p => p.category === filter)
    : programs;

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10 space-y-8">
      {/* 히어로 */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-3xl p-8 lg:p-12 text-white">
        <h1 className="text-3xl lg:text-4xl font-bold">건강검진</h1>
        <p className="text-blue-100 mt-2 text-sm lg:text-base">
          종합건강검진, 국가검진, 기업단체검진 프로그램을 안내합니다
        </p>
        <div className="flex items-center gap-4 mt-6">
          <Link href="/portal?tab=health"
            className="px-6 py-3 bg-white text-blue-700 font-bold text-sm rounded-xl hover:bg-blue-50 transition shadow-lg">
            온라인 예약
          </Link>
          <Link href={`/booking?intent=${encodeURIComponent('건강검진을 받고 싶어요')}`}
            className="px-6 py-3 bg-white/20 text-white font-medium text-sm rounded-xl hover:bg-white/30 transition">
            {AI_ORIGIN_TEXT} 상담 예약
          </Link>
          {weekAvailable > 0 && (
            <span className="px-3 py-1.5 bg-white/20 text-white text-xs rounded-full font-medium">
              이번 주 잔여 {weekAvailable}일 예약 가능
            </span>
          )}
        </div>
      </div>

      {/* 카테고리 필터 */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
            !filter ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}>
          전체
        </button>
        {Object.entries(CATEGORY_LABELS).map(([key, { label }]) => (
          <button key={key} onClick={() => setFilter(filter === key ? '' : key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              filter === key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* 프로그램 카드 */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <div className="text-center py-16 text-sm text-gray-500">
          검진 프로그램 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(p => {
            const cat = CATEGORY_LABELS[p.category] ?? { label: p.category, color: 'text-gray-700', bg: 'bg-gray-100' };
            const discounted = p.discountRate > 0 ? Math.round(p.price * (1 - p.discountRate / 100)) : p.price;
            const items = Array.isArray(p.items) ? p.items : [];
            return (
              <div key={p.id} className="bg-white border border-gray-100 rounded-2xl p-6 hover:shadow-lg hover:border-blue-200 transition-all group">
                {/* 헤더 */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${cat.bg} ${cat.color}`}>{cat.label}</span>
                      {GENDER_LABELS[p.gender] && (
                        <span className="text-[10px] text-gray-400">{GENDER_LABELS[p.gender]}</span>
                      )}
                    </div>
                    <h3 className="text-lg font-bold text-gray-900">{p.name}</h3>
                  </div>
                  <div className="text-right">
                    {p.discountRate > 0 && (
                      <div className="text-xs text-gray-400 line-through">{fmt(p.price)}<Unit>원</Unit></div>
                    )}
                    <div className="text-xl font-bold text-blue-600">{fmt(discounted)}<span className="text-sm font-normal">원</span></div>
                  </div>
                </div>

                {/* 설명 */}
                {p.description && <p className="text-xs text-gray-500 line-clamp-2 mb-3">{p.description}</p>}

                {/* 검사 항목 태그 */}
                <div className="flex flex-wrap gap-1 mb-4">
                  {items.slice(0, 5).map((item, i) => (
                    <span key={i} className="px-2 py-0.5 bg-gray-50 text-gray-500 rounded text-[10px]">{item.name}</span>
                  ))}
                  {items.length > 5 && <span className="text-[10px] text-gray-400">+{items.length - 5}</span>}
                </div>

                {/* 소요시간 + 항목수 */}
                <div className="flex items-center justify-between text-xs text-gray-400 mb-4">
                  <span>{p.duration}<Unit>분</Unit> · {items.length}항목</span>
                  {p.ageMin && <span>{p.ageMin}세 이상</span>}
                </div>

                {/* 예약 CTA */}
                <Link href="/portal?tab=health"
                  className="block w-full text-center py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition opacity-0 group-hover:opacity-100">
                  온라인 예약
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* 하단 안내 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/checkup/process" className="bg-white border rounded-2xl p-5 hover:shadow-md transition">
          <div className="text-2xl mb-2">📋</div>
          <h3 className="font-bold text-gray-900">검진 절차</h3>
          <p className="text-xs text-gray-500 mt-1">예약부터 결과 수령까지 단계별 안내</p>
        </Link>
        <Link href="/checkup/faq" className="bg-white border rounded-2xl p-5 hover:shadow-md transition">
          <div className="text-2xl mb-2">❓</div>
          <h3 className="font-bold text-gray-900">자주 묻는 질문</h3>
          <p className="text-xs text-gray-500 mt-1">금식, 준비사항, 결과 안내</p>
        </Link>
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl p-5">
          <div className="text-2xl mb-2">📞</div>
          <h3 className="font-bold text-gray-900">전화 예약</h3>
          {/* 🔴 (2026-09-15 E1) 검진센터 운영시간·내선을 코드 상수로 박아 두던 자리 — 사실은 CMS(FAQ `faq-checkup-booking`·센터 `checkup-center`)에 있고
              병원이 바꿔도 이 카드는 옛 값을 말했다. 시각을 지어내지 않고 안내 페이지와 대표전화 정본으로 넘긴다. */}
          <p className="text-xs text-gray-600 mt-1">대표전화 {HOSPITAL_CONTACT.main}</p>
          <Link href="/checkup/faq" className="text-xs text-emerald-700 underline mt-0.5 inline-block">운영시간·전화 예약 안내</Link>
        </div>
      </div>
    </div>
  );
}
