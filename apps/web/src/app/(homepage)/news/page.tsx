import { publicFetchResult } from '@/lib/public-fetch';
import { PublicLoadFailed } from '@/components/homepage/PublicLoadFailed';
import { NewsListClient } from './news-list-client';

export const revalidate = 300;

interface NewsItem {
  id: string; slug: string; title: string; content: string;
  metadata: { subType?: string; importance?: string; author?: string; sourceUrl?: string; thumbnailUrl?: string };
  imageUrl: string | null; tags: string[]; isPinned: boolean; updatedAt: string;
}

interface Props {
  searchParams: Promise<{ type?: string }>;
}

export default async function NewsPage({ searchParams }: Props) {
  const { type } = await searchParams;
  // 🔴 조회 실패를 "등록된 소식이 없습니다"로 그리지 않는다
  const r = await publicFetchResult<NewsItem[]>('/api/v1/public/news', 300);
  if (!r.ok) return <PublicLoadFailed what="병원 소식" />;
  return <NewsListClient items={r.data ?? []} initialType={type} />;
}
