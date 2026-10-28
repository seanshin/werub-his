import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { DateQueryPipe } from './common/pipes/date-query.pipe';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { json, urlencoded } from 'express';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cookieParser = require('cookie-parser');
import { join } from 'path';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { FieldMaskInterceptor } from './common/interceptors/field-mask.interceptor';
import { MetricsInterceptor } from './common/interceptors/metrics.interceptor';
import { DateSerializerInterceptor } from './common/interceptors/date-serializer.interceptor';
import { UploadUrlSignInterceptor } from './common/interceptors/upload-url-sign.interceptor';
import { verifyUploadSignature } from './common/util/upload-url';
import { validateEnv } from './common/env.validation';

import { buildModeOf, swaggerEnabled } from './common/release-security';
// 서버 타임존을 Asia/Seoul로 설정
process.env.TZ = 'Asia/Seoul';

// 환경변수 런타임 검증 (시작 시 즉시 실패)
validateEnv();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true }); // 웹훅 HMAC(원문 서명) 검증용
  // nginx 프록시 뒤 — X-Forwarded-Proto/Host 신뢰(SMART discovery issuer를 https로)
  app.set('trust proxy', true);

  // Static file serving (uploads) — **PHI**. 정적 서빙은 인증이 없으므로 서명 게이트를 먼저 건다.
  // (환자 사진 `/uploads/patients/<patientId>/photo.jpg` 는 경로가 완전히 예측 가능했다.)
  // 서명 URL 은 UploadUrlSignInterceptor 가 응답 시점에 발급한다.
  app.use('/uploads', (req: any, res: any, next: any) => {
    const pathname = '/uploads' + (req.path ?? '');
    if (verifyUploadSignature(pathname, req.query?.uexp, req.query?.ut)) {
      res.setHeader('Cache-Control', 'private, no-store'); // PHI — 중간 캐시 금지
      next();
      return;
    }
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: '유효한 파일 접근 서명이 필요합니다' },
      meta: { timestamp: new Date().toISOString() },
    });
  });
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  // 홈페이지 미디어 영구 저장소 (배포와 무관하게 유지)
  const mediaDir = process.env.MEDIA_DIR || join(process.cwd(), '..', 'web', 'public', 'images');
  app.useStaticAssets(mediaDir, { prefix: '/media' });

  // CORS (must be before helmet)
  app.enableCors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').concat(['http://localhost:8081']),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Portal-Token'],
  });

  // Body 한도 상향 (ERP 대량 일괄 적재 대응) + FHIR content-type 파싱(application/fhir+json)
  // verify 콜백으로 rawBody 보존 — 커스텀 json()이 NestFactory rawBody:true를 덮어쓰는 문제 해소
  // (sign webhook HMAC 원문 서명 검증에 req.rawBody 필수)
  app.use(json({
    limit: '15mb',
    type: ['application/json', 'application/fhir+json', '+json'],
    verify: (req, _res, buf: Buffer) => { (req as unknown as { rawBody?: Buffer }).rawBody = buf; },
  }));
  app.use(urlencoded({ extended: true, limit: '15mb' }));

  // Cookie parser (refresh token 쿠키 파싱)
  app.use(cookieParser());

  // Response compression (gzip, 1KB 이상)
  app.use(compression({ threshold: 1024 }));

  // Security headers + CSP
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'https://example.org', 'https://his.example.org'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
  }));

  // Global exception filter — CLAUDE.md 응답포맷 { error: { code, message, details }, meta }
  app.useGlobalFilters(new GlobalExceptionFilter());

  // 역할 기반 응답 필드 마스킹 + APM 메트릭 수집
  app.useGlobalInterceptors(new DateSerializerInterceptor(), new MetricsInterceptor(), new FieldMaskInterceptor(), new UploadUrlSignInterceptor());

  // Validation.
  //
  // 🔴 입력 단 sanitize(`common/pipes/sanitize.pipe.ts`)는 **일부러 등록하지 않는다** —
  //    문자열을 통째로 치환하면 Date·JSON·의료 서술(부등호·단위 표기)이 변형된다.
  //    XSS 는 **출력 단**에서 막는다(2026-08-18 전수 확인):
  //      · 서버 HTML 생성   `common/util/html-escape` 의 `escapeHtml` (예: 의뢰서 `referral-letter.service`)
  //      · 브라우저 렌더    `apps/web/src/lib/sanitize.ts` 의 `sanitizeHtml`(DOMPurify)
  //      · 업로드 콘텐츠    media fileFilter (저장형 XSS 차단)
  //    🔴 그 파이프를 되살리려면 위 세 층과의 중복·충돌을 먼저 판단할 것.
  app.useGlobalPipes(
    /**
     * 🔴 **날짜성 쿼리 파라미터를 먼저 거른다**(2026-08-31 · 실측 500 56곳).
     *    모듈들이 정본을 안 거치고 `new Date(query.from)` 을 직접 써서 `Invalid Date` 가
     *    Prisma 로 들어갔다. 52곳을 개별로 고치면 또 새므로 진입점에서 한 번 막는다.
     *    **값을 바꾸지 않고 거부만 한다**(SanitizePipe 가 경고하는 조용한 변형 회피).
     */
    new DateQueryPipe(),
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false, // DTO 없는 엔드포인트 호환성 유지
      transform: true,
    }),
  );

  // Swagger — 🔴 명시적 옵트인만 (2026-08-25). 종전 `NODE_ENV !== 'production'` 분기는
  // 운영 서버에 NODE_ENV 가 아예 없어서(5f1d5c21 실측) **운영에서 전체 API 문서가 공개**돼 있었다.
  // 설정을 잊은 환경이 곧 위험한 환경이 된다 — 여는 쪽이 옵트인이다: SWAGGER_ENABLED=true
  // 또는 명시적 development 에서만. (iOS 등 외부 팀 계약 열람은 로컬/개발 기동 또는
  // docs/05-reference 의 계약 스냅샷으로 — 운영 공개가 답이 아니다)
  // 🔴 (2026-09-13 T4-2) 판정은 모드 정본 `swaggerEnabled()` — REAL 은 NODE_ENV·SWAGGER_ENABLED 가 무엇이든 닫힌다.
  if (swaggerEnabled()) {
    const config = new DocumentBuilder()
      .setTitle('Hospital RUN API')
      .setDescription('한국형 Enterprise 병원 정보 시스템 API')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    console.log(`Swagger docs at http://localhost:${process.env.PORT || 4000}/api/docs`);
  }

  const port = process.env.PORT || 4000;
  const bindHost = process.env.BIND_HOST || '127.0.0.1';
  await app.listen(port, bindHost);
  // 🔴 T4-2 — 기동 로그는 NODE_ENV('development' 로 둔갑하던 기본값)가 아니라 **빌드 상한 모드**를 말한다
  console.log(`Hospital RUN API running on http://localhost:${port} [HIS_MODE=${buildModeOf()}]`);
}
bootstrap();
