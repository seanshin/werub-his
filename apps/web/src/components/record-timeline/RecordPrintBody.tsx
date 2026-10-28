'use client';

import { isAbnormalFlag, isJudgedFlag, LAB_FLAG_UNJUDGED_TEXT } from '@hospital-run/shared';
import { PrintDoc, useDocHash, breakKey, CheckCell } from '@/components/print/PrintSheet';
import { fmt, trackStatusLabel, TRACK_UI, type TItem } from './record-card';
import { kdate } from '@/lib/ui-settings';

/**
 * 임상 기록 인쇄본(2026-10-12) — 기록 상세 창·환자/입원 시계열 창의 인쇄 버튼은 화면을 찍지 않고 이 문서를 찍는다.
 *
 * 🔴 지키는 것:
 *  · 없는 칸은 싣지 않는다 — 비어 있는 것을 0 이나 "정상"으로 찍지 않는다
 *    (활력은 잰 것만 · 검사 판정은 shared 정본 — 미판정은 "판정 불가")
 *  · 식별자(기록 id)는 작은 고정폭 보조 글자 · 행별 기계 코드는 넣지 않는다(사람 확인 칸 ☐·서명)
 *  · QR 에는 환자 이름·등록번호를 넣지 않는다 — 종류·버전·환자/입원 UUID·기록 id·시각·건수만
 *  · 시계열은 **화면에 걸린 조건 그대로**(기간·유형) — 잘렸으면(조회 상한·이어받지 않은 페이지) 맨 위에 크게 말한다
 */

export interface PrintSubject { name?: string | null; mrn?: string | null }

const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';

type KV = [string, string];

/** 기록 종류별 사람이 읽는 칸 — 값이 있는 것만 */
export function recordKvRows(it: TItem): KV[] {
  const out: KV[] = [];
  const push = (k: string, v: unknown) => { if (has(v)) out.push([k, String(v)]); };
  const s = it.soap ?? {};
  switch (it.type) {
    case 'ENCOUNTER':
      push('내원 구분', it.visitType); push('주호소(C.C.)', it.title);
      push('S 주관적', s.S); push('O 객관적', s.O); push('A 평가', s.A); push('P 계획', s.P);
      if (it.rxCount) push('처방', `${it.rxCount}건`);
      break;
    case 'NURSING':
    case 'PROGRESS_NOTE': {
      push('구분', [it.context, it.noteType, it.shift].filter(has).join(' · '));
      push('Focus', it.focus);
      const d = it.dar ?? {};
      push('D 자료', d.D); push('A 활동', d.A); push('R 반응', d.R); push('E 교육', d.E);
      push('S', s.S); push('O', s.O); push('A', s.A); push('P', s.P);
      const b = it.sbar ?? {};
      push('S 상황', b.S); push('B 배경', b.B); push('A 평가', b.A); push('R 권고', b.R);
      push('내용', it.content);
      if (it.canonBypass) push('주의', '입원 간호기록 정본을 우회해 저장된 기록입니다(서명·QA 대상 아님)');
      break;
    }
    case 'LAB':
      push('검사', it.title);
      push('채취', it.collectedAt ? fmt(it.collectedAt) : null);
      push('완료', it.completedAt ? fmt(it.completedAt) : null);
      push('확정', it.verifiedAt ? fmt(it.verifiedAt) : null);
      break;
    case 'IMAGING':
      push('검사', it.title);
      push('촬영 시각', it.acquiredAt ? fmt(it.acquiredAt) : null);
      push('판독 보고', it.reportedAt ? fmt(it.reportedAt) : null);
      push('소견', it.finding); push('결론', it.impression);
      break;
    case 'PRESCRIPTION':
      push('약품·처치', it.title); push('구분', it.rxType); push('약품코드', it.code);
      push('용량', it.dosage); push('용법', it.frequency); push('투여경로', it.route);
      push('일수', it.duration ? `${it.duration}일` : null); push('지시', it.instructions);
      break;
    case 'SURGERY':
      push('수술', it.title); push('부위', it.bodySite);
      push('시작', it.startedAt ? fmt(it.startedAt) : null); push('종료', it.endedAt ? fmt(it.endedAt) : null);
      push('술전진단', it.preOpDiagnosis); push('술후진단', it.postOpDiagnosis); push('수술소견', it.findings);
      break;
    case 'MAR':
      push('약품', it.title); push('예정', it.scheduledAt ? fmt(it.scheduledAt) : null);
      push('투여 시각', it.administeredAt ? fmt(it.administeredAt) : null);
      push('용량', it.dosage); push('경로', it.route); push('보류 사유', it.instructions); push('약품코드', it.code);
      break;
    case 'DISCHARGE_SUMMARY':
      push('입원진단', it.admitDiagnosis); push('퇴원진단', it.dischargeDiagnosis);
      push('경과요약', it.hospitalCourse); push('추적계획', it.followUpPlan);
      break;
    case 'ADMISSION':
      push('구분', it.subType === 'ADMIT' ? '입원' : it.subType === 'DISCHARGE' ? '퇴원' : null);
      push('내용', it.title); push('입원 사유', it.reason);
      break;
    case 'VITALS':
      break; // 아래 활력 표가 담는다
    case 'AI_PROPOSAL':
      push('제안', it.title); push('대상', it.targetType);
      push('생성', it.createdAt ? fmt(it.createdAt) : null);
      push('노출', it.presentedAt ? fmt(it.presentedAt) : '노출 기록 없음(사람이 본 적 없음)');
      push('결정', it.decidedAt ? fmt(it.decidedAt) : '미결정');
      push('수정량', it.editDistance === null || it.editDistance === undefined ? '미측정(0 이 아님)' : `${it.editDistance}자`);
      push('거부 사유', it.rejectReason);
      push('참고', '초안 본문은 제안 원장에만 있습니다');
      break;
    case 'CONVERSATION':
      push('대화', it.title); push('경로', it.scribeSource);
      push('반영 필드', it.appliedFields?.length ? it.appliedFields.join(' · ') : '반영 기록 없음');
      push('참고', '대화 원문은 진료 화면의 대화 패널에만 있습니다');
      break;
  }
  push('작성', [it.author, it.authorRole].filter(has).join(' · '));
  push('확인', it.verifier);
  return out;
}

/** 활력 — 잰 것만 · 하나도 없으면 null(빈 표를 찍지 않는다) */
export function vitalRows(it: TItem): KV[] | null {
  if (it.type !== 'VITALS' || !it.vitals) return null;
  const v = it.vitals;
  const rows: KV[] = [];
  const add = (k: string, val: unknown, unit: string) => { if (val !== null && val !== undefined && val !== '') rows.push([k, `${val}${unit}`]); };
  add('혈압', v.bp, ' mmHg'); add('맥박', v.hr, ' /분'); add('호흡', v.rr, ' /분'); add('체온', v.temp, ' ℃');
  add('SpO₂', v.spo2, ' %'); add('통증', v.pain, ' /10'); add('체중', v.weight, ' kg'); add('BMI', v.bmi, '');
  return rows.length ? rows : null;
}

function labJudge(flag?: string | null): string {
  if (!isJudgedFlag(flag)) return LAB_FLAG_UNJUDGED_TEXT;
  if (!isAbnormalFlag(flag)) return '정상';
  return flag === 'H' ? '상회(H)' : flag === 'L' ? '하회(L)' : String(flag);
}

/** 시계열 한 줄 요약 — 본문을 다 싣지 않는다(상세는 기록 상세 인쇄로) */
export function recordSummaryOf(it: TItem): string {
  const s = it.soap ?? {};
  const cut = (t: string, n = 120) => (t.length > n ? `${t.slice(0, n)}…` : t);
  switch (it.type) {
    case 'ENCOUNTER': return cut([it.title, s.A ? `A: ${s.A}` : null, it.diagnoses?.length ? `진단 ${it.diagnoses.map((d) => d.name ?? d.code).filter(Boolean).join(', ')}` : null].filter(Boolean).join(' · '));
    case 'LAB': return cut([it.title, (it.results ?? []).filter((r) => isAbnormalFlag(r.flag)).map((r) => `${r.name} ${r.value}${r.unit ? ` ${r.unit}` : ''}(${r.flag})`).join(', ') || null].filter(Boolean).join(' — '));
    case 'VITALS': return (vitalRows(it) ?? []).map(([k, v]) => `${k} ${v}`).join(' · ') || '측정값 없음';
    case 'IMAGING': return cut([it.title, it.impression ?? it.finding].filter(Boolean).join(' — '));
    case 'PRESCRIPTION': return cut([it.title, it.dosage, it.frequency, it.duration ? `${it.duration}일` : null].filter(Boolean).join(' · '));
    case 'SURGERY': return cut([it.title, it.postOpDiagnosis ?? it.preOpDiagnosis].filter(Boolean).join(' — '));
    case 'MAR': return cut([it.title, it.dosage, it.instructions ? `보류: ${it.instructions}` : null].filter(Boolean).join(' · '));
    case 'DISCHARGE_SUMMARY': return cut(it.dischargeDiagnosis ?? it.title ?? '');
    case 'ADMISSION': return cut([it.subType === 'ADMIT' ? '입원' : '퇴원', it.title, it.reason].filter(Boolean).join(' · '));
    case 'NURSING':
    case 'PROGRESS_NOTE': {
      const d = it.dar ?? {}; const b = it.sbar ?? {};
      const parts = [it.focus, d.D ? `D: ${d.D}` : null, d.A ? `A: ${d.A}` : null, s.A ? `A: ${s.A}` : null, b.S ? `S: ${b.S}` : null, it.content];
      return cut(parts.filter(Boolean).join(' · ')) || '내용 없음';
    }
    default: return cut([it.title, it.focus, it.content].filter(Boolean).join(' · '));
  }
}

const subjectLine = (p?: PrintSubject | null) => (p?.name ? `${p.name}${p.mrn ? ` (${p.mrn})` : ''}` : '환자 정보 미확인');

/** QR — 🔴 이름·등록번호 없음 */
export function recordDetailQrPayload(it: Pick<TItem, 'type' | 'id' | 'at'>, patientId: string) {
  return { t: 'HIS-RECORD', v: 1, type: it.type, id: it.id, at: it.at, patientId };
}
export function recordTimelineQrPayload(o: { patientId: string; admissionId?: string | null; n: number; total: number | null; printedFrom: string | null }) {
  return { t: 'HIS-RECORD-TIMELINE', v: 1, patientId: o.patientId, admissionId: o.admissionId ?? null, n: o.n, total: o.total, from: o.printedFrom };
}

/** 기록 본문(종류별) — 상세 인쇄본의 몸통 */
export function RecordPrintBody({ item }: { item: TItem }) {
  const kv = recordKvRows(item);
  const vit = vitalRows(item);
  return (
    <>
      {kv.length > 0 && (
        <table className="dps-kv" data-print-kv>
          <tbody>{kv.map(([k, v], i) => <tr key={i}><th>{k}</th><td className="dps-pre">{v}</td></tr>)}</tbody>
        </table>
      )}
      {item.type === 'VITALS' && (vit ? (
        <>
          <h2>활력징후</h2>
          <table className="dps-kv" data-print-vitals><tbody>{vit.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
          <p className="dps-note">잰 항목만 실었습니다 — 없는 항목은 측정하지 않은 것입니다.</p>
        </>
      ) : <p data-print-vitals-none>측정값이 없습니다.</p>)}
      {item.type === 'ENCOUNTER' && !!item.diagnoses?.length && (
        <>
          <h2>진단</h2>
          <table data-print-dx>
            <colgroup><col style={{ width: '18%' }} /><col style={{ width: '62%' }} /><col style={{ width: '20%' }} /></colgroup>
            <thead><tr><th>코드</th><th>진단명</th><th>구분</th></tr></thead>
            <tbody>{item.diagnoses.map((d, i) => <tr key={i}><td className="dps-key">{d.code ?? '—'}</td><td>{d.name ?? '—'}</td><td>{d.type ?? '—'}</td></tr>)}</tbody>
          </table>
        </>
      )}
      {item.type === 'LAB' && !!item.results?.length && (
        <>
          <h2>결과</h2>
          <table data-print-results>
            <colgroup><col style={{ width: '32%' }} /><col style={{ width: '16%' }} /><col style={{ width: '14%' }} /><col style={{ width: '22%' }} /><col style={{ width: '16%' }} /></colgroup>
            <thead><tr><th>항목</th><th>값</th><th>단위</th><th>참고범위</th><th>판정</th></tr></thead>
            <tbody>{item.results.map((r, i) => (
              <tr key={i} data-print-result-flag={r.flag ?? ''}>
                <td>{r.name}</td>
                <td className="dps-state">{r.value}</td>
                <td>{r.unit || '—'}</td>
                <td>{r.refLow != null || r.refHigh != null ? `${r.refLow ?? ''} ~ ${r.refHigh ?? ''}` : '참고범위 없음'}</td>
                <td className={isAbnormalFlag(r.flag) ? 'dps-state' : ''}>{labJudge(r.flag)}</td>
              </tr>
            ))}</tbody>
          </table>
        </>
      )}
    </>
  );
}

/** 기록 상세 인쇄본 */
export function RecordDetailPrint({ item, patient, patientId }: { item: TItem; patient: PrintSubject | null; patientId: string }) {
  const hash = useDocHash([item.type, item.id, item.at, item.status ?? ''].join('|'));
  const label = TRACK_UI[item.type]?.label ?? item.type;
  const st = trackStatusLabel(item);
  return (
    <PrintDoc attr="RECORD_DETAIL" kind="기록 상세" code="HIS-RECORD v1" title={`${label} — ${fmt(item.at)}`}
      subtitle={<>{subjectLine(patient)}{st ? ` · 상태 ${st}` : ''}</>}
      idLine={<>{item.type} · {breakKey(item.id)}</>}
      qr={recordDetailQrPayload(item, patientId)} hash={hash} unissued="PENDING_D2"
      legend="없는 칸은 싣지 않았습니다 — 비어 있는 것은 기록되지 않은 것이지 0 이나 정상이 아닙니다">
      <RecordPrintBody item={item} />
    </PrintDoc>
  );
}

/** 시계열 인쇄본 — 날짜별 묶음 · 화면 조건 그대로 */
export function RecordTimelinePrint({ items, patientId, admissionId, scopeLabel, subject, period, conditions, truncatedTracks, total }: {
  items: TItem[]; patientId: string; admissionId?: string | null; scopeLabel: string; subject: PrintSubject | null;
  period?: string | null; conditions: string; truncatedTracks: string[]; total: number | null;
}) {
  const hash = useDocHash(items.map((i) => `${i.type}|${i.id}|${i.at}|${i.status ?? ''}`).join('\n'));
  const loadedPartially = total !== null && total > items.length;
  let lastDay = '';
  return (
    <PrintDoc attr="RECORD_TIMELINE" kind={scopeLabel} code="HIS-RECORD-TIMELINE v1" title={subjectLine(subject)}
      subtitle={<>{period ? `${period} · ` : ''}{conditions} · {items.length}건{loadedPartially ? ` / 전체 ${total}건` : ''}</>}
      idLine={<>{admissionId ? <>입원 {breakKey(admissionId)}</> : <>환자 {breakKey(patientId)}</>}</>}
      qr={recordTimelineQrPayload({ patientId, admissionId, n: items.length, total, printedFrom: items.length ? items[items.length - 1].at : null })} hash={hash} unissued="PENDING_D2"
      legend="한 줄 요약입니다 — 기록 전체는 기록 상세 인쇄로 · 확인 칸은 검토자가 직접 체크·서명합니다">
      {(truncatedTracks.length > 0 || loadedPartially) && (
        <div className="dps-box" data-print-truncated>
          <b>⚠ 일부만 실렸습니다.</b>
          {truncatedTracks.length > 0 && <> 조회 상한에 걸린 유형: {truncatedTracks.map((t) => TRACK_UI[t as TItem['type']]?.label ?? t).join(', ')}.</>}
          {loadedPartially && <> 전체 {total}건 중 {items.length}건만 불러온 상태에서 인쇄했습니다.</>}
          {' '}기간을 좁히거나 더 불러온 뒤 다시 인쇄하세요.
        </div>
      )}
      {items.length === 0 ? <p data-print-empty>이 조건에 해당하는 기록이 없습니다.</p> : (
        <table>
          <colgroup><col style={{ width: '9%' }} /><col style={{ width: '10%' }} /><col style={{ width: '58%' }} /><col style={{ width: '11%' }} /><col style={{ width: '12%' }} /></colgroup>
          <thead><tr><th>시각</th><th>구분</th><th>내용 요약</th><th>상태</th><th>확인</th></tr></thead>
          <tbody>
            {items.flatMap((it) => {
              const day = kdate(it.at, 'date');
              const head = day !== lastDay;
              lastDay = day;
              const time = kdate(it.at, 'time', '—');
              return [
                head && <tr key={`d:${day}`} className="dps-group" data-print-day={day}><td colSpan={5}>{day}</td></tr>,
                <tr key={`${it.type}:${it.id}`} data-print-row={`${it.type}:${it.id}`}>
                  <td className="dps-nowrap">{time}</td>
                  <td>{TRACK_UI[it.type]?.short ?? it.type}</td>
                  <td>{recordSummaryOf(it)}</td>
                  <td>{trackStatusLabel(it) ?? '—'}</td>
                  <td><CheckCell /></td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      )}
    </PrintDoc>
  );
}
