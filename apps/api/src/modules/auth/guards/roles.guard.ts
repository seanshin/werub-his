import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';
import { PermissionService } from '../rbac/permission.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionService: PermissionService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // handler → class 순으로 탐색: handler에 있으면 그것만 사용, 없으면 class-level 사용
    const handlerRoles = this.reflector.get<UserRole[]>(ROLES_KEY, context.getHandler());
    const classRoles = this.reflector.get<UserRole[]>(ROLES_KEY, context.getClass());
    const requiredRoles = handlerRoles ?? classRoles;

    const handlerPerms = this.reflector.get<string[]>(PERMISSION_KEY, context.getHandler());
    const classPerms = this.reflector.get<string[]>(PERMISSION_KEY, context.getClass());
    const requiredPermissions = handlerPerms ?? classPerms;

    const { user } = context.switchToHttp().getRequest();

    // Check role-based access (ADMIN bypasses all role checks)
    if (requiredRoles && requiredRoles.length > 0) {
      if (user.role !== UserRole.ADMIN && !requiredRoles.includes(user.role)) {
        return false;
      }
    }

    // Check permission-based access
    if (requiredPermissions && requiredPermissions.length > 0) {
      const hasPermission = this.permissionService.hasAnyPermission(
        {
          userId: user.id,
          userRole: user.role,
        },
        requiredPermissions,
      );

      if (!hasPermission) {
        throw new ForbiddenException(
          `Insufficient permissions. Required: ${requiredPermissions.join(', ')}`,
        );
      }
    }

    return true;
  }
}
