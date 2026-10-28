import { SetMetadata } from '@nestjs/common';

export const CONSULT_ROLE_KEY = 'consultRole';
export type ConsultRoleReq = 'AGENT' | 'LEAD' | 'ADMIN';

/**
 * 상담 역할 요구. 미지정 시 ConsultAgent 등록(AGENT 이상)만 요구.
 * 계층: ADMIN > LEAD > AGENT. ADMIN은 시스템 UserRole.ADMIN 폴백 허용(부트스트랩).
 */
export const ConsultRole = (role: ConsultRoleReq) => SetMetadata(CONSULT_ROLE_KEY, role);

export const CONSULT_SELF_PROBE_KEY = 'consultSelfProbe';

/**
 * **등록 여부 자체를 묻는** 핸들러 — 등록되지 않은 직원도 통과시킨다(응답은 자기 등록 상태뿐).
 *
 * 🔴 2026-09-16 J2(실로그인 프로브): `GET agents/me` 가 이 가드 뒤에 있어 **미등록자는 자기가
 *    미등록인지조차 물을 수 없었다**(catch-22). 서비스 `getMe` 는 `{ enrolled: false }` 를 돌려주도록
 *    이미 만들어져 있었지만 **그 분기가 도달 불가**였고, 화면은 조회 실패를 삼켜(`.catch(() => {})`)
 *    상태 'OFFLINE' 인 **정상처럼 보이는 빈 데스크**를 그렸다(§1 실패를 없음으로 번역).
 *    이 표식이 붙은 핸들러는 상담 데이터를 내주지 않는다 — 자기 등록 상태만 말한다.
 */
export const ConsultSelfProbe = () => SetMetadata(CONSULT_SELF_PROBE_KEY, true);
