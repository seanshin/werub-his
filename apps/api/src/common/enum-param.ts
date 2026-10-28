import { BadRequestException } from '@nestjs/common';

/**
 * 🔴 **선택** enum 쿼리 파라미터를 검증한다(400) — 2026-09-01.
 *
 * 결함: `if (filters.status) where.status = filters.status as OrderStatus` 같은 코드는
 *   **TS 캐스트일 뿐 런타임 검증이 없다**. `?status=BOGUS` 가 그대로 Prisma where 로 들어가
 *   PrismaClientValidationError → **500**(운영 실측: orders·encounters·billings·claims·hr·equipment).
 *   개별 `@Query('status')` 문자열 인자는 ValidationPipe 도 우회한다(date-param 과 같은 부류).
 *
 * 값이 없으면(선택 파라미터) 무시하고, 있으면 허용 집합에 없을 때 400 으로 말한다.
 * `allowed` 는 Prisma 가 생성한 enum 객체(값의 Record) 또는 문자열 배열.
 */
export function assertEnumParam(
  value: string | null | undefined,
  allowed: readonly string[] | Record<string, string>,
  label: string,
): void {
  if (value == null || value === '') return;
  const values = Array.isArray(allowed) ? allowed : Object.values(allowed);
  if (!values.includes(value)) {
    const last = label.charCodeAt(label.length - 1);
    const josa = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0 ? '은' : '는';
    throw new BadRequestException(`${label}${josa} 허용되지 않은 값입니다`);
  }
}
