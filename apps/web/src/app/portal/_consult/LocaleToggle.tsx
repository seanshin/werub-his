'use client';

import { usePortalLocale, PORTAL_LANGS } from '@/lib/i18n/portal-i18n';
import { PT, usePortalTAttr } from '../_shared/PT';

// 포털 언어 선택 (경량 i18n) — 🔴 환자 축(직원 화면 언어와 별개·portal-i18n.ts 헤더 참조)
export default function LocaleToggle({ className = '' }: { className?: string }) {
  const tAttr = usePortalTAttr();
  const { locale, setLocale } = usePortalLocale();
  return (
    <select
      // 🔴 부분 번역이라는 사실을 고지한다 — 종전엔 미번역이 한국어로 조용히 나와
      //    "번역이 안 된 것"과 "원래 한국어인 것"을 환자가 구분할 수 없었다(2026-09-07)
      title={locale === 'ko' ? '언어 선택' : '언어 선택 — 아직 번역되지 않은 문구는 한국어로 표시됩니다'}
      value={locale}
      onChange={(e) => setLocale(e.target.value as typeof locale)}
      aria-label={tAttr('언어 선택')}
      className={`text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 ${className}`}
    >
      {PORTAL_LANGS.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
    </select>
  );
}
