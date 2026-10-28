// PM2 기동 설정 — EC2(4GB·swap0) + nginx 앞단. standalone 아티팩트 실행용.
// 배포: 서버 밖 빌드 → .next/standalone(+.next/static·이 파일 포함) 업로드 → release/current 에서 PM2 기동.
//   ※ 배포 시 이 파일을 standalone 번들에 포함시킬 것: `cp ecosystem.config.cjs .next/standalone/`
//   cwd 는 __dirname(= 배포된 current 디렉터리) → 경로 독립(예: /var/www/homepage/current).
module.exports = {
  apps: [
    {
      name: 'homepage',                    // 인프라 설계 기대값(pm2 reload homepage)
      script: 'server.js',                 // standalone server.js (cwd 기준)
      cwd: __dirname,                      // = 배포된 current 디렉터리(경로 독립)
      // PM2 데몬이 구앱 때문에 node21로 떠 있어 신규앱은 node22로 고정(인프라 생성 심볼릭→v22.22.3).
      interpreter: '/usr/local/bin/node22', // node 패치 시 심볼릭만 재지정(ecosystem 불변)
      instances: 1,
      exec_mode: 'fork',                   // SSR 단일 프로세스(메모리 안전)
      max_memory_restart: '600M',          // 1GB 예산 내(헤드룸 확보)
      autorestart: true,
      env: {                               // shared/.env(§4-4)와 동일값
        NODE_ENV: 'production',
        PORT: '3001',                      // nginx 프록시 타겟
        HOSTNAME: '127.0.0.1',             // 루프백만(외부는 nginx)
        INTERNAL_API_URL: 'https://his.example.org', // SSR publicFetch(공개 EP·시크릿 아님)
        NEXT_PUBLIC_API_URL: '',           // 클라 상대경로 → /api(nginx 또는 rewrites 프록시)
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
};
