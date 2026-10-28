-- UserRole 에 RECEPTIONIST 추가 — additive(기존 값·행 불변). enum 값 추가는 되돌릴 수 없으니 신중히.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'RECEPTIONIST';
