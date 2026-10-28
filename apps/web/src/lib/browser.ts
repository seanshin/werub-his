'use client';

/**
 * 인앱 브라우저(WKWebView) 감지.
 * 텔레그램·카카오톡·라인·페북·인스타 등 메신저 인앱 브라우저는
 * iOS에서 WebAuthn(패스키) origin/검증을 제대로 지원하지 않아 생체인증이 실패한다.
 * → Safari/Chrome 등 기본 브라우저로 열도록 안내.
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const apps =
    /(Telegram|KAKAOTALK|Line\/|NAVER|DaumApps|FBAN|FBAV|FB_IAB|Instagram|Snapchat|Twitter|Whale|; wv\))/i;
  if (apps.test(ua)) return true;
  // iOS WKWebView 휴리스틱: iOS WebKit인데 Safari 토큰이 없으면 인앱 가능성
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  if (isIOS && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua)) return true;
  return false;
}
