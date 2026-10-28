import type { Metadata } from 'next';
import { publicFetch } from '@/lib/public-fetch';

interface NewsItem { slug: string; title: string; content: string; metadata: { subType?: string } }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const items = await publicFetch<NewsItem[]>('/api/v1/public/news', 300);
  const item = (items ?? []).find(n => n.slug === slug);
  if (!item) return { title: '병원 소식' };
  const desc = item.content.replace(/<[^>]*>/g, '').slice(0, 160);
  return {
    title: item.title,
    description: desc,
    openGraph: { title: `${item.title} | 위루비병원`, description: desc },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
