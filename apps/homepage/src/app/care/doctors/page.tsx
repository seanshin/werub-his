import { publicFetchResult } from '@/lib/public-fetch';
import { PublicLoadFailed } from '@/components/homepage/PublicLoadFailed';
import { DoctorsListClient } from './doctors-list-client';

export const revalidate = 3600;

interface DoctorProfile {
  id: string; userId: string; position: string | null;
  education: string[]; career: string[]; certifications: string[];
  introduction: string | null; photoUrl: string | null; scheduleNote: string | null;
  user: { id: string; familyName: string; givenName: string; department: string; specialty: string | null };
}

export default async function DoctorsPage() {
  // 🔴 조회 실패를 "검색 결과가 없습니다"(총 0명)로 그리지 않는다
  const r = await publicFetchResult<DoctorProfile[]>('/api/v1/public/doctors', 3600);
  if (!r.ok) return <PublicLoadFailed what="의료진 목록" />;
  return <DoctorsListClient doctors={r.data ?? []} />;
}
