import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://hospitalrun.kr';

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/home', '/about/', '/care/', '/checkup/', '/guide/', '/health/', '/news/', '/support/'],
        disallow: ['/admin/', '/portal/', '/api/', '/login', '/dashboard', '/patients/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
