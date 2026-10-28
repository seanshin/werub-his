import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://hospitalrun.kr';
const API_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const departments = await fetchJson<Array<{ slug: string; updatedAt: string }>>('/api/v1/public/departments') ?? [];
  const doctors = await fetchJson<Array<{ userId: string }>>('/api/v1/public/doctors') ?? [];
  const news = await fetchJson<Array<{ slug: string; updatedAt: string }>>('/api/v1/public/news') ?? [];

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/home`, changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/about`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/about/facility`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/care`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/care/departments`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/care/centers`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/care/doctors`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/care/schedule`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/care/non-covered`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/checkup`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/checkup/process`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/guide`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/guide/parking`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/guide/dining`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/guide/visiting`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/health`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE_URL}/news`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE_URL}/news/recruit`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/support/faq`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/support/voc`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/about/directions`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/about/csr`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/about/gallery`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/guide/funeral`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/guide/rights`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/search`, changeFrequency: 'weekly', priority: 0.4 },
  ];

  const departmentPages: MetadataRoute.Sitemap = departments.map(d => ({
    url: `${BASE_URL}/care/departments/${d.slug}`,
    lastModified: d.updatedAt,
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));

  const doctorPages: MetadataRoute.Sitemap = doctors.map(d => ({
    url: `${BASE_URL}/care/doctors/${d.userId}`,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  const newsPages: MetadataRoute.Sitemap = news.map(n => ({
    url: `${BASE_URL}/news/${n.slug}`,
    lastModified: n.updatedAt,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  return [...staticPages, ...departmentPages, ...doctorPages, ...newsPages];
}
