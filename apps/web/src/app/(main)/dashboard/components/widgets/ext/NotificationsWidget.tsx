'use client';
import RowListWidget, { asArray } from './RowListWidget';
import { T } from '@/components/ui/i18n-text';

/** 알림 — notifications {title, message, severity} */
export default function NotificationsWidget() {
  return <RowListWidget widgetId="notifications" endpoint="/api/v1/notifications?limit=5" empty="새 알림 없음" pick={(d) =>
    asArray(d).map((it: any) => ({
      key: it.id,
      label: it.title ?? it.message ?? <T k="알림" />,
      right: it.isRead ? '' : '●',
      tone: (it.severity === 'HIGH' || it.severity === 'CRITICAL' ? 'rose' : 'gray') as 'rose' | 'gray',
    }))
  } />;
}
