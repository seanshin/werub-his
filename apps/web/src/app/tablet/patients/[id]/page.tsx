'use client';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePatient } from '@/hooks/usePatients';
import type { Patient } from '@/types/patient';
import TabletTopBar from '../../_components/TabletTopBar';
import SegmentedTabs, { type Segment } from '../../_components/SegmentedTabs';
import TabletActionBar from '../../_components/TabletActionBar';
import TabletSummary from '../../_components/TabletSummary';
import TabletRecords from '../../_components/TabletRecords';
import MoreSheet from '../../_components/MoreSheet';
import { VitalsTab } from '@/app/(main)/patients/[id]/components/VitalsTab';
import { LabResultsTab } from '@/app/(main)/patients/[id]/components/LabResultsTab';
import { MedicationTab } from '@/app/(main)/patients/[id]/components/MedicationTab';

const SEGMENTS: Segment[] = [
  { key: 'summary', label: '요약' },
  { key: 'vitals', label: '바이탈' },
  { key: 'labs', label: '검사' },
  { key: 'meds', label: '투약' },
  { key: 'records', label: '기록' },
];

export default function TabletChartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [seg, setSeg] = useState('summary');
  const [showMore, setShowMore] = useState(false);
  const { data } = usePatient(id);
  const patient = (data?.data ?? null) as Patient | null;

  return (
    <div className="min-h-screen flex flex-col pb-20">
      <TabletTopBar patient={patient} patientId={id} />

      <div className="flex items-center gap-2 pr-3">
        <div className="flex-1 min-w-0">
          <SegmentedTabs segments={SEGMENTS} active={seg} onChange={setSeg} />
        </div>
        <button onClick={() => setShowMore(true)} className="shrink-0 min-h-[48px] px-4 rounded-2xl text-base font-semibold bg-white text-gray-700 border border-gray-200">더보기 ▾</button>
      </div>

      <main className="flex-1">
        {seg === 'summary' && <TabletSummary patientId={id} />}
        {seg === 'vitals' && <div className="p-3"><VitalsTab patientId={id} /></div>}
        {seg === 'labs' && <div className="p-3"><LabResultsTab patientId={id} /></div>}
        {seg === 'meds' && <div className="p-3"><MedicationTab patientId={id} /></div>}
        {seg === 'records' && <TabletRecords patientId={id} />}
      </main>

      <TabletActionBar
        left={[{ key: 'enc', label: '진료 시작', icon: '📝', primary: true, onTap: () => router.push(`/tablet/patients/${id}/encounter`) }]}
        right={[{ key: 'desktop', label: '데스크탑', icon: '⤢', onTap: () => router.push(`/patients/${id}`) }]}
      />

      {showMore && <MoreSheet patientId={id} patientMrn={patient?.mrn} onClose={() => setShowMore(false)} />}
    </div>
  );
}
