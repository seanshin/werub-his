import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HIS_VERSION } from '@hospital-run/shared';
import { HisModeService } from '../../common/his-mode/his-mode.service';
import { readBuildInfo } from './build-info';

/**
 * 공개 버전 확인 — `GET /api/v1/public/version` (2026-09-13 상용 릴리즈 T1-5).
 *
 * 🔴 왜: 외부에서 "지금 운영에 떠 있는 것이 무슨 버전·어느 커밋인가"를 확인할 공개 경로가 없었다.
 *    `https://his.example.org/health` 는 웹(Next)이 받아 HTML 을 돌려주고, API 헬스는 서버 내부 `:4000` 에서만 닿았다.
 *
 * 🔴 **화이트리스트** — 버전·커밋·dirty·빌드 시각·운영 모드 **만** 낸다. 호스트명·경로·환경변수·의존성 목록은 내지 않는다.
 * 🔴 **무인증·감사 없음이 정당한 이유**: 읽기 전용이고 환자·직원·기관 정보를 담지 않는다(감사 원장은 변이와 환자 지목 조회가 대상).
 *    전역 ThrottlerGuard 는 그대로 적용된다.
 * 🔴 `version`(실행 중 코드)과 `recordedVersion`(배포 기록)이 다르면 기록이 낡은 것이다 — 합치지 않고 둘 다 낸다.
 */
@ApiTags('Public (공개)')
@Controller('api/v1/public/version')
export class PublicVersionController {
  constructor(private readonly mode: HisModeService) {}

  @Get()
  @ApiOperation({ summary: '공개 버전 정보(버전·커밋·빌드 시각·운영 모드) — 무인증' })
  async get() {
    const b = readBuildInfo();
    const mode = await this.mode.effective();
    return {
      data: {
        version: HIS_VERSION,
        commit: b.commit,
        dirty: b.dirty,
        builtAt: b.builtAt,
        recordedVersion: b.recordedVersion,
        buildInfo: b.source,
        mode,
      },
    };
  }
}
