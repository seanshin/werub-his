/**
 * FCM Push Notifications Hook
 *
 * expo-notifications 설치 후 활성화:
 *   npx expo install expo-notifications expo-device expo-constants
 *
 * app.json에 추가 필요:
 *   "plugins": ["expo-notifications"]
 *
 * Firebase 설정:
 *   google-services.json (Android) → android/app/
 *   GoogleService-Info.plist (iOS) → ios/
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform, Alert } from 'react-native';
// 🔴 `@/` 경로 별칭은 이 앱 tsconfig(expo/tsconfig.base)에 없다 — 모듈 해석 실패로 타입체크가
//    깨져 있었다(런타임도 Metro 설정에 의존). 상대경로로 통일한다.
import { apiClient } from '../lib/api-client';

// expo-notifications를 optional import
let Notifications: any = null;
let Device: any = null;
let Constants: any = null;

try {
  Notifications = require('expo-notifications');
  Device = require('expo-device');
  Constants = require('expo-constants');
} catch {
  // expo-notifications 미설치 시 graceful 비활성화
}

interface PushNotification {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}

export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<PushNotification | null>(null);
  const notificationListener = useRef<any>(null);
  const responseListener = useRef<any>(null);

  const registerForPushNotifications = useCallback(async (): Promise<string | null> => {
    if (!Notifications || !Device) {
      console.log('[Push] expo-notifications not installed — skipping');
      return null;
    }

    // 실제 디바이스에서만 (시뮬레이터 제외)
    if (!Device.isDevice) {
      console.log('[Push] Push notifications require a physical device');
      return null;
    }

    // 권한 확인
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      Alert.alert('알림 권한', '푸시 알림을 받으려면 설정에서 알림을 허용해주세요.');
      return null;
    }

    // Android 알림 채널 설정
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('hospital-run', {
        name: 'Hospital RUN',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        sound: 'default',
      });
    }

    // Expo Push Token 또는 FCM Token 획득
    try {
      const projectId = Constants?.expoConfig?.extra?.eas?.projectId;
      const tokenData = await Notifications.getExpoPushTokenAsync({
        ...(projectId ? { projectId } : {}),
      });
      const token = tokenData.data;
      setExpoPushToken(token);

      // 서버에 토큰 등록
      try {
        await apiClient.post('/api/v1/patient-auth/device/push-token', {
          fcmToken: token,
          platform: Platform.OS,
          deviceId: `${Platform.OS}-${Device.modelName ?? 'unknown'}`,
        });
        if (__DEV__) console.log('[Push] Token registered:', token.slice(0, 20) + '...');
      } catch (e) {
        console.warn('[Push] Token registration failed:', e);
      }

      return token;
    } catch (e) {
      console.error('[Push] Token fetch failed:', e);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!Notifications) return;

    // 포그라운드 알림 수신 핸들러
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    // 알림 수신 리스너
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notif: any) => {
        setNotification({
          title: notif.request.content.title,
          body: notif.request.content.body,
          data: notif.request.content.data,
        });
      },
    );

    // 알림 탭 리스너 (알림 클릭 시 딥링크 네비게이션)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response: any) => {
        const data = response.notification.request.content.data;
        if (__DEV__) console.log('[Push] Notification tapped:', data);

        // 딥링크 네비게이션: data.route 또는 data.type 기반
        try {
          const { router } = require('expo-router');
          const route = data?.route as string | undefined;
          const type = data?.type as string | undefined;

          // O4: 신뢰 불가한 알림 payload의 route 는 앱 내부 경로만 허용(네비 인젝션 차단).
          // 외부 스킴·상대경로·../ 는 거부하고 type 기반 폴백으로 넘긴다.
          const isInternalRoute = typeof route === 'string' && /^\/(\(tabs\)|journey)\/[a-zA-Z0-9/_-]*$/.test(route);

          if (isInternalRoute) {
            router.push(route as string);
          } else if (type === 'APPOINTMENT') {
            router.push('/(tabs)/appointments');
          } else if (type === 'LAB_RESULT') {
            router.push('/(tabs)/labs');
          } else if (type === 'BILLING') {
            router.push('/(tabs)/billing');
          } else if (type === 'MEDICATION') {
            router.push('/(tabs)/medication');
          } else if (type === 'TELEHEALTH') {
            router.push('/(tabs)/telehealth');
          } else if (type === 'MESSAGE') {
            router.push('/(tabs)/messages');
          } else {
            router.push('/(tabs)/notifications');
          }
        } catch {
          console.warn('[Push] Navigation failed');
        }
      },
    );

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);

  return {
    expoPushToken,
    notification,
    requestPermission: registerForPushNotifications,
  };
}
