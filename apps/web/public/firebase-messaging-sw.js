/* Firebase Cloud Messaging service worker — 스태프 Tier2 승인 백그라운드 푸시 (단말 제로트러스트 ②).
   compat SDK(CDN)로 자체 동작. config 는 공개값. */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// 공개판: 기관의 Firebase 프로젝트 값으로 바꾼다(정적 파일이라 환경 변수를 읽지 못한다 — PUBLIC-EDITION.md).
firebase.initializeApp({
  apiKey: 'CHANGE_ME',
  authDomain: 'your-firebase-project.firebaseapp.com',
  projectId: 'your-firebase-project',
  storageBucket: 'your-firebase-project.firebasestorage.app',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload && payload.data ? payload.data : {};
  const title = (payload.notification && payload.notification.title) || data.title || '승인 요청';
  const body = (payload.notification && payload.notification.body) || data.body || '고위험 작업 승인이 필요합니다.';
  self.registration.showNotification(title, { body, data, tag: data.requestId || 'stepup' });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/staff/approvals'));
});
