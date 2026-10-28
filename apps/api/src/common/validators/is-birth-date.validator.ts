import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

/**
 * 생년월일 범위 검증 — 미래·비현실적 과거 차단.
 *
 * 🔴 `@IsDateString()` 은 **형식만** 본다. 미래 날짜도 통과하고, 그 환자는 나이가 음수가 된다.
 *    나이는 소아 용량 계산·검사 기준치(성별·연령별)·DUR 연령금기가 읽는 값이라
 *    한 번 들어오면 임상 판정이 조용히 어긋난다(운영 실측 13명 유입·2026-08-03).
 *
 * 상한은 '오늘'(당일 출생 허용), 하한은 150년 전.
 */
export const MAX_AGE_YEARS = 150;

export function isValidBirthDate(value: unknown): boolean {
  if (typeof value !== 'string' && !(value instanceof Date)) return false;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return false;

  const now = new Date();
  // 당일 출생 허용 — 시각까지 비교하면 신생아 등록이 타임존 때문에 거부될 수 있다
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (d.getTime() > endOfToday.getTime()) return false;

  const floor = new Date(now.getFullYear() - MAX_AGE_YEARS, now.getMonth(), now.getDate());
  return d.getTime() >= floor.getTime();
}

export function IsBirthDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isBirthDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isValidBirthDate(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property}: 생년월일은 미래일 수 없고 ${MAX_AGE_YEARS}년 이내여야 합니다.`,
      },
    });
  };
}
