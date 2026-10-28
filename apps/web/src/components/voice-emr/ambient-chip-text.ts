/**
 * 발화 단건 → SOAP 필드 문구 (순수·클라이언트 즉시 반영용)
 *
 * 패널 NER 칩의 [S/O/P에 반영] 버튼이 붙일 텍스트를 만든다. 전체 분석(서버 `consolidate()` — D2 정돈 초안)과
 * 같은 매핑 규칙을 쓰되, 여기선 **발화 1건**만 다룬다(주호소 승격·병합·활력 이력·계획 묶음은 서버 몫).
 * 기획 §3.3 경로 A · §6
 */
import type { AmbientEntities } from '@/lib/voice-api';

export type SoapField = 'subjective' | 'objective' | 'assessment' | 'plan';

/** S — 증상(긍정 호소·부정 부인 분리 보존) */
export function subjectiveText(e: AmbientEntities): string | null {
  const pos = e.symptoms.filter((s) => !s.negated).map((s) => s.term);
  const neg = e.symptoms.filter((s) => s.negated).map((s) => s.term);
  const parts: string[] = [];
  if (pos.length) parts.push(`${pos.join(', ')} 호소.`);
  if (neg.length) parts.push(`${neg.join(', ')} 부인.`);
  return parts.length ? parts.join(' ') : null;
}

/** O — 활력(BP 는 수축/이완 슬래시 표기) */
export function objectiveText(e: AmbientEntities): string | null {
  if (!e.vitals.length) return null;
  return e.vitals.map((v) => `${v.type} ${v.value.join('/')}${v.unit ? ` ${v.unit}` : ''}`).join(', ');
}

/** P — 계획 + 약물 */
export function planText(e: AmbientEntities): string | null {
  const parts = [...e.plan.map((p) => p.text), ...e.medications.map((m) => m.name)];
  return parts.length ? parts.join('\n') : null;
}

export function fieldTexts(e: AmbientEntities): { field: SoapField; text: string }[] {
  const out: { field: SoapField; text: string }[] = [];
  const s = subjectiveText(e); if (s) out.push({ field: 'subjective', text: s });
  const o = objectiveText(e); if (o) out.push({ field: 'objective', text: o });
  const p = planText(e); if (p) out.push({ field: 'plan', text: p });
  return out; // A(평가)는 규칙 경로 미제안 — 임상 판단
}

/** 기존 텍스트에 append(중복 문장은 재부착 안 함·수기 입력 보존) */
export function appendText(prev: string, add: string): string {
  const base = prev ?? '';
  if (!add.trim()) return base;
  if (base.includes(add.trim())) return base;
  return base.trim() ? `${base.replace(/\s+$/, '')}\n${add.trim()}` : add.trim();
}
