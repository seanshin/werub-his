'use client';
import RowListWidget, { asArray, When } from './RowListWidget';
import { T } from '@/components/ui/i18n-text';
import { PatientName } from '@/components/ui/display';
import { ORDER_DEPT_STATUS_LABEL } from '@hospital-run/shared';

const STATUS_KO: Record<string, string> = { ...ORDER_DEPT_STATUS_LABEL, IN_PROGRESS: '촬영중' }; // 정본+영상 도메인어(UX P1)

/**
 * 영상 대기 — imaging/queue(처방·환자 포함).
 * 🔴 (2026-10-02) 종전 행은 `IMAGING · 촬영중` — 부서 코드와 상태뿐이었다. 검사명은 수가 코드가 있으면 그 이름,
 *    없으면 처방 지시문(영상 오더는 코드 없이 지시문으로 들어온 것이 있다) — 둘 다 없으면 미상이라고 말한다.
 */
export default function ImagingQueueWidget() {
  return <RowListWidget widgetId="imaging-queue" endpoint="/api/v1/imaging/queue?limit=8" empty="영상 대기 없음" pick={(d) =>
    asArray(d).map((it: any) => {
      const p = it.prescription?.encounter?.patient;
      const exam = it.prescription?.procedureCode?.nameKo ?? it.prescription?.instructions;
      return {
        key: it.id,
        label: <span data-queue-row="imaging"><PatientName familyName={p?.familyName} givenName={p?.givenName} showMrn={false} maskable /> <span className="font-normal text-gray-500">· {exam ?? <T k="검사명 미상" />}</span></span>,
        right: <><T k={STATUS_KO[it.status] ?? it.status ?? ''} /> <When at={it.createdAt} /></>,
        tone: (it.priority === 'STAT' || it.priority === 'URGENT' ? 'rose' : 'gray') as 'rose' | 'gray',
      };
    })
  } />;
}
