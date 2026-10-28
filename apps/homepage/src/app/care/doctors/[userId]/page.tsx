import type { Metadata } from 'next';
import Link from 'next/link';
import { publicFetchResult } from '@/lib/public-fetch';
import { DoctorAvatar } from '@/components/homepage/DoctorAvatar';

export const revalidate = 3600;

interface DoctorDetail {
  id: string; userId: string; position: string | null;
  education: string[]; career: string[]; certifications: string[];
  research: string[]; languages: string[]; introduction: string | null;
  photoUrl: string | null; scheduleNote: string | null;
  user: { id: string; familyName: string; givenName: string; department: string; specialty: string | null; email: string };
}

async function getDoctor(userId: string) {
  return publicFetchResult<DoctorDetail>(`/api/v1/public/doctors/${userId}`, 3600);
}

export async function generateMetadata({ params }: { params: Promise<{ userId: string }> }): Promise<Metadata> {
  const { userId } = await params;
  const r0 = await getDoctor(userId);
  const doc = r0.ok ? r0.data : null;
  if (!doc) return { title: '의료진 소개' };
  const name = `${doc.user.familyName}${doc.user.givenName}`;
  const desc = `${name} ${doc.position ?? '전문의'} — ${doc.user.department}${doc.user.specialty ? `, ${doc.user.specialty}` : ''}`;
  return {
    title: `${name} ${doc.position ?? '전문의'}`,
    description: desc,
    openGraph: { title: `${name} | 위루비병원`, description: desc },
  };
}

export default async function DoctorDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const r = await getDoctor(userId);
  const doctor = r.ok ? r.data : null;
  // 🔴 조회 실패를 "찾을 수 없음"으로 말하지 않는다 — 없는 의료진(404·data null)과 불러오지 못한 것을 가른다
  if (!r.ok && r.reason === 'UNAVAILABLE') {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 text-lg">의료진 정보를 지금 불러오지 못했습니다</p>
        <p className="text-gray-400 text-sm mt-1">잠시 후 다시 확인해 주세요</p>
        <Link href="/care/doctors" className="text-blue-600 text-sm mt-2 inline-block hover:underline">의료진 목록으로 돌아가기</Link>
      </div>
    );
  }

  if (!doctor) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400 text-lg">의료진 정보를 찾을 수 없습니다</p>
        <Link href="/care/doctors" className="text-blue-600 text-sm mt-2 inline-block hover:underline">의료진 목록으로 돌아가기</Link>
      </div>
    );
  }

  const fullName = `${doctor.user.familyName}${doctor.user.givenName}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Physician',
    name: fullName,
    jobTitle: doctor.position ?? '전문의',
    medicalSpecialty: doctor.user.specialty ?? doctor.user.department,
    worksFor: { '@type': 'Hospital', name: '위루비병원' },
    ...(doctor.education.length > 0 && { alumniOf: doctor.education.map(e => ({ '@type': 'EducationalOrganization', name: e })) }),
    ...(doctor.certifications.length > 0 && { hasCredential: doctor.certifications.map(c => ({ '@type': 'EducationalOccupationalCredential', credentialCategory: c })) }),
  };

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10 space-y-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Link href="/care/doctors" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        의료진 목록
      </Link>

      {/* 프로필 헤더 */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-8">
          <div className="flex items-center gap-5">
            <div className="w-24 h-24 rounded-2xl overflow-hidden bg-white/20 backdrop-blur flex-shrink-0 border-2 border-white/30">
              {doctor.photoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={doctor.photoUrl} alt={fullName} className="w-full h-full object-cover" />
                : <DoctorAvatar name={fullName} size={96} />}
            </div>
            <div className="text-white">
              <h1 className="text-2xl font-bold">{fullName}</h1>
              <p className="text-blue-100 mt-1">{doctor.position ?? '전문의'}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="text-xs bg-white/20 px-2.5 py-1 rounded-full">{doctor.user.department}</span>
                {doctor.user.specialty && <span className="text-xs bg-white/20 px-2.5 py-1 rounded-full">{doctor.user.specialty}</span>}
              </div>
            </div>
          </div>
        </div>
        {doctor.scheduleNote && (
          <div className="px-6 py-3 bg-blue-50 border-t border-blue-100 flex items-center gap-2">
            <span className="text-sm text-blue-800 font-medium">🕐 {doctor.scheduleNote}</span>
          </div>
        )}
      </div>

      {doctor.introduction && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-3">의사 소개</h2>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{doctor.introduction}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {doctor.education.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-2xl p-6">
            <h2 className="text-base font-bold text-gray-900 mb-3">🎓 학력</h2>
            <ul className="space-y-2">
              {doctor.education.map((e, i) => (
                <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 flex-shrink-0" />{e}
                </li>
              ))}
            </ul>
          </div>
        )}
        {doctor.career.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-2xl p-6">
            <h2 className="text-base font-bold text-gray-900 mb-3">💼 경력</h2>
            <ul className="space-y-2">
              {doctor.career.map((c, i) => (
                <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />{c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {doctor.certifications.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-3">📜 자격/인증</h2>
          <div className="flex flex-wrap gap-2">
            {doctor.certifications.map(c => (
              <span key={c} className="text-xs bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1.5 rounded-full whitespace-nowrap">{c}</span>
            ))}
          </div>
        </div>
      )}

      {doctor.research.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-3">📄 연구/논문</h2>
          <ul className="space-y-2">
            {doctor.research.map((r, i) => (
              <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                <span className="text-purple-400 flex-shrink-0">{i + 1}.</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {doctor.languages.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <h2 className="text-base font-bold text-gray-900 mb-3">🌐 진료 가능 언어</h2>
          <div className="flex flex-wrap gap-2">
            {doctor.languages.map(l => (
              <span key={l} className="text-xs bg-cyan-50 text-cyan-800 border border-cyan-200 px-3 py-1.5 rounded-full">{l}</span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white">
        <h3 className="text-lg font-bold mb-2">{fullName} 선생님 진료 예약</h3>
        <p className="text-sm text-blue-100 mb-4">온라인 예약 또는 전화 예약이 가능합니다</p>
        <Link href="/booking" className="inline-flex items-center gap-2 bg-white text-blue-700 font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-blue-50 transition">
          📅 온라인 예약하기
        </Link>
      </div>
    </div>
  );
}
