'use client';

import { useState } from 'react';
import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { EmptyState, Unit, useDurationText } from '@/components/ui/display';
import { pollMs } from '@/lib/ui-settings';
import { EMERGENCY_VISIT_STATUS_LABEL } from '@hospital-run/shared';
import { KTAS_LEVEL_LABEL, KTAS_SOLID, KTAS_BORDER } from '@/lib/ktas';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

/**
 * ER 베드 보드(P0·2026-08-05) — 구역 그리드 + 미배정 트레이 + 클릭 배정.
 * 데이터는 GET /emergency/beds 1콜(정본=활성 assignment·유령 점유 서버 판정).
 */

interface BoardVisit {
  id: string;
  bedId?: string | null;
  patientId?: string;
  identityUnverified?: boolean;
  guardianRegistered?: boolean;
  /** 도착 상황 기록 수 — 신원미상만 센다(null = 세지 않음 · 0 = 센 결과 없음) */
  arrivalNoteCount?: number | null;
  suggestedZone?: string;
  triageLevel: string;
  chiefComplaint: string;
  arrivalAt: string;
  status: string;
  disposition?: string | null;
  dispositionAt?: string | null;
  onVentilator?: boolean;
  admissionId?: string | null;
  reassessOverdue?: boolean;
  sinceReassessMins?: number;
  patient?: { familyName: string; givenName: string; mrn: string; gender?: string; dateOfBirth?: string };
}
interface BoardBed {
  id: string;
  roomNumber: string;
  bedNumber: string;
  status: string;
  assignedAt?: string | null;
  ghost?: boolean;
  visit?: BoardVisit | null;
  cleaningMins?: number | null;
  cleaningOverdue?: boolean;
}

/**
 * 응급 보호자 등록(D11) — PatientContact 정본에 쓴다(모델 신설 없음). 법정대리인은 동의서
 * 대행 서명(guardianName·guardianRelation)과 같은 정본이라 별도 연계 없이 이어진다.
 */
function GuardianModal({ visit, onClose, onDone }: { visit: BoardVisit; onClose: () => void; onDone: () => void }) {
  const tAttr = useTAttr();
  const [f, setF] = useState({ name: '', relationship: 'PARENT', relationshipDetail: '', phone: '', phone2: '', isLegalGuardian: false, accompanied: true });
  const save = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/patients/${visit.patientId}/contacts`, {
      name: f.name.trim(), relationship: f.relationship,
      relationshipDetail: f.relationshipDetail.trim() || undefined,
      phone: f.phone.trim(), phone2: f.phone2.trim() || undefined,
      isEmergencyContact: true, isPrimaryContact: true,
      isLegalGuardian: f.isLegalGuardian,
      notes: f.accompanied ? '응급 접수 시 현장 동행' : '응급 접수 시 유선 연락',
    }),
    onSuccess: () => { toast.success(tAttr('보호자를 등록했습니다.')); onDone(); },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('보호자 등록 실패')),
  });
  const REL: [string, string][] = [['PARENT', '부모'], ['SPOUSE', '배우자'], ['CHILD', '자녀'], ['SIBLING', '형제자매'], ['GUARDIAN', '후견인'], ['OTHER', '기타']];
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-4 space-y-2.5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-gray-900"><Tf k="보호자 등록 — {환자}" params={{ 환자: patientName(visit) }} /></h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">{tAttr('관계')} *</label>
            <select value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })}
              className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              {REL.map(([k, l]) => <option key={k} value={k}>{tAttr(l)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="관계 상세" /></label>
            <input value={f.relationshipDetail} onChange={(e) => setF({ ...f, relationshipDetail: e.target.value })} placeholder={tAttr('예: 어머니')}
              className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="이름 *@항목" /></label>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
              className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">{tAttr('연락처')} *</label>
            <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="010-0000-0000"
              className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="연락처 2" /></label>
            <input value={f.phone2} onChange={(e) => setF({ ...f, phone2: e.target.value })}
              className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>
        <div className="flex gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={f.isLegalGuardian} onChange={(e) => setF({ ...f, isLegalGuardian: e.target.checked })} />
            <T k="법정대리인" /> <span className="text-[10px] text-gray-400"><T k="(미성년·의사무능력 동의 대행)" /></span>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={f.accompanied} onChange={(e) => setF({ ...f, accompanied: e.target.checked })} />
            <T k="현장 동행" />
          </label>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={() => save.mutate()} disabled={!f.name.trim() || !f.phone.trim() || save.isPending}
            className="flex-1 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:bg-blue-700">
            <T k={save.isPending ? '등록 중…' : '등록@버튼'} />
          </button>
          <button onClick={onClose} className="px-3 py-2 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="닫기" /></button>
        </div>
      </div>
    </div>
  );
}

const ZONES: { code: string; label: string }[] = [
  { code: 'RESUS', label: '소생' },
  { code: 'ACUTE', label: '중증' },
  { code: 'GEN', label: '일반' },
  { code: 'ISO', label: '격리' },
  { code: 'OBS', label: '관찰' },
];
const EMPTY_TONE: Record<string, string> = {
  AVAILABLE: 'border-emerald-200 bg-emerald-50/50 text-emerald-600',
  CLEANING: 'border-amber-200 bg-amber-50/60 text-amber-600',
  MAINTENANCE: 'border-gray-200 bg-gray-50 text-gray-400',
  ISOLATION: 'border-purple-200 bg-purple-50/60 text-purple-600',
  RESERVED: 'border-sky-300 border-dashed bg-sky-50/60 text-sky-600',
};
// 🔴 값은 i18n 키다(`<T k={EMPTY_LABEL[…]}>`) — RESERVED 는 무문맥 `예약`(=진료 Appointment)이 이기므로 `@병상`
const EMPTY_LABEL: Record<string, string> = {
  AVAILABLE: '가용', CLEANING: '청소 중', MAINTENANCE: '정비 중', ISOLATION: '격리 지정', RESERVED: '예약@병상',
};

// 🔴 종전엔 60분 미만을 정본 밖에서 `${m}분` 으로 따로 찍고 있었다 — 값은 같았지만 단위 낱말이
//    UI 언어를 안 따르는 **두 번째 포맷터**였다(P12). 조각 규칙은 정본 하나로 모은다.
function useElapsed() {
  const fmtDur = useDurationText(); // 표시 정본 — 24시간 이상은 일로, 단위어는 UI 언어를 따른다
  return (dt: string) => fmtDur(Math.floor((Date.now() - new Date(dt).getTime()) / 60000));
}
function patientName(v?: BoardVisit | null) {
  return `${v?.patient?.familyName ?? ''}${v?.patient?.givenName ?? ''}`.trim() || '-';
}
const ZONE_KO: Record<string, string> = { RESUS: '소생', ACUTE: '중증', GEN: '일반', ISO: '격리', OBS: '관찰' };

/** 미배정 트레이 항목 — 드래그해서 빈 베드에 놓으면 배정(P3·@dnd-kit) */
function DraggableTrayItem({ visit, onSelect }: { visit: BoardVisit; onSelect: () => void }) {
  const elapsed = useElapsed();
  const tAttr = useTAttr();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: visit.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 60 } : undefined}
      className={`flex items-center gap-2 rounded-xl border bg-white px-2.5 py-1.5 cursor-grab active:cursor-grabbing touch-none ${
        isDragging ? 'shadow-lg ring-2 ring-blue-300 opacity-90' : ''
      } ${['LEVEL_1', 'LEVEL_2'].includes(visit.triageLevel) ? 'border-rose-300 shadow-sm' : 'border-gray-200'}`}>
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${KTAS_SOLID[visit.triageLevel] ?? 'bg-gray-200'}`}><T k={KTAS_LEVEL_LABEL[visit.triageLevel] ?? visit.triageLevel} /></span>
      <button onClick={onSelect} className="text-xs font-semibold text-gray-800 hover:text-blue-600">{patientName(visit)}</button>
      <span className="text-[10px] text-gray-400"><Tf k="도착 {경과}" params={{ 경과: elapsed(visit.arrivalAt) }} /></span>
      <span className="text-[10px] text-gray-500 max-w-[120px] truncate">{visit.chiefComplaint}</span>
      {visit.suggestedZone && (
        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-blue-50 text-blue-500" title={tAttr('규칙 기반 권장 구역(강제 아님)')}>
          <Tf k="권장 {구역}" params={{ 구역: <T k={ZONE_KO[visit.suggestedZone] ?? visit.suggestedZone} /> }} />
        </span>
      )}
    </div>
  );
}

/** 빈 베드 드롭 존 래퍼 */
function DroppableBed({ id, disabled, children }: { id: string; disabled: boolean; children: (isOver: boolean) => React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return <div ref={setNodeRef}>{children(isOver && !disabled)}</div>;
}

export function BedBoard({ onSelectVisit }: { onSelectVisit: (visitId: string) => void }) {
  const fmtDur = useDurationText();
  const elapsed = useElapsed();
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [assignTarget, setAssignTarget] = useState<BoardBed | null>(null); // 빈 베드 클릭 → 환자 선택
  const [moveVisit, setMoveVisit] = useState<BoardVisit | null>(null); // 이동 모드 — 다음 가용 베드 클릭이 목적지

  const boardQ = useQuery({
    queryKey: ['er-bed-board'],
    queryFn: () => apiClient.get<{ data: { beds: BoardBed[]; unassigned: BoardVisit[]; meta?: { boardingWarnMinutes?: number; receptionSeparated?: boolean; guardianGate?: string } } }>('/api/v1/emergency/beds'),
    refetchInterval: pollMs('fast'),
  });
  const board = boardQ.data?.data;
  const beds = board?.beds ?? [];
  const unassigned = board?.unassigned ?? [];
  const boardingWarnMin = board?.meta?.boardingWarnMinutes ?? 120;
  const receptionSeparated = board?.meta?.receptionSeparated !== false;
  const guardianGateOn = board?.meta?.guardianGate !== 'OFF';
  /**
   * 🔴 (2026-09-17 L3) 보호자 등록은 `PatientContact` 쓰기라 서버가 `PATIENT_RELATION_EDIT` 를 요구한다 —
   *    보유자는 ADMIN·NURSE·RECEPTIONIST 고 **의사는 없다**(인적·관계 정보는 원무 성격 · 이 화면 주석도
   *    "응급 원무는 접수만: 신원 확인·보호자 등록 후속"이라고 적는다). 그런데 버튼은 재실 환자 모두에게
   *    그려져 의사가 누르면 403 이었다. 등록 주체가 아닌 역할에게는 **등록 버튼 대신 미등록 사실만** 보인다.
   */
  const canRegisterGuardian = useHasRole('NURSE', 'RECEPTIONIST');
  const [guardianTarget, setGuardianTarget] = useState<BoardVisit | null>(null);
  const [checkoutTarget, setCheckoutTarget] = useState<BoardVisit | null>(null); // 퇴실 확인창(퇴실 시각 D9)
  // 접수 트랙(D10·분리 운영 시) — 신원 확인 중·보호자 미등록 재실 환자(접수 전용 — 예약·수납 없음)
  const allVisits = [...unassigned, ...beds.map((b) => b.visit).filter((v): v is BoardVisit => !!v)];
  const receptionRows = receptionSeparated
    ? allVisits.filter((v) => v.identityUnverified || (guardianGateOn && v.guardianRegistered === false))
    : [];

  const refresh = () => qc.invalidateQueries({ queryKey: ['er-bed-board'] });
  const onErr = (e: unknown) => { toast.error((e as { message?: string })?.message || tAttr('처리 실패')); refresh(); };

  const assignMut = useMutation({
    mutationFn: (p: { visitId: string; bedId: string }) => apiClient.post('/api/v1/emergency/beds/assign', p),
    onSuccess: () => { toast.success(tAttr('베드에 배정했습니다.')); setAssignTarget(null); refresh(); },
    onError: onErr,
  });
  const moveMut = useMutation({
    mutationFn: (p: { visitId: string; toBedId: string }) => apiClient.post('/api/v1/emergency/beds/move', p),
    onSuccess: () => { toast.success(tAttr('베드를 이동했습니다 (원 베드는 청소 대기).')); setMoveVisit(null); refresh(); },
    onError: onErr,
  });
  const releaseMut = useMutation({
    mutationFn: (p: { visitId: string }) => apiClient.post('/api/v1/emergency/beds/release', p),
    onSuccess: () => { toast.success(tAttr('베드를 해제했습니다 (청소 대기).')); refresh(); },
    onError: onErr,
  });
  const statusMut = useMutation({
    mutationFn: (p: { bedId: string; status: string }) => apiClient.patch(`/api/v1/emergency/beds/${p.bedId}/status`, { status: p.status }),
    onSuccess: () => refresh(),
    onError: onErr,
  });
  // 퇴실(P1) — 결정≠퇴실: 처분 결정된 환자를 물리적으로 내보내며 베드 자동 해제(CLEANING)
  const checkoutMut = useMutation({
    // 퇴실 시각(2026-10-03 결정 D9) — 비우면 지금(서버 처리 시각) · 넣으면 직원이 입력한 시각(입력값으로 표식)
    mutationFn: (p: { visitId: string; departedAt?: string }) => apiClient.post(`/api/v1/emergency/visits/${p.visitId}/checkout`, p.departedAt ? { departedAt: p.departedAt } : {}),
    onSuccess: () => { toast.success(tAttr('퇴실 처리했습니다 (베드는 청소 대기).')); setCheckoutTarget(null); refresh(); },
    onError: onErr,
  });

  // KTAS 1·2 를 GEN/OBS 에 놓을 때 경고(차단 아님 — WARN 게이트 사상)
  const confirmZone = (visit: BoardVisit, bed: BoardBed) => {
    const severe = ['LEVEL_1', 'LEVEL_2'].includes(visit.triageLevel);
    const soft = ['GEN', 'OBS'].includes(bed.roomNumber);
    if (severe && soft) {
      // 🔴 등급·구역 라벨도 로케일을 탄다(문장만 번역되고 라벨이 한국어로 남으면 경고가 반쯤만 읽힌다)
      const zoneLabel = ZONES.find((z) => z.code === bed.roomNumber)?.label;
      return confirm(tfAttr('KTAS {등급} 환자를 {구역} 구역에 배정합니다.\n소생·중증 구역이 아닙니다 — 계속할까요?', {
        등급: tAttr(KTAS_LEVEL_LABEL[visit.triageLevel] ?? ''), 구역: zoneLabel ? tAttr(zoneLabel) : bed.roomNumber,
      }));
    }
    return true;
  };

  const clickEmptyBed = (bed: BoardBed) => {
    if (moveVisit) {
      if (!confirmZone(moveVisit, bed)) return;
      moveMut.mutate({ visitId: moveVisit.id, toBedId: bed.id });
      return;
    }
    if (bed.status === 'AVAILABLE' || bed.status === 'RESERVED') setAssignTarget(bed);
  };

  // 드래그 배정(P3) — 5px 이동 후 활성화(내부 버튼 클릭과 공존)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const visit = unassigned.find((v) => v.id === e.active.id);
    const bed = beds.find((b) => b.id === e.over!.id);
    if (!visit || !bed || !['AVAILABLE', 'RESERVED'].includes(bed.status)) return;
    if (!confirmZone(visit, bed)) return;
    assignMut.mutate({ visitId: visit.id, bedId: bed.id });
  };

  if (boardQ.isLoading) return <div className="py-16 text-center text-sm text-gray-400"><T k="베드 보드 불러오는 중…" /></div>;
  if (beds.length === 0) return <EmptyState icon="🛏" title="응급실 베드가 없습니다" hint="관리자에게 응급병동 베드 구성을 요청하세요." />;

  const occupied = beds.filter((b) => b.visit).length;
  const cleaning = beds.filter((b) => b.status === 'CLEANING').length;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
    <div className="space-y-4">
      {/* 요약 + 이동 모드 안내 */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 font-medium"><Tf k="점유 {점유}/{전체}" params={{ 점유: occupied, 전체: beds.length }} /></span>
        {unassigned.length > 0 && <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-600 font-bold"><Tf k="미배정 {수}" params={{ 수: <>{unassigned.length}<Unit>명</Unit></> }} /></span>}
        {cleaning > 0 && <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600 font-medium">🧹 <Tf k="청소대기 {수}" params={{ 수: cleaning }} /></span>}
        {moveVisit && (
          <span className="px-2.5 py-1 rounded-lg bg-blue-600 text-white font-bold animate-pulse">
            <Tf k="{환자} 이동 중 — 옮길 베드를 클릭하세요" params={{ 환자: patientName(moveVisit) }} />
            <button onClick={() => setMoveVisit(null)} className="ml-2 underline"><T k="취소" /></button>
          </span>
        )}
      </div>

      {/* 접수 트랙(D10·분리 운영) — 응급 원무는 접수만: 신원 확인·보호자 등록 후속. 예약·수납 요소 없음 */}
      {receptionRows.length > 0 && (
        <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold text-sky-600"><T k="응급 접수 트랙 (원무)" /></p>
            <a href="/patients/register/emergency" className="text-[11px] text-sky-600 hover:underline font-medium"><T k="응급 미확인 등록" /> →</a>
          </div>
          <div className="flex gap-2 flex-wrap">
            {receptionRows.map((v) => (
              <div key={v.id} className="flex items-center gap-1.5 rounded-xl border border-sky-200 bg-white px-2.5 py-1.5">
                <span className="text-xs font-semibold text-gray-800">{patientName(v)}</span>
                {v.identityUnverified && (
                  <a href={v.patientId ? `/patients/${v.patientId}` : '#'}
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 hover:bg-orange-200"><T k="신원 확인 중" /> →</a>
                )}
                {/* 도착 상황 기록 — 센 결과가 0 이면 "없음"(기록하러 가기) · 세지 않았으면(null) 아무것도 그리지 않는다 */}
                {v.identityUnverified && v.arrivalNoteCount === 0 && (
                  <a href={v.patientId ? `/patients/${v.patientId}` : '#'}
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-600 hover:bg-rose-200"><T k="도착 기록 없음 — 기록" /> →</a>
                )}
                {v.identityUnverified && v.arrivalNoteCount != null && v.arrivalNoteCount > 0 && (
                  <a href={v.patientId ? `/patients/${v.patientId}` : '#'}
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200"><Tf k="도착 기록 {n}건" params={{ n: v.arrivalNoteCount ?? 0 }} /></a>
                )}
                {guardianGateOn && v.guardianRegistered === false && (
                  canRegisterGuardian ? (
                    <button onClick={() => setGuardianTarget(v)}
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-600 hover:bg-rose-200"><T k="보호자 미등록 — 등록" /></button>
                  ) : (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-500"><T k="보호자 미등록" /></span>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 미배정 트레이 — KTAS 1·2 먼저 */}
      {unassigned.length > 0 && (
        <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-3">
          <p className="text-[11px] font-bold text-rose-500 mb-2"><T k="미배정 재실 (중증 우선)" /></p>
          <div className="flex gap-2 flex-wrap">
            {[...unassigned].sort((a, b) => a.triageLevel.localeCompare(b.triageLevel) || a.arrivalAt.localeCompare(b.arrivalAt)).map((v) => (
              <DraggableTrayItem key={v.id} visit={v} onSelect={() => onSelectVisit(v.id)} />
            ))}
          </div>
          <p className="text-[10px] text-rose-400 mt-1.5"><T k="빈 베드를 클릭하거나, 환자를 끌어다 놓아 배정하세요" /></p>
        </div>
      )}

      {/* 구역 그리드 */}
      {ZONES.map((zone) => {
        const zoneBeds = beds.filter((b) => b.roomNumber === zone.code);
        if (zoneBeds.length === 0) return null;
        const zoneOcc = zoneBeds.filter((b) => b.visit).length;
        return (
          <div key={zone.code}>
            <p className="text-[11px] font-bold text-gray-500 mb-1.5">
              <T k={zone.label} /> <span className="font-mono text-gray-300">{zone.code}</span>
              <span className="ml-1.5 text-gray-400 font-normal">{zoneOcc}/{zoneBeds.length}</span>
              {zone.code === 'ISO' && <span className="ml-1.5 text-purple-500">⚠ <T k="격리" /></span>}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
              {zoneBeds.map((bed) => {
                const v = bed.visit;
                if (!v) {
                  const droppable = bed.status === 'AVAILABLE' || bed.status === 'RESERVED';
                  return (
                    <DroppableBed key={bed.id} id={bed.id} disabled={!droppable}>
                    {(isOver) => (
                    <button onClick={() => clickEmptyBed(bed)}
                      className={`w-full rounded-xl border-2 p-2.5 min-h-[92px] text-left transition-colors ${EMPTY_TONE[bed.status] ?? EMPTY_TONE.AVAILABLE} ${droppable ? 'hover:ring-2 hover:ring-blue-200' : 'cursor-default'} ${isOver ? 'ring-4 ring-blue-400 scale-[1.02]' : ''}`}>
                      <p className="text-xs font-bold">{zone.code}-{bed.bedNumber}</p>
                      <p className={`text-[11px] mt-1 font-medium ${bed.cleaningOverdue ? 'text-rose-600 font-bold' : ''}`}>
                        {bed.ghost ? <>⚠ <T k="유령 점유" /></> : <T k={EMPTY_LABEL[bed.status] ?? bed.status} />}
                        {/* 🔴 원시 분 금지 — 실측 `10287분 지연`(=7일 3시간)이 떴다 */}
                        {bed.status === 'CLEANING' && bed.cleaningMins != null && <>{` · ${fmtDur(bed.cleaningMins)}`}{bed.cleaningOverdue && <>{' '}<T k="지연" /></>}</>}
                      </p>
                      {bed.status === 'CLEANING' && (
                        <span onClick={(e) => { e.stopPropagation(); statusMut.mutate({ bedId: bed.id, status: 'AVAILABLE' }); }}
                          className="inline-block mt-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-white border border-amber-300 hover:bg-amber-100">✓ <T k="청소 완료" /></span>
                      )}
                      {/* 🔴 '예약' 버튼은 의도적 미배선 — 무문맥 `예약`=진료 Appointment, `예약@병상`=상태 Reserved 뿐이라
                          "예약한다"(행위)를 옮길 키가 없다. `예약@행위` 신설은 추가 언어 팩 6종에 문맥 결손을 만든다(팩과 함께 할 일). */}
                      {bed.status === 'AVAILABLE' && (
                        <span onClick={(e) => { e.stopPropagation(); statusMut.mutate({ bedId: bed.id, status: 'RESERVED' }); }}
                          title={tAttr('사전통보 도착 임박 환자용 예약(수동 판단 — 자동 강제 없음)')}
                          className="inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded bg-white/60 border border-emerald-200 text-emerald-500 hover:bg-sky-50 hover:border-sky-300 hover:text-sky-600">예약</span>
                      )}
                      {bed.status === 'RESERVED' && (
                        <span onClick={(e) => { e.stopPropagation(); statusMut.mutate({ bedId: bed.id, status: 'AVAILABLE' }); }}
                          className="inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded bg-white border border-sky-300 text-sky-600 hover:bg-sky-100"><T k="예약 해제" /></span>
                      )}
                      {bed.ghost && (
                        <span onClick={(e) => { e.stopPropagation(); statusMut.mutate({ bedId: bed.id, status: 'AVAILABLE' }); }}
                          className="inline-block mt-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-white border border-gray-300 hover:bg-gray-100"><T k="정리@병상" /></span>
                      )}
                    </button>
                    )}
                    </DroppableBed>
                  );
                }
                const boarding = v.disposition === 'ADMISSION' && !v.admissionId;
                const boardingMins = boarding && v.dispositionAt ? Math.floor((Date.now() - new Date(v.dispositionAt).getTime()) / 60000) : null;
                const boardingWarn = boardingMins != null && boardingMins > boardingWarnMin;
                // 퇴원·전원 결정됨(입원 제외) → 퇴실 버튼(결정≠퇴실 — 물리적 퇴실 시 베드 해제)
                const canCheckout = !!v.disposition && v.disposition !== 'ADMISSION';
                return (
                  <div key={bed.id} className={`rounded-xl border-2 border-l-8 bg-white p-2.5 min-h-[92px] shadow-sm ${KTAS_BORDER[v.triageLevel] ?? 'border-gray-200'}`}>
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs font-bold text-gray-500">{zone.code}-{bed.bedNumber}</p>
                      <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${KTAS_SOLID[v.triageLevel] ?? 'bg-gray-200'}`}><T k={KTAS_LEVEL_LABEL[v.triageLevel] ?? v.triageLevel} /></span>
                    </div>
                    <button onClick={() => onSelectVisit(v.id)} className="mt-0.5 text-sm font-bold text-gray-900 hover:text-blue-600 truncate block w-full text-left">
                      {patientName(v)}
                    </button>
                    <p className="text-[10px] text-gray-500 truncate">{v.chiefComplaint}</p>
                    <div className="mt-1 flex items-center gap-1 flex-wrap">
                      <span className="text-[9px] text-gray-400">⏱ {elapsed(v.arrivalAt)}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-500"><T k={EMERGENCY_VISIT_STATUS_LABEL[v.status] ?? v.status} /></span>
                      {v.onVentilator && <span className="text-[9px] px-1 py-0.5 rounded bg-rose-100 text-rose-600 font-bold"><T k="인공호흡기" /></span>}
                      {v.reassessOverdue && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-bold" title={tfAttr('마지막 재평가 후 {경과} 경과 — KTAS 목표 간격 초과', { 경과: fmtDur(v.sinceReassessMins) })}>⚠ <T k="재평가 지연" /></span>}
                      {boarding && (
                        <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${boardingWarn ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'}`}
                          title={boardingWarn ? tfAttr('입원 결정 후 {경과} 경과 — 경고 기준({기준}분) 초과', { 경과: fmtDur(boardingMins), 기준: boardingWarnMin }) : undefined}>
                          🛏 {boardingMins != null ? <Tf k="입원대기 {경과}" params={{ 경과: fmtDur(boardingMins) }} /> : <T k="입원대기" />}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex gap-1 flex-wrap">
                      <button onClick={() => setMoveVisit(v)} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-600"><T k="이동@베드" /></button>
                      {/* 🔴 '해제'·'퇴실' 버튼 글자는 의도적 미배선 — 무문맥 `해제`=Clear(검사 해제)·`퇴실`=Left ER(상태)라 행위 버튼으로 옮기면
                          "이미 나갔다"로 읽힌다. 문맥 키 신설은 추가 언어 팩 6종에 결손을 만든다(팩과 함께 할 일). 확인창 문장은 배선했다. */}
                      <button onClick={() => { if (confirm(tfAttr('{환자} 님의 베드를 해제할까요? (베드는 청소 대기로 전환)', { 환자: patientName(v) }))) releaseMut.mutate({ visitId: v.id }); }}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 hover:bg-rose-50 hover:text-rose-600">해제</button>
                      {boarding && (
                        <a href="/workstation/emergency" className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 font-semibold"><T k="병상 배정" /> →</a>
                      )}
                      {canCheckout && (
                        <button onClick={() => setCheckoutTarget(v)} data-er-checkout={v.id}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-semibold">퇴실</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {checkoutTarget && (
        <CheckoutDialog visit={checkoutTarget} name={patientName(checkoutTarget)} pending={checkoutMut.isPending}
          onClose={() => setCheckoutTarget(null)} onConfirm={(departedAt) => checkoutMut.mutate({ visitId: checkoutTarget.id, departedAt })} />
      )}
      {guardianTarget && (
        <GuardianModal visit={guardianTarget} onClose={() => setGuardianTarget(null)}
          onDone={() => { setGuardianTarget(null); refresh(); }} />
      )}

      {/* 빈 베드 클릭 → 미배정 환자 선택 */}
      {assignTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setAssignTarget(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4 space-y-2" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-900">
              <Tf k="{베드} 베드 배정" params={{ 베드: `${assignTarget.roomNumber}-${assignTarget.bedNumber}` }} />
              {assignTarget.status === 'RESERVED' && <span className="ml-1.5 text-[10px] text-sky-500"><T k="예약 베드" /></span>}
            </h3>
            {unassigned.length === 0 ? (
              <EmptyState compact icon="✅" title="미배정 재실 환자가 없습니다" />
            ) : (
              <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                {[...unassigned].sort((a, b) => a.triageLevel.localeCompare(b.triageLevel)).map((v) => (
                  <button key={v.id}
                    onClick={() => { if (confirmZone(v, assignTarget)) assignMut.mutate({ visitId: v.id, bedId: assignTarget.id }); }}
                    disabled={assignMut.isPending}
                    className="w-full flex items-center gap-2 px-2 py-2 text-left hover:bg-blue-50 rounded-lg disabled:opacity-50">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${KTAS_SOLID[v.triageLevel] ?? 'bg-gray-200'}`}><T k={KTAS_LEVEL_LABEL[v.triageLevel] ?? v.triageLevel} /></span>
                    <span className="text-sm font-semibold text-gray-800">{patientName(v)}</span>
                    {v.suggestedZone && (
                      <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${v.suggestedZone === assignTarget.roomNumber ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}
                        title={tAttr('규칙 기반 권장 구역(강제 아님)')}>
                        <Tf k="권장 {구역}" params={{ 구역: <T k={ZONE_KO[v.suggestedZone] ?? v.suggestedZone} /> }} />{v.suggestedZone === assignTarget.roomNumber ? ' ✓' : ''}
                      </span>
                    )}
                    <span className="text-[11px] text-gray-400 truncate flex-1">{v.chiefComplaint}</span>
                    <span className="text-[10px] text-gray-400"><Tf k="도착 {경과}" params={{ 경과: elapsed(v.arrivalAt) }} /></span>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setAssignTarget(null)} className="w-full py-2 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="닫기" /></button>
          </div>
        </div>
      )}
    </div>
    </DndContext>
  );
}

/**
 * 응급 퇴실 확인(2026-10-03 결정 D9 = 퇴실 시각 칸) — 퇴실 시각을 원장에 남긴다.
 * 비우면 지금(처리 시각) · 실제로 나간 시각이 다르면 넣는다(서버가 "입력한 시각"으로 표식 · 도착 이전·미래는 거부).
 */
export function CheckoutDialog({ visit, name, pending, onClose, onConfirm }: { visit: BoardVisit; name: string; pending: boolean; onClose: () => void; onConfirm: (departedAt?: string) => void }) {
  const tfAttr = useTfAttr();
  const [local, setLocal] = useState(''); // datetime-local(병원 로컬) — 비어 있으면 지금
  const iso = local ? new Date(local).toISOString() : undefined;
  const beforeArrival = !!iso && new Date(iso).getTime() < new Date(visit.arrivalAt).getTime();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" data-er-checkout-dialog>
      <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 text-sm shadow-xl">
        <p className="font-semibold text-gray-900">{tfAttr('{환자} 님을 퇴실 처리할까요?', { 환자: name })}</p>
        <p className="text-xs text-gray-600"><T k="방문이 종결되고 베드는 청소 대기로 전환됩니다. (수납 미완료여도 퇴실 가능 — 미수납은 수납 화면에서)" /></p>
        <label className="block text-xs">
          <span className="text-gray-500"><T k="실제 퇴실 시각(지금과 다를 때만)" /></span>
          <input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} data-er-departed-at
            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5" />
        </label>
        <p className="text-[11px] text-gray-500">{local ? <T k="입력한 시각으로 기록합니다(직원 입력으로 표식)" /> : <T k="비우면 지금 시각으로 기록합니다" />}</p>
        {beforeArrival && <p className="text-[11px] text-rose-600" data-er-departed-invalid><T k="도착 시각보다 앞선 시각은 기록할 수 없습니다" /></p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-gray-700"><T k="취소" /></button>
          <button type="button" onClick={() => onConfirm(iso)} disabled={pending || beforeArrival} data-er-checkout-confirm
            className="min-h-[44px] rounded-lg bg-emerald-600 px-4 font-semibold text-white disabled:opacity-50"><T k="퇴실 확정" /></button>
        </div>
      </div>
    </div>
  );
}
