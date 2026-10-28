# 다국어 / 자동 번역 엔진 설계 v1.0 (P3b 우선 구현)

> Plan: multilingual-i18n.plan v1.2 · 작성 2026-06-08. 본 설계는 **공유 자동 번역 엔진**(두 기능 의존)을 우선 구현.

## 1. 자동 번역 엔진 (구현됨)
```
POST /api/v1/i18n/translate { text, target, source? } [JwtAuthGuard, Throttle 120/분]
  TranslationService.translate(text, target, source='ko')
    → 캐시 조회(Translation: hash=sha256(source|target|text))
    → 미스: Ollama POST {ai.server.url}/api/chat (model=ai.model, X-Medical-Key)
            "Translate ... Output ONLY the translation"
    → 저장(캐시) → 반환 { translated, cached, fallback? }
    → 타임아웃(20s)/실패 시 원문 폴백(fallback:true)
```
- **온프레미스**(Ollama) → PHI/민감정보 외부 유출 없음.
- 캐시: `Translation` 모델(hash unique, targetLang index). 동일 문장 재번역 방지.
- 언어: ko/en/zh/ja/ru/vi/mn/ar (LANG_NAME).
- **재사용**: `exports: [TranslationService]` → 상담실([[portal-chat-consultation]]) 메시지 번역·CMS 동적 콘텐츠가 서버단 호출.

## 2. 파일
- `apps/api/src/modules/i18n/translation.service.ts` (서비스, 캐시·Ollama·폴백)
- `apps/api/src/modules/i18n/translation.controller.ts` (POST /api/v1/i18n/translate)
- `apps/api/src/modules/i18n/i18n.module.ts` (exports service)
- Prisma `Translation` 모델

## 3. 후속(설계 예정)
- next-intl 셋업·언어선택기·홈 경로 프리픽스(hreflang)·포털 쿠키/프로필 연동 (Plan P1~P3)
- 공개(홈페이지 SSR) 번역 경로·noindex·용어집·검수 (Plan §5-2~5-4)
- 상담실 메시지 양방향 번역 연계 (portal-chat-consultation)
