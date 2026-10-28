import { SetMetadata } from '@nestjs/common';
import { Permission } from '../../modules/auth/rbac/permission.types';

export const PERMISSION_KEY = 'permission';
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
