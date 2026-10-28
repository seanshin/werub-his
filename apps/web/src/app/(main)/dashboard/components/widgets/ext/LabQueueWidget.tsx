'use client';
import RowListWidget, { asArray, When } from './RowListWidget';
import { T } from '@/components/ui/i18n-text';
import { PatientName } from '@/components/ui/display';
import { ORDER_DEPT_STATUS_LABEL } from '@hospital-run/shared';

const STATUS_KO: Record<string, string> = ORDER_DEPT_STATUS_LABEL; // 정본(UX P1)

/**
 * 검사 대기 — lab/queue(처방·환자·검사 코드 포함).
 * 🔴 (2026-10-02) 종전 행은 `LAB · 접수대기` — 부서 코드와 상태뿐이라 누구의 무슨 검사인지 없었다.
 */
export default function LabQueueWidget() {
  return <RowListWidget widgetId="lab-queue" endpoint="/api/v1/lab/queue?limit=8" empty="검사 대기 없음" pick={(d) =>
    asArray(d).map((it: any) => {
      const p = it.prescription?.encounter?.patient;
      const test = it.prescription?.procedureCode?.nameKo ?? it.prescription?.procedureCode?.code;
      return {
        key: it.id,
        label: <span data-queue-row="lab"><PatientName familyName={p?.familyName} givenName={p?.givenName} showMrn={false} maskable /> <span className="font-normal text-gray-500">· {test ?? <T k="검사명 미상" />}</span></span>,
        right: <><T k={STATUS_KO[it.status] ?? it.status ?? ''} /> <When at={it.createdAt} /></>,
        tone: (it.priority === 'STAT' || it.priority === 'URGENT' ? 'rose' : 'gray') as 'rose' | 'gray',
      };
    })
  } />;
}
