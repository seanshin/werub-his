'use client';

import { useState } from 'react';
import { QI_SUPPLIERS, QI_SUPPLIER_DEFINITION, type QiSupplierKey } from '@hospital-run/shared';
import { T, Tf } from '@/components/ui/i18n-text';
import type { QiIndicator } from './quality-types';

/**
 * 자동 산출 공급원 목록(2026-10-10) — 원내 원장에서 다시 셀 수 있는 지표와 그 정의(모집단·분자·제외·결정 의존).
 * 🔴 등재는 사람이 한다 — 이 목록은 근거를 보이고, 미등재 공급원은 "이 정의로 새 지표 작성"으로 등록 폼을 **채워 줄 뿐** 등록하지 않는다.
 */
export function supplierUsage(indicators: QiIndicator[]): Map<QiSupplierKey, QiIndicator[]> {
  const m = new Map<QiSupplierKey, QiIndicator[]>();
  for (const i of indicators) {
    const k = (i as QiIndicator & { effectiveSupplierKey?: string | null }).effectiveSupplierKey;
    if (k && k in QI_SUPPLIERS) m.set(k as QiSupplierKey, [...(m.get(k as QiSupplierKey) ?? []), i]);
  }
  return m;
}

export function QiSupplierCatalog({ indicators, canDraft, onDraft }: {
  indicators: QiIndicator[];
  /** 관리자·직접 등록 허용일 때만 */
  canDraft: boolean;
  onDraft: (key: QiSupplierKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const usage = supplierUsage(indicators);
  const keys = Object.keys(QI_SUPPLIERS) as QiSupplierKey[];
  const unlisted = keys.filter((k) => !usage.has(k));
  return (
    <section className="mb-4 rounded-2xl border border-gray-200 bg-white p-4" data-qi-supplier-catalog>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full min-h-[44px] items-center justify-between text-left">
        <span className="text-sm font-semibold text-gray-800"><T k="자동 산출 공급원" /></span>
        <span className="text-xs text-gray-500" data-qi-supplier-unlisted={unlisted.length}>
          <Tf k="공급원 {n}개 · 지표로 등재되지 않은 것 {m}개" params={{ n: keys.length, m: unlisted.length }} />
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-gray-500"><T k="원내 원장에서 분자·분모를 다시 셀 수 있는 지표입니다. 등재는 사람이 합니다 — 등재해야 월 마감이 자동 산출합니다." /></p>
          <ul className="divide-y rounded-xl border">
            {keys.map((k) => {
              const d = QI_SUPPLIER_DEFINITION[k];
              const used = usage.get(k) ?? [];
              return (
                <li key={k} className="grid gap-1 px-3 py-2 text-xs md:grid-cols-[14rem_1fr_auto]" data-qi-supplier={k} data-qi-supplier-listed={used.length ? 'yes' : 'no'}>
                  <div>
                    <p className="font-semibold text-gray-800"><T k={d?.name ?? k} /></p>
                    <p className="text-[11px] text-gray-500"><T k={QI_SUPPLIERS[k].label} /></p>
                  </div>
                  {d ? (
                    <dl className="grid grid-cols-[5rem_1fr] gap-x-2 text-[11px] text-gray-600">
                      <dt className="text-gray-400"><T k="모집단" /></dt><dd><T k={d.population} /></dd>
                      <dt className="text-gray-400"><T k="분자" /></dt><dd><T k={d.numerator} /></dd>
                      <dt className="text-gray-400"><T k="제외" /></dt><dd><T k={d.exclusions} /></dd>
                      {d.dependsOn && <><dt className="text-amber-600"><T k="결정 의존" /></dt><dd className="text-amber-700"><T k={d.dependsOn} /></dd></>}
                    </dl>
                  ) : <span />}
                  <div className="flex items-start">
                    {used.length
                      ? <span className="rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700"><T k="등재됨" />: {used.map((i) => i.name).join(', ')}</span>
                      : canDraft
                        ? <button type="button" onClick={() => onDraft(k)} className="min-h-[44px] rounded-lg border border-blue-200 px-3 text-[11px] font-semibold text-blue-700" data-qi-supplier-draft={k}><T k="이 정의로 새 지표 작성" /></button>
                        : <span className="rounded bg-gray-50 px-2 py-1 text-[11px] text-gray-500"><T k="미등재" /></span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
