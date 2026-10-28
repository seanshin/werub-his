'use client';
import RowListWidget, { asArray, When } from './RowListWidget';
import { T } from '@/components/ui/i18n-text';

const URGENCY_KO: Record<string, string> = { ROUTINE: '일반', URGENT: '긴급', EMERGENT: '응급' };

/** 받은 협진요청 — consultations/inbox {requestingDoctor.department, encounter.patient, urgency} */
export default function ConsultInboxWidget() {
  return <RowListWidget widgetId="consult-inbox" endpoint="/api/v1/consultations/inbox?limit=8" empty="받은 협진 없음" refetchInterval={60000} pick={(d) =>
    asArray(d).map((it: any) => {
      const p = it.encounter?.patient;
      const name = p ? `${p.familyName ?? ''}${p.givenName ?? ''}` : '환자';
      const dept = it.requestingDoctor?.department ?? '타과';
      return {
        key: it.id,
        label: `${dept} · ${name}`,
        // 요청 시각을 함께 — 오래 묵은 요청이 오늘 것처럼 보이지 않게(2026-10-02)
        right: <><T k={URGENCY_KO[it.urgency] ?? it.urgency ?? ''} /> <When at={it.createdAt} /></>,
        tone: (it.urgency === 'EMERGENT' ? 'rose' : it.urgency === 'URGENT' ? 'amber' : 'gray') as 'rose' | 'amber' | 'gray',
      };
    })
  } />;
}
