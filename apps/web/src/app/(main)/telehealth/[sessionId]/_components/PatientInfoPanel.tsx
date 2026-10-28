'use client';

import type { TelehealthSession, PatientSummary, UserRole } from './types';
import { Unit, genderText } from '@/components/ui/display';
import { VitalSignsGrid } from '@/components/vitals/VitalSigns';
import { safeDateStr, calcAge } from './types';
import { AllergyStatusBadge } from '@/components/clinical/allergy-status';
import { T, Tf } from '@/components/ui/i18n-text';

interface Props {
  session: TelehealthSession;
  summary: PatientSummary | null;
  role: UserRole;
}

export default function PatientInfoPanel({ session, summary, role }: Props) {
  const p = session.patient;
  const v = summary?.latestVitals;

  return (
    <div className="w-60 shrink-0 border-r p-3 overflow-y-auto space-y-2.5">
      {/* 인적사항 */}
      <div className="bg-slate-50 rounded-lg p-2.5">
        <p className="text-sm font-bold text-gray-900">{p?.familyName}{p?.givenName}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-gray-400">{p?.mrn}</span>
          {p?.gender && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${p.gender === 'MALE' ? 'bg-blue-100 text-blue-600' : 'bg-pink-100 text-pink-600'}`}>
              {genderText(p.gender)}
            </span>
          )}
        </div>
        {p?.dateOfBirth && (
          <p className="text-[10px] text-gray-500 mt-0.5">
            {safeDateStr(p.dateOfBirth)} ({calcAge(p.dateOfBirth)}세)
          </p>
        )}
        {/* 약사: 체중/신장 강조 */}
        {role === 'PHARMACIST' && v && (
          <div className="flex gap-2 mt-1 text-[9px]">
            {v.weight != null && <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-bold">{v.weight}<Unit>kg</Unit></span>}
            {v.height != null && <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-bold">{v.height}<Unit>cm</Unit></span>}
          </div>
        )}
      </div>

      {/* 주호소 */}
      {session.chiefComplaint && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
          <p className="text-[10px] font-bold text-blue-600 mb-0.5"><T k="주호소" /></p>
          <p className="text-[11px] text-blue-800">{session.chiefComplaint}</p>
        </div>
      )}

      {/* 알레르기 — 🔴 요약 조회 실패(summary 부재)를 초록 NKA 로 단정하면 처방 화면에서
          자료 부족이 '안전'으로 읽힌다(P1-ⓑ). 모름과 없음을 가른다. */}
      {!summary ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
          <p className="text-[10px] text-amber-700"><T k="알레르기 정보 확인 불가 — 환자 요약을 불러오지 못했습니다. 수동 확인 필요" /></p>
        </div>
      ) : summary.allergies && summary.allergies.length > 0 ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2">
          <p className="text-[10px] font-bold text-red-600 mb-1">
            <T k={role === 'PHARMACIST' ? '약물 알레르기' : '알레르기'} />
          </p>
          <div className="flex flex-wrap gap-1">
            {summary.allergies.map((a, i) => (
              <span key={i} className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                {a.allergen}{a.severity === 'HIGH' ? ' ⚠️' : ''}{role === 'PHARMACIST' && a.type ? ` (${a.type})` : ''}
              </span>
            ))}
          </div>
        </div>
      ) : p?.id ? (
        /* 🔴 종전엔 빈 목록을 초록 "등록된 알레르기 없음"으로 그렸다 — 처방하는 의사·약사가 보는 자리다.
           4상태 정본이 "확인함"이라 말할 때만 초록이 된다. */
        <AllergyStatusBadge patientId={p.id} allergyCount={0} />
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
          <p className="text-[10px] text-amber-700"><T k="알레르기 확인 상태를 알 수 없습니다 — 없다는 뜻이 아닙니다." /></p>
        </div>
      )}

      {/* 바이탈 */}
      {v && (
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="최근 바이탈" /></p>
          {/* 🔴 (2026-10-07) 표시 부품 정본 — 종전엔 `formatTemp`(℃ 포함) 뒤에 `°C` 를 또 붙여 "36.5℃°C" · 이상 색 없음 ·
               미측정 항목이 사라졌다. 미측정 '—' · 임계 정본 색 · 체중은 약사 화면 제외(종전 그대로) */}
          <VitalSignsGrid vitals={v as unknown as Record<string, unknown>} columns={2}
            keys={role === 'PHARMACIST' ? ['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'temperature'] : ['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'temperature', 'weight']} />
        </div>
      )}

      {/* 활성 문제 */}
      {summary?.problems && summary.problems.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1"><T k="활성 문제" /></p>
          {summary.problems.slice(0, 5).map((pr, i) => (
            <div key={i} className="flex items-start gap-1 mb-0.5">
              <span className="text-[8px] text-gray-300 mt-0.5">●</span>
              <p className="text-[10px] text-gray-600 leading-tight">
                {pr.diagnosisCode?.nameKo ?? pr.description ?? '-'}
                {pr.diagnosisCode?.code && <span className="text-gray-300 ml-1">({pr.diagnosisCode.code})</span>}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* 복용 약물 — 약사는 전체, 나머지는 5건 */}
      {summary?.activeMedications && summary.activeMedications.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">
            <T k={role === 'PHARMACIST' ? '전체 복용 약물' : '복용 중 약물'} />
          </p>
          {(role === 'PHARMACIST' ? summary.activeMedications : summary.activeMedications.slice(0, 5)).map((m, i) => (
            <div key={i} className="mb-1">
              <p className="text-[10px] text-gray-700 font-medium truncate">{m.nameKo}</p>
              <p className="text-[9px] text-gray-400">{m.dosage} · {m.frequency}</p>
            </div>
          ))}
          {role !== 'PHARMACIST' && (summary.activeRxCount ?? 0) > 5 && (
            <p className="text-[9px] text-gray-400"><Tf k="외 {건수}건" params={{ 건수: (summary.activeRxCount ?? 0) - 5 }} /></p>
          )}
        </div>
      )}
      {!(summary?.activeMedications?.length) && (summary?.activeRxCount ?? 0) > 0 && (
        <p className="text-[10px] text-gray-500"><T k="활성 처방:" /> <span className="font-bold">{summary?.activeRxCount}<Unit><T k="건" /></Unit></span></p>
      )}
    </div>
  );
}
