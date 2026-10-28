import { publicFetchResult } from '@/lib/public-fetch';
import { PublicLoadFailed } from '@/components/homepage/PublicLoadFailed';
import { RecruitListClient } from './recruit-list-client';

export const revalidate = 600;

interface RecruitItem {
  id: string; slug: string; title: string; content: string;
  metadata: { position?: string; department?: string; employmentType?: string; requirements?: string[]; benefits?: string[]; deadline?: string; contactEmail?: string; status?: string };
  tags: string[]; isPinned: boolean; updatedAt: string;
}

export default async function RecruitPage() {
  // 🔴 조회 실패를 "등록된 채용 공고가 없습니다"(모집중 0·마감 0)로 그리지 않는다
  const r = await publicFetchResult<RecruitItem[]>('/api/v1/public/recruit', 600);
  if (!r.ok) return <PublicLoadFailed what="채용 공고" />;
  return <RecruitListClient items={r.data ?? []} />;
}
