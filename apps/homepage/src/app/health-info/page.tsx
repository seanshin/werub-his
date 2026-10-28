import { publicFetchResult } from '@/lib/public-fetch';
import { PublicLoadFailed } from '@/components/homepage/PublicLoadFailed';
import { HealthListClient } from './health-list-client';

export const revalidate = 3600;

interface HealthItem {
  id: string; slug: string; title: string; content: string;
  metadata: { category?: string; season?: string; ageGroup?: string; source?: string };
  imageUrl: string | null; tags: string[]; isPinned: boolean; updatedAt: string;
}

export default async function HealthInfoPage() {
  // 🔴 조회 실패를 "등록된 건강정보가 없습니다"로 그리지 않는다
  const r = await publicFetchResult<HealthItem[]>('/api/v1/public/health-info', 3600);
  if (!r.ok) return <PublicLoadFailed what="건강정보" />;
  return <HealthListClient items={r.data ?? []} />;
}
