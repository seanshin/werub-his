'use client';

/**
 * 문서(처방전·진단서·소견서·영수증·동의서) **새 창** 열기 공용 유틸.
 *
 * 왜 탭이 아니라 창인가: 인쇄용 문서는 진료 화면과 나란히 두고 확인·인쇄하는 물건이라
 * 탭으로 열면 진료 입력 화면이 가려진다. 창 이름을 문서 종류로 고정해 같은 종류를 여러 번 눌러도
 * 창이 쌓이지 않고 갱신·포커스되며, 처방전 창과 진단서 창은 서로 독립이라 나란히 비교할 수 있다.
 *
 * 🔴 `noopener` 를 features 에 넣으면 window.open 이 **null 을 반환**해 재사용·포커스가 불가능하다.
 *    문서 경로는 우리 도메인(same-origin)이므로 opener 노출 위험이 없어 넣지 않는다.
 */

export interface WindowBox {
  width: number;
  height: number;
  left: number;
  top: number;
}

/** A4 비율(1:1.414)에 가깝게, 화면을 넘지 않게 — 순수 계산(테스트 대상) */
export function documentWindowBox(
  screenW: number,
  screenH: number,
  opts: { maxWidth?: number; ratio?: number } = {},
): WindowBox {
  const ratio = opts.ratio ?? 1.414;                       // 세로가 가로의 1.414배(A4 세로)
  const maxWidth = opts.maxWidth ?? 900;
  const height = Math.max(360, Math.round(screenH * 0.92));
  const byRatio = Math.round(height / ratio);
  const width = Math.max(360, Math.min(maxWidth, byRatio, Math.round(screenW * 0.9)));
  return {
    width,
    height,
    left: Math.max(0, Math.round((screenW - width) / 2)),
    top: Math.max(0, Math.round((screenH - height) / 2)),
  };
}

/**
 * 문서 새 창 열기. 팝업이 차단되면 false 를 돌려주므로 호출부에서 안내할 수 있다
 * (조용히 실패하면 "눌러도 아무 일 없음"이 된다).
 */
export function openDocumentWindow(url: string, kind: string): boolean {
  if (typeof window === 'undefined') return false;
  const box = documentWindowBox(window.screen?.availWidth ?? 1280, window.screen?.availHeight ?? 900);
  const features = `popup=yes,width=${box.width},height=${box.height},left=${box.left},top=${box.top},resizable=yes,scrollbars=yes`;
  const win = window.open(url, `hr-doc-${kind}`, features);
  if (!win) return false;
  win.focus();
  return true;
}
