'use client';
import RowListWidget, { asArray, When } from './RowListWidget';
import { T } from '@/components/ui/i18n-text';
import { DrugName, PatientName } from '@/components/ui/display';
import { pharmacyStageOf, PHARMACY_STAGE_LABEL } from '@/lib/widget-summaries';

/**
 * 조제 대기 — pharmacy/queue(처방·환자·약품·조제 상태 포함).
 * 🔴 (2026-10-02) 종전 행은 `INTERNAL · 접수대기` 처럼 **조제 구분 코드와 오더 상태뿐** — 누구의 무슨 약인지가 없었고,
 *    검수·불출 대기 건(오더는 COMPLETED)이 "완료"로 보였다. 단계는 정본 `pharmacyStageOf`(약국 화면과 같은 판정).
 */
export default function PharmacyQueueWidget() {
  return <RowListWidget widgetId="pharmacy-queue" endpoint="/api/v1/pharmacy/queue?limit=8" empty="조제 대기 없음" pick={(d) =>
    asArray(d).map((it: any) => {
      const med = it.prescription?.medicationCode;
      const p = it.prescription?.encounter?.patient;
      const stat = (it.prescription?.priority ?? it.priority) === 'STAT' || (it.prescription?.priority ?? it.priority) === 'URGENT';
      return {
        key: it.id,
        label: <span data-queue-row="pharmacy"><PatientName familyName={p?.familyName} givenName={p?.givenName} showMrn={false} maskable /> <span className="font-normal text-gray-500">· {med ? <DrugName nameKo={med.nameKo} nameEn={med.nameEn} ingredient={med.ingredient} /> : <T k="약물" />}</span></span>,
        right: <><T k={PHARMACY_STAGE_LABEL[pharmacyStageOf(it)]} /> <When at={it.createdAt} /></>,
        tone: (stat ? 'rose' : 'gray') as 'rose' | 'gray',
      };
    })
  } />;
}
