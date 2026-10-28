import type { MetadataRoute } from 'next';

/**
 * 공개 홈페이지 sitemap — /sitemap.xml
 *
 * 🔴 W9(P12 — 같은 사실에 정본이 둘): `/sitemap.xml` 을 만드는 파일이 두 개 있었다.
 *    · `app/sitemap.ts`        — BASE_URL 'https://his.example.org', 정적 27경로, 동적 페이지 없음
 *    · `app/(homepage)/sitemap.ts` — BASE_URL 'https://hospitalrun.kr', 진료과/의료진/뉴스 동적 포함
 *    라우트가 겹쳐 Next 가 하나만 서빙했고(실측: (homepage) 쪽이 이겼다) 나머지는 조용히 죽어 있었다.
 *    → 동적 포함본만 남기고 `app/sitemap.ts` 는 삭제. 정본은 이 파일 하나다.
 *
 * 🔴 W9(도메인 불일치): 서빙되는 robots.txt(`public/robots.txt`)는
 *    `Sitemap: https://his.example.org/sitemap.xml` 을 가리키는데, 그 sitemap 이 돌려주던 URL 은
 *    전부 `https://hospitalrun.kr/...` 였다. 크로스도메인 sitemap 은 검색엔진이 통째로 무시한다.
 *    배포 도메인은 NEXT_PUBLIC_SITE_URL 로 주고, 기본값은 실제 서빙 호스트에 맞춘다.
 *    (운영 도메인을 hospital.example.org 로 전환할 때 robots.txt 와 함께 바꿔야 한다 — 한 곳만 고치면 또 갈라진다.)
 */
const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://his.example.org').replace(/\/$/, '');
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

/**
 * 정적 공개 페이지 — 전부 `app/(homepage)/**` 에 실제 page.tsx 가 있는 경로만 적는다.
 * 🔴 W9: 여기에 `/health` 가 있었다. 그 경로는 화면이 아니라 API 헬스체크
 *    (`{"status":"ok","version":"v3.98.0"}`)라, 검색엔진에 JSON 과 가동 버전을 광고하고 있었다.
 *    건강정보 페이지의 실제 경로는 `/health-info` 다.
 */
const STATIC_PAGES: { path: string; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number }[] = [
  { path: '/home', changeFrequency: 'daily', priority: 1.0 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/about/facility', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/about/directions', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/about/csr', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/about/gallery', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/care', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/care/departments', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/care/centers', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/care/doctors', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/care/schedule', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/care/non-covered', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/checkup', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/checkup/process', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/checkup/faq', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/guide', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/guide/admission', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/guide/visiting', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/guide/parking', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/guide/dining', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/guide/funeral', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/guide/rights', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/guide/emergency', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/guide/certificate', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/health-info', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/news', changeFrequency: 'daily', priority: 0.8 },
  { path: '/news/recruit', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/support', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/support/faq', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/support/voc', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/international', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/booking', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/search', changeFrequency: 'weekly', priority: 0.4 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [departments, centers, doctors, news, healthInfo] = await Promise.all([
    fetchJson<Array<{ slug: string; updatedAt: string }>>('/api/v1/public/departments'),
    fetchJson<Array<{ slug: string; updatedAt: string }>>('/api/v1/public/centers'),
    fetchJson<Array<{ userId: string; updatedAt?: string }>>('/api/v1/public/doctors'),
    fetchJson<Array<{ slug: string; updatedAt: string }>>('/api/v1/public/news'),
    fetchJson<Array<{ slug: string; updatedAt: string }>>('/api/v1/public/health-info'),
  ]);

  const staticPages: MetadataRoute.Sitemap = STATIC_PAGES.map(p => ({
    url: `${BASE_URL}${p.path}`,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));

  // 동적 경로는 공개 API 가 실제로 돌려준 것만 싣는다.
  // API 실패 시 null → 빈 배열이 되어 정적 경로만 나간다(없는 URL 을 지어내 광고하지 않는다).
  const departmentPages: MetadataRoute.Sitemap = (departments ?? []).map(d => ({
    url: `${BASE_URL}/care/departments/${d.slug}`,
    lastModified: d.updatedAt,
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));

  const centerPages: MetadataRoute.Sitemap = (centers ?? []).map(c => ({
    url: `${BASE_URL}/care/centers/${c.slug}`,
    lastModified: c.updatedAt,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  const doctorPages: MetadataRoute.Sitemap = (doctors ?? []).map(d => ({
    url: `${BASE_URL}/care/doctors/${d.userId}`,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  const newsPages: MetadataRoute.Sitemap = (news ?? []).map(n => ({
    url: `${BASE_URL}/news/${n.slug}`,
    lastModified: n.updatedAt,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  const healthPages: MetadataRoute.Sitemap = (healthInfo ?? []).map(h => ({
    url: `${BASE_URL}/health-info/${h.slug}`,
    lastModified: h.updatedAt,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  return [...staticPages, ...departmentPages, ...centerPages, ...doctorPages, ...newsPages, ...healthPages];
}
