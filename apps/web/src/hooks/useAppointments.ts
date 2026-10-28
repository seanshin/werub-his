'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { Appointment, AppointmentStatus } from '@/types/appointment';
import type { PaginatedResponse } from '@/types/patient';

interface AppointmentFilters {
  doctorId?: string;
  patientId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

interface CalendarQuery {
  view?: 'week' | 'month';
  date?: string;
  doctorId?: string;
  includeInactive?: string; // 'true' = 취소·노쇼 포함(사후 조회)
}

export function useAppointments(filters: AppointmentFilters = {}) {
  return useQuery({
    queryKey: ['appointments', filters],
    queryFn: () =>
      apiClient.get<PaginatedResponse<Appointment>>('/api/v1/appointments', {
        ...filters,
        page: filters.page ?? 1,
        limit: filters.limit ?? 20,
      }),
  });
}

export function useAppointmentCalendar(query: CalendarQuery = {}) {
  return useQuery({
    queryKey: ['appointment-calendar', query],
    queryFn: () =>
      apiClient.get<{ data: Appointment[]; meta: { view: string; start: string; end: string } }>(
        '/api/v1/appointments/calendar',
        { ...query },
      ),
    retry: 1,
    enabled: !!apiClient.getToken(),
  });
}

export function useCreateAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      patientId: string;
      doctorId?: string;
      departmentName?: string;
      scheduledAt: string;
      duration?: number;
      type?: string;
      reason?: string;
      bookedVia?: string;
      repeatWeeks?: number;
    }) => apiClient.post<{ data: Appointment }>('/api/v1/appointments', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['appointment-calendar'] });
    },
  });
}

export function useChangeAppointmentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, cancelReason }: { id: string; status: AppointmentStatus; cancelReason?: string }) =>
      apiClient.patch<{ data: Appointment }>(`/api/v1/appointments/${id}/status`, { status, cancelReason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['appointment-calendar'] });
    },
  });
}

export function useConfirmAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post<{ data: Appointment }>(`/api/v1/appointments/${id}/confirm`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['appointment-calendar'] });
    },
  });
}

export function useNoShowAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post<{ data: Appointment }>(`/api/v1/appointments/${id}/no-show`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['appointment-calendar'] });
    },
  });
}

export function useUpdateAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scheduledAt }: { id: string; scheduledAt: string }) =>
      apiClient.put<{ data: Appointment }>(`/api/v1/appointments/${id}`, { scheduledAt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['appointment-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['appointment-day'] });
    },
  });
}
