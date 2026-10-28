import { SetMetadata } from '@nestjs/common';
import { Permission } from '../auth/rbac/permission.types';

export const CRED_PERMISSION_KEY = 'cred_permission';
/** 자격증명 관리 권한 요구 — CredentialGuard가 role-perm ∪ per-user grant 로 검사(FR-40) */
export const RequireCred = (...perms: Permission[]) => SetMetadata(CRED_PERMISSION_KEY, perms);
