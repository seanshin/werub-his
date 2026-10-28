import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // 무중단 배포: 빌드는 NEXT_DIST_DIR(임시)로, start는 기본 .next로 — 빌드 후 원자적 스왑
  distDir: process.env.NEXT_DIST_DIR || '.next',
  /**
   * 🔴 컨테이너 설치 경로(`apps/web/Dockerfile` runner)가 `.next/standalone` 을 복사하는데 이 설정이
   *    없어 **COPY 가 실패**했다 — 저장소 원본으로는 운영 compose 이미지를 만들 수 없었다
   *    (형제 프로젝트 설치 따라가기 R4 · 2026-09-21 갈래 E 회신).
   *
   * 🔴 무조건 켜지 않는다. standalone 은 파일 추적 단계를 더 돌아 빌드 시간·메모리를 늘리는데,
   *    **검증된 정본 경로는 `deploy.sh`(`next start`)** 이고 그 경로는 standalone 을 쓰지 않는다.
   *    이 저장소는 웹 빌드 OOM(137)을 두 번 겪었다 — 안 쓰는 산출물 때문에 그 위험을 키우지 않는다.
   *    → Dockerfile 이 `NEXT_OUTPUT=standalone` 을 켤 때만 켠다. 짝이 어긋나면
   *      `apps/api/test/architecture/container-install-contract.spec.ts` 가 실패한다.
   *
   * 🔴 모노레포라 `outputFileTracingRoot` 를 루트로 잡아야 workspace 심볼릭 의존이 따라온다 —
   *    그러면 산출물은 `.next/standalone/apps/web/server.js` 다(루트 `server.js` 가 아니다).
   */
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone' as const, outputFileTracingRoot: path.resolve(process.cwd(), '../..') }
    : {}),
  transpilePackages: ['@hospital-run/shared'],
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 768, 1024, 1280, 1536],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },
  experimental: {
    optimizeCss: false,
    // CI(self-hosted 러너=운영 서버·가용 ~5GB) 한정 정적 생성 워커 축소 — 다중 워커 피크가
    // OS OOM(SIGKILL)을 유발한 실측(2026-08-05 CI run 0db1de05). 배포 빌드(deploy.sh)는 무영향.
    // +webpackMemoryOptimizations: 컴파일 단계 피크 완화(2차 OOM 실측 21fde82c — 배포 빌드와 겹치면 시작 직후도 죽는다).
    ...(process.env.CI ? { cpus: 2, workerThreads: false, webpackMemoryOptimizations: true } : {}),
  },
  /**
   * 🔴 테스트 계정 패널을 **운영 빌드의 모듈 그래프에서 뺀다**(WEB-SEC-01).
   *
   * 빌드 모드가 `REAL`(기본)이면 패널 모듈을 빈 stub 으로 치환한다 — `DEV`/`REHEARSAL` 에서만 남긴다.
   * 조건부 렌더나 dynamic import 의 false 분기만으로는 청크가 생성되어 계정 목록과
   * 공용 비밀번호가 산출물에서 그대로 검색됐다(실측 후 이 방식으로 바꿨다).
   * 산출물에 남지 않는지는 `test/ui/no-test-accounts-in-prod.spec.ts` 가 직접 뒤져 확인한다.
   */
  webpack(
    config: { plugins: unknown[] },
    { webpack }: { webpack: { NormalModuleReplacementPlugin: new (re: RegExp, to: string) => unknown } },
  ) {
    // 🔴 shared 의 `allowsSeedLogin()` 을 부르지 않는다 — next.config 는 빌드 이전에 평가되고,
    //    여기서 중요한 것은 "모르는 값이면 막는다"이다(REAL 이 기본).
    const buildMode = process.env.NEXT_PUBLIC_HIS_MODE;
    if (buildMode !== 'DEV' && buildMode !== 'REHEARSAL') {
      // 🔴 `resolve.alias` 로는 치환되지 않았다(Next 의 `@/*` alias 가 먼저 잡는다 — 실측).
      //    요청 문자열 단계에서 바꾸는 NormalModuleReplacementPlugin 을 쓴다.
      const stub = path.resolve(process.cwd(), 'src/components/dev/TestAccountPanel.stub.tsx');
      const patientStub = path.resolve(process.cwd(), 'src/components/dev/TestPatientPanel.stub.tsx');
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/components[\\/]dev[\\/]TestAccountPanel$/, stub),
        new webpack.NormalModuleReplacementPlugin(/lib[\\/]test-accounts$/, stub),
        // 시드 **환자**(MRN+생년월일) 패널 — 포털 로그인·인터넷예약. 직원 계정과 같은 규약으로 뺀다.
        new webpack.NormalModuleReplacementPlugin(/components[\\/]dev[\\/]TestPatientPanel$/, patientStub),
        new webpack.NormalModuleReplacementPlugin(/lib[\\/]test-patients$/, patientStub),
      );
    }
    return config;
  },
  async rewrites() {
    return [
      // 홈페이지 미디어 영구 저장소 → NestJS 정적 서빙
      { source: '/media/:path*', destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/media/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
    ];
  },
};

export default nextConfig;
