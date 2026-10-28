'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { localeDateTimeText } from '@hospital-run/shared';

/**
 * 인쇄 기본 차단 가드 (2026-08-04) — 의료용 SW 는 화면 인쇄가 곧 PHI 유출 경로다.
 *
 * 정책: **기본 차단 + 지정 허용**
 *  - 전용 인쇄 경로(/print/*)는 경로 자체가 허용 — 문서 발급용으로 설계된 화면
 *  - 그 외 화면의 인쇄 버튼은 sanctionedPrint() 로만 출력(허용 클래스를 걸고 찍고 해제)
 *  - 나머지 모든 경로(Cmd/Ctrl+P·브라우저 메뉴 인쇄)는:
 *      · 단축키는 가로채서 안내 토스트
 *      · 메뉴 인쇄는 막을 수 없으므로 **인쇄 결과물이 차단 안내 시트**가 되게 한다(globals.css)
 *
 * 한계(정직하게): 스크린샷·OS 캡처는 브라우저가 막을 수 없다 — 이 가드는
 * '무심코 찍는 화면 인쇄'와 '인쇄물 형태의 반출'을 차단·통제하는 장치다.
 */

/** 경로 자체가 인쇄 목적인 화이트리스트 — 세그먼트 기준 */
const ALLOWED_PATH = /\/print\//;

const ALLOW_CLASS = 'print-allowed';

/** 인쇄 시도 감사 보고 — 실패해도 인쇄 UX 를 막지 않는다(비차단·미인증 화면에선 401 무시) */
function reportPrintEvent(kind: 'BLOCKED' | 'SANCTIONED' | 'PRINT_ROUTE', detail?: string) {
  import('@/lib/api-client')
    .then(({ apiClient }) => apiClient.post('/api/v1/audit/print-event', {
      kind,
      path: location.pathname.slice(0, 300),
      ...(detail ? { detail: detail.slice(0, 200) } : {}),
    }))
    .catch(() => {});
}

/**
 * 🔴 새 창(window.open) 인쇄 감사 (2026-09-01) — 팔찌·의뢰서 등 PHI 를 별도 창에서 찍는 경로는
 * PrintGuard(메인 앱) 밖이라 `reportPrintEvent` 가 호출되지 않아 **감사에서 통째로 빠졌다**.
 * 창을 열기 전에 이 함수로 인쇄 시도를 남긴다(비차단·실패 무시). detail 에 무엇을 찍는지.
 */
export function auditNewWindowPrint(detail: string) {
  reportPrintEvent('SANCTIONED', `newwin:${detail}`);
}

/**
 * 지정 인쇄 버튼 전용 — 허용 클래스를 걸고 인쇄, 끝나면 해제
 * `detail` — 무엇을 찍는지(발급번호·해시 앞 16자 / 미발급 미리보기) · 감사 detail 200자 안(2026-10-12 기획 G3)
 */
export function sanctionedPrint(detail?: string) {
  const html = document.documentElement;
  html.classList.add(ALLOW_CLASS);
  const cleanup = () => html.classList.remove(ALLOW_CLASS);
  window.addEventListener('afterprint', cleanup, { once: true });
  // afterprint 미발화 브라우저 안전망 — 인쇄 대화상자를 오래 열어둬도 1분 뒤 원복
  setTimeout(cleanup, 60_000);
  reportPrintEvent('SANCTIONED', detail);
  window.print();
}

export function PrintGuard() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const routeAllowed = ALLOWED_PATH.test(pathname ?? '');

  useEffect(() => { setMounted(true); }, []);

  // 전용 인쇄 경로는 경로 재실 동안 상시 허용
  useEffect(() => {
    const html = document.documentElement;
    if (routeAllowed) html.classList.add(ALLOW_CLASS);
    else html.classList.remove(ALLOW_CLASS);
  }, [routeAllowed]);

  // Cmd/Ctrl+P 가로채기 — 허용 상태가 아니면 차단 + 안내 + 감사 기록
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'p' || e.key === 'P')) {
        if (!document.documentElement.classList.contains(ALLOW_CLASS)) {
          e.preventDefault();
          e.stopPropagation();
          reportPrintEvent('BLOCKED', 'keyboard');
          // toast 스토어가 없는 트리(홈페이지 등)에서도 죽지 않게 동적 접근
          import('@/stores/toast-store')
            .then(({ toast }) => toast.error('이 화면은 출력이 제한됩니다 — 지정된 인쇄 기능(문서 발급·인쇄 버튼)을 사용하세요. (시도는 기록됩니다)'))
            .catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  // beforeprint — 메뉴 인쇄 등 모든 인쇄 직전에 발화: 차단/경로 인쇄를 감사에 남기고, 허용 인쇄엔 워터마크를 스탬프
  useEffect(() => {
    const onBefore = () => {
      const allowed = document.documentElement.classList.contains(ALLOW_CLASS);
      if (!allowed) {
        reportPrintEvent('BLOCKED', 'browser-menu');
        return;
      }
      if (ALLOWED_PATH.test(location.pathname)) reportPrintEvent('PRINT_ROUTE');
      // 워터마크 — 누가 언제 뽑았는지 인쇄물 자체에 남긴다(수신처에서의 책임 추적)
      import('@/stores/auth-store')
        .then(({ useAuthStore }) => {
          const u = useAuthStore.getState().user;
          const name = u ? `${u.familyName ?? ''}${u.givenName ?? ''}`.trim() || u.email : '';
          const el = document.querySelector('.print-watermark');
          if (el) el.textContent = `${name ? name + ' · ' : ''}${localeDateTimeText(new Date(), 'ko-KR')} · 위루비병원 HIS`;
        })
        .catch(() => {});
    };
    window.addEventListener('beforeprint', onBefore);
    return () => window.removeEventListener('beforeprint', onBefore);
  }, []);

  if (!mounted) return null;
  // 차단 안내 시트 — 평소엔 숨김, 비허용 인쇄 시에만 결과물로 나온다(globals.css @media print).
  // body 직계 자식이어야 `body > *:not(.print-deny-sheet)` 전체 숨김에서 살아남는다 → portal.
  return createPortal(
    <>
      <div className="print-deny-sheet" aria-hidden="true">
        <h1>🔒 출력이 허용되지 않은 화면입니다</h1>
        <p>의료정보 보호를 위해 이 시스템은 지정된 인쇄 기능(문서 발급·화면의 인쇄 버튼)에서만 출력할 수 있습니다.</p>
        <p>필요한 서식은 해당 화면의 인쇄 버튼 또는 의무기록 발급 절차를 이용해 주세요.</p>
        <p className="print-deny-meta">차단 시각: {localeDateTimeText(new Date(), 'ko-KR')} · 위루비병원 HIS · 시도는 감사 기록됩니다</p>
      </div>
      {/* 허용 인쇄물 워터마크 — beforeprint 에서 사용자·시각 스탬프(globals.css @media print) */}
      <div className="print-watermark" aria-hidden="true" />
    </>,
    document.body,
  );
}
