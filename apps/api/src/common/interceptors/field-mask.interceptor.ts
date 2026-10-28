import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * 역할 기반 응답 필드 마스킹 인터셉터.
 *
 * - NURSE/RECEPTIONIST: nationalId 마스킹 (720108-1*****)
 * - RECEPTIONIST: 진료 기록(assessment, plan) 제외
 * - 전 역할: passwordHash 항상 제거
 */
const ALWAYS_REMOVE = ['passwordHash', 'password_hash', 'refreshTokenHash'];

const MASK_RULES: Record<string, { mask: string[]; remove: string[] }> = {
  NURSE: {
    mask: ['nationalId'],
    remove: [],
  },
  RECEPTIONIST: {
    mask: ['nationalId'],
    remove: ['assessment', 'plan', 'clinicalNote', 'subjective', 'objective'],
  },
  LAB_TECH: {
    mask: ['nationalId'],
    remove: ['assessment', 'plan'],
  },
  PHARMACIST: {
    mask: ['nationalId'],
    remove: ['assessment', 'plan'],
  },
};

@Injectable()
export class FieldMaskInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const role = request.user?.role as string | undefined;

    if (!role || role === 'ADMIN' || role === 'DOCTOR') {
      // 관리자/의사는 마스킹 없이 전체 응답 (passwordHash만 제거)
      return next.handle().pipe(map(data => this.removeFields(data, ALWAYS_REMOVE)));
    }

    const rules = MASK_RULES[role];
    if (!rules) {
      return next.handle().pipe(map(data => this.removeFields(data, ALWAYS_REMOVE)));
    }

    return next.handle().pipe(
      map(data => {
        const cleaned = this.removeFields(data, [...ALWAYS_REMOVE, ...rules.remove]);
        return this.maskFields(cleaned, rules.mask);
      }),
    );
  }

  private removeFields(obj: unknown, fields: string[]): unknown {
    if (!obj || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return obj;
    if (Array.isArray(obj)) return obj.map(item => this.removeFields(item, fields));

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (fields.includes(key)) continue;
      result[key] = value && typeof value === 'object' ? this.removeFields(value, fields) : value;
    }
    return result;
  }

  private maskFields(obj: unknown, fields: string[]): unknown {
    if (!obj || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return obj;
    if (Array.isArray(obj)) return obj.map(item => this.maskFields(item, fields));

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (fields.includes(key) && typeof value === 'string') {
        result[key] = this.maskValue(key, value);
      } else {
        result[key] = value && typeof value === 'object' ? this.maskFields(value, fields) : value;
      }
    }
    return result;
  }

  private maskValue(field: string, value: string): string {
    if (field === 'nationalId') {
      // 암호화된 값이면 마스킹 표시
      if (value.includes(':')) return '******-*******';
      // 평문이면 앞 6자리만 표시
      return value.length >= 7 ? `${value.slice(0, 6)}-${value[6]}******` : '******-*******';
    }
    return '****';
  }
}
