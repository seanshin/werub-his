import { IsOptional, IsString, IsIn, IsInt, IsArray, Min, Max } from 'class-validator';
import { Permission } from '../../auth/rbac/permission.types';

const CRED_PERMS = [
  Permission.CRED_DEVICE_MANAGE,
  Permission.CRED_CERT_ISSUE,
  Permission.CRED_CERT_REVOKE,
  Permission.CRED_RECOVERY_APPROVE,
  Permission.CRED_POLICY_MANAGE,
  Permission.CRED_AUDIT_READ,
];

export class GrantDto {
  @IsString()
  userId!: string;

  @IsIn(CRED_PERMS)
  permission!: string;

  @IsOptional()
  @IsString()
  expiresAt?: string; // 위임 만료(FR-54)
}

export class RejectDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class DeviceReasonDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CertIssueDto {
  @IsString() userId!: string;
  @IsString() subjectDn!: string;
  @IsString() publicKey!: string;
  @IsString() algorithm!: string;
  @IsOptional() @IsString() licenseNumber?: string;
  @IsOptional() @IsString() licenseType?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() specialty?: string;
}

export class CertRevokeDto {
  @IsString() reason!: string;
}

export class CertRenewDto {
  @IsString() publicKey!: string;
  @IsString() algorithm!: string;
  @IsOptional() @IsString() subjectDn?: string;
}

export class DeprovisionDto {
  @IsString() reason!: string;
}

export class BulkDto {
  @IsIn(['ROLE', 'DEPARTMENT']) scope!: string;
  @IsString() scopeRef!: string;
}

export class OnboardDto {
  @IsOptional() @IsString() deviceName?: string;
}

export class RecoveryApproveDto {
  @IsOptional()
  @IsString()
  secondApproverId?: string; // 4-eyes 2차 승인(FR-47)

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  minutes?: number;
}

export class PolicyUpsertDto {
  @IsIn(['GLOBAL', 'ROLE', 'DEPARTMENT'])
  scope!: string;

  @IsOptional()
  @IsString()
  scopeRef?: string;

  @IsOptional() @IsInt() @Min(1) @Max(3650) reEnrollDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3650) idleExpireDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3650) certValidityDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) expiryWarnDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(20) maxDevices?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) inPersonRoles?: string[];
  @IsOptional() @IsString() syncedPasskey?: string;
}
