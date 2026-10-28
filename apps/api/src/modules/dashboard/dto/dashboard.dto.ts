import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetDashboardDto {
  @ApiPropertyOptional({ description: '부서명 (PHARMACY/LAB/IMAGING/BILLING)' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: '날짜 범위 (today/week/month)' })
  @IsOptional()
  @IsString()
  range?: 'today' | 'week' | 'month';
}

export class DepartmentStatsDto {
  department: string;
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  completionRate: number;
}

export class QueueItemDto {
  id: string;
  orderId?: string;
  patientId: string;
  patientName: string;
  status: string;
  createdAt: Date;
  priority?: string;
}

export class FinancialSummaryDto {
  totalAmount: number;
  insuranceCovered: number;
  patientCopay: number;
  claimedAmount: number;
  approvedAmount: number;
  paidAmount: number;
  pendingAmount: number;
  claimApprovalRate: number;
}

export class DashboardSummaryDto {
  pharmacy: DepartmentStatsDto;
  lab: DepartmentStatsDto;
  imaging: DepartmentStatsDto;
  totalPatients: number;
  totalEncounters: number;
  avgWaitTime: number;
  financialSummary: FinancialSummaryDto;
}
