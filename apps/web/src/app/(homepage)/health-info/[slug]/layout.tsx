import type { Metadata } from 'next';
import { publicFetch } from '@/lib/public-fetch';

interface HealthItem { slug: string; title: string; content: string; metadata: { source?: string } }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const items = await publicFetch<HealthItem[]>('/api/v1/public/health-info', 3600);
  const item = (items ?? []).find(h => h.slug === slug);
  if (!item) return { title: '건강정보' };
  const desc = item.content.replace(/<[^>]*>/g, '').slice(0, 160);
  return {
    title: item.title,
    description: desc,
    openGraph: { title: `${item.title} | 위루비병원`, description: desc },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
