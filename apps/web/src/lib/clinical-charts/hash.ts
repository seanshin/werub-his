/**
 * 정의 해시 — 검수 시점의 차트 정의 스냅샷 식별(정의 변경 시 재검수 무효화).
 * 키 정렬 안정 직렬화 + FNV-1a 2패스(시드 상이) → 16 hex. 변경 감지 용도(암호학적 강도 불요).
 */
import type { ClinicalChartDef } from './types';

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function computeDefHash(def: ClinicalChartDef): string {
  // verified 플래그 자체는 해시에서 제외(검수 상태 변화가 정의 변경으로 오인되지 않도록)
  const { verified: _v, ...rest } = def as ClinicalChartDef & { verified: boolean };
  const s = stableStringify(rest);
  return fnv1a(s, 0x811c9dc5).toString(16).padStart(8, '0') + fnv1a(s, 0x9e3779b9).toString(16).padStart(8, '0');
}
