'use client';
import { T, Data, useTAttr } from '@/components/ui/i18n-text';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface DoctorProfile {
  id: string;
  userId: string;
  position: string | null;
  education: string[];
  career: string[];
  certifications: string[];
  introduction: string | null;
  photoUrl: string | null;
  scheduleNote: string | null;
  user: {
    id: string;
    familyName: string;
    givenName: string;
    department: string;
    specialty: string | null;
  };
}

const AVATAR_COLORS = [
  'from-blue-400 to-indigo-500',
  'from-emerald-400 to-teal-500',
  'from-purple-400 to-violet-500',
  'from-orange-400 to-red-500',
  'from-cyan-400 to-blue-500',
  'from-pink-400 to-rose-500',
];

function getAvatarColor(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

export default function DoctorsPage() {
  const tAttr = useTAttr();
  const searchParams = useSearchParams();
  const initialDept = searchParams.get('department') ?? '';

  const [doctors, setDoctors] = useState<DoctorProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDept, setSelectedDept] = useState(initialDept);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const url = selectedDept
      ? `/api/v1/public/doctors?department=${encodeURIComponent(selectedDept)}`
      : '/api/v1/public/doctors';
    apiClient.get<{ data: DoctorProfile[] }>(url)
      .then(res => setDoctors(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedDept]);

  const departments = useMemo(() => {
    const depts = new Set(doctors.map(d => d.user.department).filter(Boolean));
    return Array.from(depts).sort();
  }, [doctors]);

  const filtered = doctors.filter(d => {
    if (!search) return true;
    const name = `${d.user.familyName}${d.user.givenName}`;
    const spec = d.user.specialty ?? '';
    return name.includes(search) || spec.includes(search) || d.user.department.includes(search);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="의료진 소개" /></h1>
        {/* 🔴 배선하지 않는다 — 병원명이 문장에 박혀 있다(§12-C 병원명 하드코딩 축 · 118파일).
            키로 등재하면 기관명이 언어마다 복제돼 기관 정체성 정본과 갈린다. 그 축이 먼저다. */}
        <p className="text-sm text-gray-500 mt-1">위루비병원의 전문 의료진을 소개합니다</p>
      </div>

      {/* 필터 + 검색 */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* 진료과 필터 */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setSelectedDept('')}
            className={`text-xs px-3 py-1.5 rounded-full border transition whitespace-nowrap ${
              !selectedDept ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
            }`}
          >
            <T k="전체" />
          </button>
          {departments.map(dept => (
            <button
              key={dept}
              onClick={() => setSelectedDept(dept)}
              className={`text-xs px-3 py-1.5 rounded-full border transition whitespace-nowrap ${
                selectedDept === dept ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
              }`}
            >
              {dept}
            </button>
          ))}
        </div>

        {/* 검색 */}
        <div className="relative flex-shrink-0 sm:ml-auto">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder={tAttr('의사명/전공 검색...')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-56 pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* 의사 카드 */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg"><T k="의료진 정보가 없습니다" /></p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((doc, idx) => (
            <Link
              key={doc.id}
              href={`/doctors/${doc.userId}`}
              className="bg-white border border-gray-100 rounded-2xl p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
            >
              <div className="flex items-start gap-4">
                {/* 아바타 */}
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${getAvatarColor(idx)} flex items-center justify-center text-white font-bold text-xl flex-shrink-0`}>
                  {doc.user.familyName?.charAt(0) ?? ''}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-gray-900">
                    {doc.user.familyName}{doc.user.givenName}
                  </h3>
                  {/* 🔴 직위는 서버 값(데이터) · 폴백만 카탈로그 키 */}
                  <p className="text-xs text-gray-500 mt-0.5">{doc.position ? <Data>{doc.position}</Data> : <T k="전문의" />}</p>
                  <p className="text-xs text-blue-600 font-medium mt-0.5">{doc.user.department}</p>
                  {doc.user.specialty && (
                    <p className="text-[11px] text-gray-400 mt-0.5">{doc.user.specialty}</p>
                  )}
                </div>
              </div>

              {/* 주요 경력 */}
              {doc.certifications.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {doc.certifications.slice(0, 3).map(c => (
                    <span key={c} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full whitespace-nowrap">{c}</span>
                  ))}
                </div>
              )}

              {/* 진료 일정 */}
              {doc.scheduleNote && (
                <p className="text-[11px] text-gray-400 mt-3 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {doc.scheduleNote}
                </p>
              )}

              {/* 소개 한 줄 */}
              {doc.introduction && (
                <p className="text-xs text-gray-500 mt-2 line-clamp-2">{doc.introduction}</p>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* 총 의료진 수 */}
      <div className="text-center text-xs text-gray-400">
        총 {filtered.length}명의 의료진
      </div>
    </div>
  );
}
