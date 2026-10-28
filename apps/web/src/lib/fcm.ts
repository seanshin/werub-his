'use client';

import { apiClient } from './api-client';
import { toast } from '@/stores/toast-store';

// 스태프 FCM 푸시 토큰 등록 — Tier2 승인 알림 (단말 제로트러스트 ②).
// firebase 웹 config·VAPID 공개키는 공개값(클라이언트 임베드 정상). 토큰은 의사의 등록된 활성
//   staffDevice 에 붙음(미등록 시 404 → 무시). 서버 송신은 FCM_SERVICE_ACCOUNT_JSON 필요.
const firebaseConfig = { // 공개판: 기관의 Firebase 프로젝트 값을 환경 변수로 넣는다(PUBLIC-EDITION.md)
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
};
const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? '';

let started = false;

/** 로그인 후 1회 호출 — FCM 토큰 발급 + 서버 등록. 미지원/권한거부 시 안전하게 무동작(폴링 대체). */
export async function initStaffFcm(): Promise<void> {
  if (started || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!firebaseConfig.apiKey || !VAPID_KEY) return; // 공개판: Firebase 미설정이면 푸시 없이 폴링으로 동작
  started = true;
  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getMessaging, getToken, isSupported, onMessage } = await import('firebase/messaging');
    if (!(await isSupported())) return;
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) {
      // 의사의 활성 staffDevice 에 토큰 등록(미등록 디바이스면 404 — 무시, 폴링으로 동작)
      // 🔴 (2026-09-14) 종전 `.catch(() => undefined)` 는 404(정상 — 폴링 동작) 뿐 아니라 인증·서버 오류까지 삼켜
      //    "푸시가 왜 안 오지"를 흔적 없이 만들었다. 404 만 기대된 결과로 접고 나머지는 콘솔에 남긴다(백그라운드라 토스트는 띄우지 않는다).
      await apiClient.post('/api/v1/devices/fcm-token', { fcmToken: token }).catch((e: unknown) => {
        const code = (e as { code?: string })?.code;
        if (code === 'ERR_NOT_FOUND' || code === 'NOT_FOUND') return;
        console.warn('[fcm] 토큰 등록 실패 — 푸시 대신 폴링으로 동작한다', code ?? e);
      });
    }
    // 포그라운드 푸시 표시 — 서비스워커는 백그라운드만 처리하므로 앱 활성 중엔 조용히 묻히던 문제 봉합.
    // severity가 data에 실려오면(위급) error/warning 토스트로 승격.
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title ?? '새 알림';
      const body = payload.notification?.body ?? '';
      const sev = String(payload.data?.severity ?? '').toUpperCase();
      const msg = `${title}${body ? ` — ${body}` : ''}`;
      if (sev === 'CRITICAL') toast.error(msg);
      else if (sev === 'WARNING') toast.warning(msg);
      else toast.info(msg);
    });
  } catch {
    /* 미지원/권한거부 등 — no-op(폴링 대체) */
  }
}
