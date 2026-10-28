'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface BillingItem {
  id: string;
  codeName?: string;
  unitPrice?: number;
  quantity?: number;
  amount?: number;
  name?: string;
  description?: string;
  price?: number;
  totalPrice?: number;
}

export interface BillingDetail {
  id: string;
  patientId: string;
  encounterId?: string;
  totalAmount: number;
  paidAmount?: number;
  insuranceCovered?: number;
  patientCopay?: number;
  copayAmount?: number;
  patientAmount?: number;
  status: string;
  createdAt?: string;
  paidAt?: string;
  items?: BillingItem[];
  patient?: {
    id: string;
    familyName: string;
    givenName: string;
    mrn?: string;
    insuranceType?: string;
  };
  encounter?: {
    patient?: {
      id: string;
      familyName: string;
      givenName: string;
      mrn?: string;
      insuranceType?: string;
    };
  };
}

export interface CashierQueueItem {
  id: string;
  patientId: string;
  status: string;
  totalAmount: number;
  patientCopay?: number;
  patient?: {
    familyName: string;
    givenName: string;
    mrn?: string;
  };
  createdAt?: string;
}

export interface CashierStats {
  totalPending: number;
  totalPaid: number;
  totalAmount: number;
  paidAmount: number;
}

export interface DailySummary {
  date: string;
  totalBillings: number;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  paymentMethods?: Record<string, number>;
}

export interface DeferredBilling {
  id: string;
  patientId: string;
  totalAmount: number;
  status: string;
  deferReason?: string;
  patient?: {
    familyName: string;
    givenName: string;
    mrn?: string;
  };
  createdAt?: string;
}

export function useBillings(filters: { status?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ['billings', filters],
    queryFn: () => apiClient.get<{ data: BillingDetail[] }>('/api/v1/billings', filters),
  });
}

export function useBilling(id: string) {
  return useQuery({
    queryKey: ['billing', id],
    queryFn: () => apiClient.get<{ data: BillingDetail }>(`/api/v1/billings/${id}`),
    enabled: !!id,
  });
}

export function useCreateBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (encounterId: string) =>
      apiClient.post<{ data: BillingDetail }>(`/api/v1/encounters/${encounterId}/billing`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['billings'] }); },
  });
}

export function usePayBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, paymentMethod, cardApprovalNo, cashReceiptType }: {
      id: string;
      amount: number;
      paymentMethod?: string;
      cardApprovalNo?: string;
      cashReceiptType?: string;
    }) =>
      apiClient.patch<{ data: BillingDetail }>(`/api/v1/billings/${id}/pay`, {
        amount,
        paymentMethod,
        cardApprovalNo,
        cashReceiptType,
      }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['billings'] });
      qc.invalidateQueries({ queryKey: ['billing', id] });
      qc.invalidateQueries({ queryKey: ['cashier-queue'] });
      qc.invalidateQueries({ queryKey: ['cashier-stats'] });
    },
  });
}

export function useCashierQueue() {
  return useQuery({
    queryKey: ['cashier-queue'],
    queryFn: () => apiClient.get<{ data: CashierQueueItem[] }>('/api/v1/billing/cashier-queue'),
    refetchInterval: 10000,
  });
}

export function useCashierStats() {
  return useQuery({
    queryKey: ['cashier-stats'],
    queryFn: () => apiClient.get<{ data: CashierStats }>('/api/v1/billing/cashier-stats'),
    refetchInterval: 10000,
  });
}

export function useDailySummary(date?: string) {
  return useQuery({
    queryKey: ['daily-summary', date],
    queryFn: () => apiClient.get<{ data: DailySummary }>('/api/v1/billing/daily-summary', { date }),
  });
}

export function useDeferredBillings() {
  return useQuery({
    queryKey: ['deferred-billings'],
    queryFn: () => apiClient.get<{ data: DeferredBilling[] }>('/api/v1/billing/deferred'),
  });
}

export function useCancelBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.patch(`/api/v1/billings/${id}/cancel`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billings'] });
      qc.invalidateQueries({ queryKey: ['cashier-queue'] });
      qc.invalidateQueries({ queryKey: ['cashier-stats'] });
    },
  });
}

export function useRefundBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, reason }: { id: string; amount: number; reason: string }) =>
      apiClient.patch(`/api/v1/billings/${id}/refund`, { amount, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billings'] });
      qc.invalidateQueries({ queryKey: ['cashier-stats'] });
    },
  });
}

export function useDeferBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.patch(`/api/v1/billings/${id}/defer`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billings'] });
      qc.invalidateQueries({ queryKey: ['cashier-queue'] });
      qc.invalidateQueries({ queryKey: ['deferred-billings'] });
      qc.invalidateQueries({ queryKey: ['cashier-stats'] });
    },
  });
}
