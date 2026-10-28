'use client';

import { T, Data } from '@/components/ui/i18n-text';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface DoctorDetail {
  id: string;
  userId: string;
  position: string | null;
  education: string[];
  career: string[];
  certifications: string[];
  research: string[];
  languages: string[];
  introduction: string | null;
  photoUrl: string | null;
  scheduleNote: string | null;
  user: {
    id: string;
    familyName: string;
    givenName: string;
    department: string;
    specialty: string | null;
    email: string;
  };
}

export default function DoctorDetailPage() {
  const params = useParams();
  const userId = params.userId as string;
  const [doctor, setDoctor] = useState<DoctorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiClient.get<{ data: DoctorDetail }>(`/api/v1/public/doctors/${userId}`)
      .then(res => setDoctor(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error || !doctor) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400 text-lg"><T k="의료진 정보를 찾을 수 없습니다" /></p>
        <Link href="/doctors" className="text-blue-600 text-sm mt-2 inline-block hover:underline">
          <T k="의료진 목록으로 돌아가기" />
        </Link>
      </div>
    );
  }

  const fullName = `${doctor.user.familyName}${doctor.user.givenName}`;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* 뒤로가기 */}
      <Link href="/doctors" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        <T k="의료진 목록" />
      </Link>

      {/* 프로필 헤더 */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-8">
          <div className="flex items-center gap-5">
            <div className="w-24 h-24 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-white font-bold text-3xl flex-shrink-0 border-2 border-white/30">
              {doctor.user.familyName?.charAt(0) ?? ''}
            </div>
            <div className="text-white">
              <h1 className="text-2xl font-bold">{fullName}</h1>
              <p className="text-blue-100 mt-1">{doctor.position ? <Data>{doctor.position}</Data> : <T k="전문의" />}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="text-xs bg-white/20 px-2.5 py-1 rounded-full">{doctor.user.department}</span>
                {doctor.user.specialty && (
                  <span className="text-xs bg-white/20 px-2.5 py-1 rounded-full">{doctor.user.specialty}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 진료 일정 */}
        {doctor.scheduleNote && (
          <div className="px-6 py-3 bg-blue-50 border-t border-blue-100 flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-blue-800 font-medium">{doctor.scheduleNote}</span>
          </div>
        )}
      </div>

      {/* 소개 */}
      {doctor.introduction && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-3"><T k="의사 소개" /></h2>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{doctor.introduction}</p>
        </div>
      )}

      {/* 경력 정보 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 학력 */}
        {doctor.education.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-2xl p-6">
            <h2 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center text-xs">🎓</span>
              <T k="학력" />
            </h2>
            <ul className="space-y-2">
              {doctor.education.map((e, i) => (
                <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 flex-shrink-0" />
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 경력 */}
        {doctor.career.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-2xl p-6">
            <h2 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-emerald-100 rounded-lg flex items-center justify-center text-xs">💼</span>
              <T k="경력" />
            </h2>
            <ul className="space-y-2">
              {doctor.career.map((c, i) => (
                <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 자격/인증 */}
      {doctor.certifications.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 bg-amber-100 rounded-lg flex items-center justify-center text-xs">📜</span>
            <T k="자격/인증" />
          </h2>
          <div className="flex flex-wrap gap-2">
            {doctor.certifications.map(c => (
              <span key={c} className="text-xs bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1.5 rounded-full whitespace-nowrap">{c}</span>
            ))}
          </div>
        </div>
      )}

      {/* 연구/논문 */}
      {doctor.research.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 bg-purple-100 rounded-lg flex items-center justify-center text-xs">📄</span>
            <T k="연구/논문" />
          </h2>
          <ul className="space-y-2">
            {doctor.research.map((r, i) => (
              <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                <span className="text-purple-400 flex-shrink-0">{i + 1}.</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 사용 언어 */}
      {doctor.languages.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 bg-cyan-100 rounded-lg flex items-center justify-center text-xs">🌐</span>
            <T k="진료 가능 언어" />
          </h2>
          <div className="flex flex-wrap gap-2">
            {doctor.languages.map(l => (
              <span key={l} className="text-xs bg-cyan-50 text-cyan-800 border border-cyan-200 px-3 py-1.5 rounded-full">{l}</span>
            ))}
          </div>
        </div>
      )}

      {/* 예약 안내 */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white">
        <h3 className="text-lg font-bold mb-2">{fullName} 선생님 진료 예약</h3>
        <p className="text-sm text-blue-100 mb-4"><T k="온라인 예약 또는 전화 예약이 가능합니다" /></p>
        <Link
          href="/booking"
          className="inline-flex items-center gap-2 bg-white text-blue-700 font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-blue-50 transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <T k="온라인 예약하기" />
        </Link>
      </div>
    </div>
  );
}
