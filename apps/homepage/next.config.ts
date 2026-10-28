import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // AWS 컨테이너(App Runner/ECS Fargate) 슬림 이미지용 — .next/standalone 산출
  output: 'standalone',
  // 모노레포 루트 자동추적 무시 → standalone 을 빌드 디렉터리 기준 평탄화(.next/standalone/server.js)
  outputFileTracingRoot: process.cwd(),
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 768, 1024, 1280, 1536],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },
  async rewrites() {
    // ⚠️ rewrites destination 은 BUILD 시점에 고정됨(런타임 env 로 안 바뀜).
    // 프록시 대상은 전용 빌드변수 HOMEPAGE_API_ORIGIN 으로 주입(예: https://his.example.org).
    // NEXT_PUBLIC_API_URL 은 빈 값 유지 → 브라우저는 상대경로 /api 호출 → 아래 프록시(same-origin·CORS 불요).
    const api = process.env.HOMEPAGE_API_ORIGIN || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    return [
      { source: '/media/:path*', destination: `${api}/media/:path*` },
      { source: '/api/:path*', destination: `${api}/api/:path*` },
    ];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-DNS-Prefetch-Control', value: 'on' },
      ],
    }];
  },
};

export default nextConfig;
