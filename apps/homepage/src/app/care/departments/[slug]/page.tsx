import type { Metadata } from 'next';
import Link from 'next/link';
import { publicFetchResult } from '@/lib/public-fetch';
import { ContentRenderer } from '@/components/homepage/ContentRenderer';
import { DoctorAvatar } from '@/components/homepage/DoctorAvatar';
import { SITE_INFO, isDialable } from '@/lib/site-info';
import { getClinicHours } from '@/lib/clinic-hours';
import { DeptTabs } from './dept-tabs';

export const revalidate = 3600;

interface DoctorProfile {
  id: string; userId: string; position: string | null;
  education: string[]; career: string[]; certifications: string[];
  introduction: string | null; photoUrl: string | null; scheduleNote: string | null;
  user: { id: string; familyName: string; givenName: string; department: string; specialty: string | null };
}
interface DeptDetail {
  id: string; slug: string; title: string; content: string;
  metadata: Record<string, unknown>; tags: string[];
  imageUrl: string | null; updatedAt: string; doctors: DoctorProfile[];
}

async function getDept(slug: string) {
  return publicFetchResult<DeptDetail>(`/api/v1/public/departments/${slug}`, 3600);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = await getDept(slug);
  const dept = r.ok ? r.data : null;
  if (!dept) return { title: '진료과 소개' };
  const description = dept.content.replace(/<[^>]*>/g, '').slice(0, 160);
  return {
    title: dept.title,
    description,
    openGraph: { title: `${dept.title} | 위루비병원`, description, images: dept.imageUrl ? [dept.imageUrl] : [] },
  };
}

export default async function DepartmentDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // 🔴 W9: 병원 공통 진료시간은 CMS 정본에서 받아 탭으로 내린다(탭이 자기 상수를 갖지 않게)
  const [r, hospitalHours] = await Promise.all([getDept(slug), getClinicHours()]);
  const dept = r.ok ? r.data : null;
  // 🔴 조회 실패를 "찾을 수 없음"으로 말하지 않는다 — 없는 진료과(404·data null)와 불러오지 못한 것을 가른다
  if (!r.ok && r.reason === 'UNAVAILABLE') {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 text-lg">진료과 정보를 지금 불러오지 못했습니다</p>
        <p className="text-gray-400 text-sm mt-1">잠시 후 다시 확인해 주세요</p>
        <Link href="/care/departments" className="text-blue-600 text-sm mt-2 inline-block hover:underline">진료과 목록</Link>
      </div>
    );
  }

  if (!dept) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400 text-lg">진료과 정보를 찾을 수 없습니다</p>
        <Link href="/care/departments" className="text-blue-600 text-sm mt-2 inline-block hover:underline">진료과 목록</Link>
      </div>
    );
  }

  const meta = dept.metadata;
  const specialties = (meta?.specialties as string[]) ?? [];
  const procedures = (meta?.procedures as string[]) ?? [];
  const equipment = (meta?.equipment as string[]) ?? [];
  const diseases = (meta?.diseases as string[]) ?? [];
  const tests = (meta?.tests as string[]) ?? [];
  const highlights = (meta?.highlights as { title: string; desc: string }[]) ?? [];
  const schedule = meta?.schedule as { weekday?: string; saturday?: string; note?: string } | undefined;
  const location = (meta?.location as string) ?? '';
  const phone = (meta?.phone as string) ?? '';
  const departmentName = (meta?.departmentName as string) ?? dept.title;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MedicalClinic',
    name: dept.title,
    description: dept.content.replace(/<[^>]*>/g, '').slice(0, 300),
    parentOrganization: { '@type': 'Hospital', name: '위루비병원' },
    ...(location && { address: { '@type': 'PostalAddress', description: location } }),
    // 🔴 W9: telephone 에 "내선 2100" 을 그대로 실어 검색엔진에 걸 수 없는 번호를 배포했다.
    //    외부에서 걸 수 있는 번호만 선언한다(내선뿐이면 병원 대표전화).
    telephone: isDialable(phone) ? phone : SITE_INFO.phone,
    ...(specialties.length > 0 && { medicalSpecialty: specialties }),
    ...(dept.doctors.length > 0 && {
      employee: dept.doctors.map(d => ({
        '@type': 'Physician',
        name: `${d.user.familyName}${d.user.givenName}`,
        ...(d.user.specialty && { medicalSpecialty: d.user.specialty }),
        jobTitle: d.position ?? '전문의',
      })),
    }),
  };

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* ========== 히어로 배너 ========== */}
      <section className="relative bg-gradient-to-br from-gray-900 via-blue-900 to-blue-800 overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="w-full h-full" style={{ backgroundImage: 'radial-gradient(circle at 30% 40%, rgba(59,130,246,0.3) 0%, transparent 50%), radial-gradient(circle at 70% 60%, rgba(99,102,241,0.2) 0%, transparent 50%)' }} />
        </div>
        <div className="relative max-w-6xl mx-auto px-4 lg:px-8 py-12 lg:py-16">
          <Link href="/care/departments" className="text-sm text-blue-300 hover:text-white inline-flex items-center gap-1 mb-4 transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            진료과 목록
          </Link>
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <p className="text-blue-300 text-sm font-semibold uppercase tracking-wide mb-1">Department</p>
              <h1 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight">{dept.title}</h1>
              <p className="text-blue-200/70 mt-2 text-sm max-w-xl leading-relaxed">
                {dept.content.replace(/<[^>]*>/g, '').slice(0, 120)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {location && (
                <span className="text-xs bg-white/10 text-blue-200 px-3 py-1.5 rounded-full border border-white/10">
                  📍 {location}
                </span>
              )}
              {phone && (
                <span className="text-xs bg-white/10 text-blue-200 px-3 py-1.5 rounded-full border border-white/10">
                  📞 {phone}
                </span>
              )}
              <Link href={`/booking?dept=${encodeURIComponent(dept?.title ?? '')}`} className="text-xs bg-white text-blue-700 font-bold px-4 py-2 rounded-full hover:bg-blue-50 transition shadow">
                진료 예약
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ========== 탭 콘텐츠 ========== */}
      <DeptTabs
        content={dept.content}
        specialties={specialties}
        procedures={procedures}
        equipment={equipment}
        diseases={diseases}
        tests={tests}
        highlights={highlights}
        schedule={schedule}
        doctors={dept.doctors}
        departmentName={departmentName}
        phone={phone}
        hospitalHours={hospitalHours}
      />
    </div>
  );
}
