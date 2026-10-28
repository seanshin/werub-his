import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** 캠페인 발송 기록에 실제로 적히는 상태(`crm.service.ts sendCampaign`) — 여기 없는 값으로 거르면 400 */
export const CAMPAIGN_LOG_STATUSES = ['SENT', 'SIMULATED', 'FAILED', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED'] as const;

export class CampaignLogsQueryDto {
  @IsOptional()
  @IsIn(CAMPAIGN_LOG_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ReminderAutomationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}
