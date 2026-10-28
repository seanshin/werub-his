/**
 * 🔴 환자·모바일 앱 전용 OpenAPI 계약 스냅샷 생성 (CONTRACT-01 · 2026-08-31).
 *    전체 Swagger 는 EP 한 덩어리라 앱팀에게 줄 계약이 없었다(회신 §5 미구현).
 *    앱이 쓰는 태그만 뽑아 docs/05-reference/openapi-mobile.json 으로 동결한다.
 *    🔴 운영 Swagger 를 공개하지 않는다(main.ts 옵트인) — 계약은 이 정적 스냅샷으로 준다.
 *    실행: npm run gen:mobile-openapi  (apps/api 를 먼저 nest build 해야 dist 가 최신이다)
 */
const { NestFactory } = require('@nestjs/core');
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');
const { writeFileSync } = require('fs');
const { join } = require('path');
const { AppModule } = require('../apps/api/dist/app.module');

const MOBILE_TAGS = new Set(['Patient Auth', 'Patient Portal', 'Patient Portal — 검진', 'mobile-device-push', 'mobile-app-integrity']);

(async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  const config = new DocumentBuilder()
    .setTitle('Hospital RUN — 환자 모바일 API 계약')
    .setDescription('환자용 iOS/Android 앱 API 계약 스냅샷. 운영 Swagger 비공개 — 이 파일이 정본. 응답 { data, meta }/{ error }. 날짜 못 읽으면 400.')
    .setVersion(process.env.npm_package_version || '1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer' })
    .addApiKey({ type: 'apiKey', name: 'X-Portal-Token', in: 'header' }, 'PortalToken')
    .addTag('Patient Auth', '가입·로그인·본인확인·기기·보호자·알림 (환자 계정 인증 축)')
    .addTag('Patient Portal', '건강·진료·수납·여정 등 환자 데이터 (X-Portal-Token 또는 Bearer)')
    .addTag('Patient Portal — 검진', '건강검진 방문·요약·문진')
    .addTag('mobile-device-push', '앱 설정(최소버전·기능플래그)·FCM 토큰·AASA(유니버설 링크)')
    .addTag('mobile-app-integrity', 'App Attest 앱 무결성·외부 자격증명 준비율')
    .build();
  const full = SwaggerModule.createDocument(app, config);
  const paths = {}; let kept = 0, total = 0;
  for (const [p, methods] of Object.entries(full.paths)) {
    const km = {};
    for (const [m, op] of Object.entries(methods)) { total++;
      // 🔴 시드·관리자 EP 는 태그가 붙어 있어도 계약에서 뺀다 — 앱이 부르면 안 되는 것이다
      const tagged = (op.tags || []).some((t) => MOBILE_TAGS.has(t));
      const appFacing = !p.includes('seed-') && !p.includes('/admin/');
      if (tagged && appFacing) { km[m] = op; kept++; } }
    if (Object.keys(km).length) paths[p] = km;
  }
  full.paths = paths;
  full.tags = (full.tags || []).filter((t) => MOBILE_TAGS.has(t.name));
  const out = join(__dirname, '..', 'docs', '05-reference', 'openapi-mobile.json');
  writeFileSync(out, JSON.stringify(full, null, 2) + '\n');
  console.log(`✅ 모바일 계약: ${kept}/${total} operation → ${out}`);
  await app.close(); process.exit(0);
})().catch((e) => { console.error('생성 실패:', e.message); process.exit(1); });
