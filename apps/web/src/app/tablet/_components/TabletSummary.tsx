'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { VitalSignsGrid } from '@/components/vitals/VitalSigns';

type Summary = {
  patient?: { familyName?: string; givenName?: string; gender?: string; dateOfBirth?: string; mrn?: string; insuranceType?: string; bloodType?: string };
  latestVitals?: { systolicBp?: number; diastolicBp?: number; heartRate?: number; spO2?: number; temperature?: number; measuredAt?: string } | null;
  allergies?: Array<{ allergen: string; severity?: string }>;
  problems?: Array<{ id: string; description: string; code?: string; status?: string }>;
  activeRxCount?: number;
  recentEncounters?: Array<{ id: string; createdAt: string; doctorName?: string; status?: string }>;
};

function Card({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h3 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">{icon && <span>{icon}</span>}{title}</h3>
      {children}
    </div>
  );
}

/** 타블렛 요약 세그먼트 — /patients/:id/summary 단일 호출. */
export default function TabletSummary({ patientId }: { patientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['tablet-summary', patientId],
    queryFn: () => apiClient.get<{ data: Summary }>(`/api/v1/patients/${patientId}/summary`),
    staleTime: 60_000,
  });
  if (isLoading) return <div className="p-6 text-gray-400 text-base">불러오는 중…</div>;
  const s = (data?.data ?? {}) as Summary;
  const v = s.latestVitals;
  const allergies = s.allergies ?? [];
  const problems = s.problems ?? [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 pb-2">
      <Card title="최근 바이탈" icon="❤️">
        {v ? (
          // 표시 부품 정본 — spO2 별칭·미측정 '—'·임계 정본 색·측정 시각
          <VitalSignsGrid vitals={v as Record<string, unknown>} measuredAt={v.measuredAt ?? null} columns={2}
            keys={['spo2', 'systolicBp', 'heartRate', 'temperature']} />
        ) : <p className="text-gray-400">측정 기록 없음</p>}
      </Card>

      <Card title="알레르기" icon="🛡️">
        {allergies.length > 0 ? (
          <ul className="space-y-1.5">
            {allergies.map((a, i) => (
              <li key={i} className="text-base text-red-700 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500" />{a.allergen}{a.severity ? ` · ${a.severity}` : ''}</li>
            ))}
          </ul>
        ) : (
          /* 🔴 빈 목록을 "NKDA(확인됨)"이라 단정하지 않는다 — NKDA 는 **사정 행위의 결과**이지
             기록이 없다는 뜻이 아니다. 조회 실패도 같은 초록으로 보였다.
             이 카드는 **처방을 내는 자리**(타블렛 진료·프로토콜 보드)에 상시 떠 있다. */
          <p className="text-amber-700 text-base flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" />알레르기 기록 없음 — 사정 필요
          </p>
        )}
      </Card>

      <Card title="활성 문제목록" icon="📋">
        {problems.length > 0 ? (
          <ul className="space-y-2">
            {problems.slice(0, 6).map((p) => (
              <li key={p.id} className="text-base text-gray-800">{p.description}{p.code ? <span className="text-gray-400 text-sm"> ({p.code})</span> : null}</li>
            ))}
          </ul>
        ) : <p className="text-gray-400 text-base">활성 문제 없음</p>}
      </Card>

      <Card title="최근 진료" icon="🕑">
        {(s.recentEncounters ?? []).length > 0 ? (
          <ul className="space-y-2">
            {(s.recentEncounters ?? []).slice(0, 5).map((e) => (
              <li key={e.id} className="flex justify-between text-base">
                <span className="text-gray-800">{(e.createdAt ?? '').slice(0, 10)}</span>
                <span className="text-gray-500">{e.doctorName ?? ''} {e.status ? `· ${e.status}` : ''}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-gray-400 text-base">진료 이력 없음</p>}
        <div className="mt-3 text-base text-gray-600">활성 처방 <b className="text-gray-900">{s.activeRxCount ?? 0}</b>건</div>
      </Card>
    </div>
  );
}
