'use client';

import { safeFormat as format } from '@/lib/safe-date';
import type { BillingWithRelations, EncounterListItem } from './types';
import { BILLING_STATUS } from './types';
import { money } from '@/lib/ui-settings';

import { EmptyState, Money, Unit, DrugName } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface BillingTabProps {
  billings: BillingWithRelations[];
  billingsLoading: boolean;
  encounters: EncounterListItem[];
  encountersLoading: boolean;
}

export function BillingTab({ billings, billingsLoading, encounters, encountersLoading }: BillingTabProps) {
  const tAttr = useTAttr();
  return (
    <div className="space-y-6">
      {/* Billing History Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4"><T k="수납 내역" /></h3>
        {billingsLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : billings.length === 0 ? (
          <EmptyState icon="💳" title="수납 내역이 없습니다." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-3 text-xs font-medium text-gray-400"><T k="날짜" /></th>
                  <th className="text-right py-3 px-3 text-xs font-medium text-gray-400"><T k="총액" /></th>
                  <th className="text-right py-3 px-3 text-xs font-medium text-gray-400"><T k="보험부담" /></th>
                  <th className="text-right py-3 px-3 text-xs font-medium text-gray-400"><T k="본인부담" /></th>
                  <th className="text-center py-3 px-3 text-xs font-medium text-gray-400"><T k="상태" /></th>
                </tr>
              </thead>
              <tbody>
                {billings.map((bill: BillingWithRelations) => {
                  const bStatus = BILLING_STATUS[bill.status] ?? { label: bill.status, bg: 'bg-gray-50', text: 'text-gray-700' };
                  return (
                    <tr key={bill.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="py-3 px-3 text-gray-700">
                        {format(new Date(bill.createdAt), 'yyyy-MM-dd')}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-gray-900">
                        <Money value={(bill.totalAmount ?? 0)} />
                      </td>
                      <td className="py-3 px-3 text-right text-gray-500">
                        <Money value={(bill.insuranceCovered ?? 0)} />
                      </td>
                      <td className="py-3 px-3 text-right text-gray-500">
                        <Money value={(bill.copayAmount ?? bill.patientAmount ?? 0)} />
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${bStatus.bg} ${bStatus.text}`}>
                          {bStatus.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Prescription Summary per Encounter */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4"><T k="처방 요약" /></h3>
        {encountersLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : encounters.filter((e: EncounterListItem) => e.prescriptions?.length && e.prescriptions.length > 0).length === 0 ? (
          <EmptyState icon="💊" title="처방 내역이 없습니다." />
        ) : (
          <div className="space-y-4">
            {encounters
              .filter((enc: EncounterListItem) => (enc.prescriptions?.length ?? 0) > 0)
              .map((enc: EncounterListItem) => (
                <div key={enc.id} className="rounded-xl border border-gray-100 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-700">
                      {format(new Date(enc.createdAt), 'yyyy-MM-dd')}
                    </span>
                    <span className="text-xs text-gray-400">
                      {enc.doctor?.familyName}{enc.doctor?.givenName} | 처방 {enc.prescriptions?.length ?? 0}건
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {enc.prescriptions!.map((rx) => (
                      <div key={rx.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                        <span className="font-medium text-gray-700">
                          <DrugName nameKo={rx.medicationCode?.nameKo ?? rx.medication?.nameKo} nameEn={rx.medicationCode?.nameEn} ingredient={rx.medicationCode?.ingredient} code={rx.medicationId} />
                        </span>
                        <div className="flex items-center gap-3 text-gray-400">
                          {rx.dosage && <span>{rx.dosage}</span>}
                          {rx.frequency && <span>{rx.frequency}</span>}
                          {rx.duration && <span>{rx.duration}<Unit>일</Unit></span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
