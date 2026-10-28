# RBAC (Role-Based Access Control) Implementation Guide

## Overview

The Hospital RUN system implements a comprehensive RBAC system with two levels of access control:

1. **Role-Based Access**: Using `@Roles()` decorator - checks if user has a specific role
2. **Permission-Based Access**: Using `@RequirePermission()` decorator - checks if user has a specific permission

## Permission Model

### Permission Types

Permissions are defined in `permission.types.ts` following the pattern: `resource:action`

**Available Permissions:**
- Patient: `patient:view`, `patient:create`, `patient:edit`, `patient:delete`
- Prescription: `prescription:view`, `prescription:create`, `prescription:edit`, `prescription:delete`
- Order: `order:view`, `order:create`, `order:edit`, `order:delete`
- Billing: `billing:view`, `billing:create`, `billing:edit`, `billing:delete`
- Encounter: `encounter:view`, `encounter:create`, `encounter:edit`, `encounter:delete`
- User: `user:view`, `user:create`, `user:edit`, `user:delete`
- Audit: `audit:view`, `audit:export`
- System: `system:manage`, `code:manage`

### Role-Permission Mapping

| Role | Permissions |
|------|-------------|
| **ADMIN** | All permissions (28) |
| **DOCTOR** | Patient (VCEO), Prescription (VCEO), Order (VCE), Billing (V), Encounter (VCE), Audit (V) |
| **NURSE** | Patient (VCE), Prescription (VE), Order (VE), Billing (V), Encounter (VE), Audit (V) |
| **PHARMACIST** | Patient (V), Prescription (VE), Order (VE), Audit (V) |
| **LAB_TECH** | Patient (V), Order (VE), Audit (V) |

Legend: V=View, C=Create, E=Edit, D=Delete, O=Other

## Usage in Controllers

### Basic Role-Based Access

```typescript
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Post()
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@ApiOperation({ summary: 'Create prescription' })
async create(@Body() dto: CreatePrescriptionDto) {
  return this.prescriptionService.create(dto);
}
```

### Permission-Based Access

```typescript
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';

@Get()
@RequirePermission(Permission.PATIENT_VIEW)
@ApiOperation({ summary: 'List all patients' })
async findAll(@Query() query: PatientQueryDto) {
  return this.patientService.findAll(query);
}

@Post()
@RequirePermission(Permission.PATIENT_CREATE)
@ApiOperation({ summary: 'Create patient' })
async create(@Body() dto: CreatePatientDto) {
  return this.patientService.create(dto);
}

@Put(':id')
@RequirePermission(Permission.PATIENT_EDIT)
@ApiOperation({ summary: 'Update patient' })
async update(@Param('id') id: string, @Body() dto: UpdatePatientDto) {
  return this.patientService.update(id, dto);
}

@Delete(':id')
@RequirePermission(Permission.PATIENT_DELETE)
@ApiOperation({ summary: 'Delete patient' })
async delete(@Param('id') id: string) {
  return this.patientService.delete(id);
}
```

### Multiple Permissions (Any Match)

```typescript
@Patch(':id/approve')
@RequirePermission(Permission.PRESCRIPTION_EDIT, Permission.PRESCRIPTION_CREATE)
@ApiOperation({ summary: 'Approve prescription' })
async approve(@Param('id') id: string) {
  return this.prescriptionService.approve(id);
}
```

## Implementation Details

### Guards Execution Order

1. `JwtAuthGuard`: Validates JWT token and extracts user
2. `RolesGuard`: Checks both role and permission requirements
   - First checks `@Roles()` if present
   - Then checks `@RequirePermission()` if present
   - Throws `ForbiddenException` if permission check fails

### PermissionService Methods

```typescript
// Check single permission
hasPermission(context: PermissionContext, permission: Permission): boolean

// Check if user has any of the required permissions
hasAnyPermission(context: PermissionContext, permissions: Permission[]): boolean

// Check if user has all of the required permissions
hasAllPermissions(context: PermissionContext, permissions: Permission[]): boolean

// Get all permissions for a role
getRolePermissions(role: UserRole): Set<Permission>

// Get all available permissions
getAllPermissions(): string[]

// Get permission matrix as readable format
getPermissionMatrix(): Record<UserRole, string[]>
```

## Adding New Permissions

To add a new permission:

1. Add to `Permission` enum in `permission.types.ts`:
   ```typescript
   REPORTING_EXPORT = 'reporting:export',
   REPORTING_SCHEDULE = 'reporting:schedule',
   ```

2. Update `ROLE_PERMISSIONS` mapping in `permission.types.ts`:
   ```typescript
   [UserRole.ADMIN]: new Set([
     // ... existing permissions
     Permission.REPORTING_EXPORT,
     Permission.REPORTING_SCHEDULE,
   ]),
   ```

3. Use in controller:
   ```typescript
   @Get('export')
   @RequirePermission(Permission.REPORTING_EXPORT)
   async export(@Query() query: ReportQueryDto) {
     // ...
   }
   ```

## Error Responses

### Role Mismatch

```
HTTP 403 Forbidden
(Returns false from RolesGuard, NestJS handles with default 403 response)
```

### Permission Denied

```
HTTP 403 Forbidden
{
  "statusCode": 403,
  "message": "Insufficient permissions. Required: patient:edit, patient:create",
  "error": "Forbidden"
}
```

## Testing

```typescript
describe('RBAC Guards', () => {
  it('should allow DOCTOR to view patients', async () => {
    const user = { id: '1', role: UserRole.DOCTOR };
    const context = mockExecutionContext(user);
    
    const result = rolesGuard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should deny LAB_TECH from creating patients', async () => {
    const user = { id: '1', role: UserRole.LAB_TECH };
    // SetMetadata(PERMISSION_KEY, [Permission.PATIENT_CREATE])
    
    expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
  });
});
```

## Migration Guide

### From Pure Role-Based to Permission-Based

**Before:**
```typescript
@Post()
@Roles(UserRole.DOCTOR, UserRole.NURSE)
async create(@Body() dto: CreatePrescriptionDto) { }
```

**After:**
```typescript
@Post()
@RequirePermission(Permission.PRESCRIPTION_CREATE)
async create(@Body() dto: CreatePrescriptionDto) { }
```

Benefits:
- More flexible: Can change role-permission mapping without changing decorators
- Clearer intent: `PRESCRIPTION_CREATE` is more explicit than `DOCTOR, NURSE`
- Easier to audit: Can see exact permission requirements from controller code
- Granular control: Can enforce different permissions based on business logic

## Future Enhancements

- [ ] Resource-level permissions (checking ownership, organization hierarchy)
- [ ] Dynamic permission loading from database
- [ ] Permission caching with Redis
- [ ] Permission audit logging
- [ ] Bulk permission updates API
- [ ] Custom permission conditions
