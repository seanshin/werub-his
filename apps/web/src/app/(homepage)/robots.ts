import type { MetadataRoute } from 'next';

/**
 * 🔴 W9: 이 파일은 실제로 서빙되지 않는다 — `apps/web/public/robots.txt`(정적 파일)가 라우트를 가린다.
 *    두 파일이 서로 다른 도메인/규칙을 말하고 있었다(여기 hospitalrun.kr, 정적 파일 his.example.org).
 *    정적 파일은 이 축의 소유 범위 밖이라 손대지 않았고, 최소한 도메인 기본값만 맞춰 둔다.
 *    → 정리(둘 중 하나 삭제)는 보고서의 사람 판단 이연분 참조.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://his.example.org').replace(/\/$/, '');

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
