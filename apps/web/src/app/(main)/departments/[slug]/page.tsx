'use client';

import { T, Tf, Data } from '@/components/ui/i18n-text';

import { useState, useEffect } from 'react';
import { Unit } from '@/components/ui/display';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { sanitizeHtml } from '@/lib/sanitize';
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

interface DeptDetail {
  id: string;
  slug: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  tags: string[];
  imageUrl: string | null;
  updatedAt: string;
  doctors: DoctorProfile[];
}

export default function DepartmentDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [dept, setDept] = useState<DeptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiClient.get<{ data: DeptDetail }>(`/api/v1/public/departments/${slug}`)
      .then(res => setDept(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error || !dept) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400 text-lg"><T k="진료과 정보를 찾을 수 없습니다" /></p>
        <Link href="/departments" className="text-blue-600 text-sm mt-2 inline-block hover:underline">
          <T k="진료과 목록으로 돌아가기" />
        </Link>
      </div>
    );
  }

  const meta = dept.metadata;
  const specialties = (meta?.specialties as string[]) ?? [];
  const procedures = (meta?.procedures as string[]) ?? [];
  const equipment = (meta?.equipment as string[]) ?? [];
  const location = (meta?.location as string) ?? '';
  const phone = (meta?.phone as string) ?? '';
  const departmentName = (meta?.departmentName as string) ?? dept.title;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* 뒤로가기 + 헤더 */}
      <div>
        <Link href="/departments" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1 mb-3">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <T k="진료과 목록" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{dept.title}</h1>
        {(location || phone) && (
          <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-500">
            {location && (
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {location}
              </span>
            )}
            {phone && (
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {phone}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 소개 */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-3"><T k="진료과 소개" /></h2>
        {dept.content.includes('<') ? (
          <div className="prose prose-sm max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: sanitizeHtml(dept.content) }} />
        ) : (
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{dept.content}</div>
        )}
      </div>

      {/* 세부 전문분야 */}
      {specialties.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-3"><T k="세부 전문분야" /></h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {specialties.map(s => (
              <div key={s} className="flex items-center gap-2 p-2.5 bg-blue-50 border border-blue-100 rounded-xl">
                <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-xs font-medium text-blue-800">{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 주요 시술/수술 */}
      {procedures.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-3"><T k="주요 시술/수술" /></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {procedures.map(p => (
              <div key={p} className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                <span className="text-sm">🔹</span>
                <span className="text-xs font-medium text-amber-800">{p}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 보유 장비 */}
      {equipment.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-3"><T k="보유 장비" /></h2>
          <div className="flex flex-wrap gap-2">
            {equipment.map(e => (
              <span key={e} className="text-xs bg-gray-100 border border-gray-200 text-gray-700 px-3 py-1.5 rounded-full">{e}</span>
            ))}
          </div>
        </div>
      )}

      {/* 의료진 */}
      {dept.doctors.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900"><Tf k="의료진 ({수})" params={{ 수: <>{dept.doctors.length}<Unit>명</Unit></> }} /></h2>
            <Link href={`/doctors?department=${encodeURIComponent(departmentName)}`} className="text-xs text-blue-600 hover:underline">
              <T k="전체보기" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {dept.doctors.map(doc => (
              <Link
                key={doc.id}
                href={`/doctors/${doc.userId}`}
                className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-100 rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {doc.user.familyName?.charAt(0) ?? ''}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900">{doc.user.familyName}{doc.user.givenName}</p>
                  <p className="text-[11px] text-gray-500">{doc.position ? <Data>{doc.position}</Data> : <T k="전문의" />}</p>
                  {doc.user.specialty && (
                    <p className="text-[10px] text-blue-600 mt-0.5">{doc.user.specialty}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 예약 안내 */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white">
        <h3 className="text-lg font-bold mb-2"><T k="진료 예약" /></h3>
        <p className="text-sm text-blue-100 mb-4"><Tf k="{진료과} 진료 예약은 온라인 또는 전화로 가능합니다" params={{ 진료과: dept.title }} /></p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/booking"
            className="inline-flex items-center gap-2 bg-white text-blue-700 font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-blue-50 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <T k="온라인 예약" />
          </Link>
          {phone && (
            <a
              href={`tel:${phone.replace(/[^0-9-]/g, '')}`}
              className="inline-flex items-center gap-2 bg-white/20 text-white font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-white/30 transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              <T k="전화 예약" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
