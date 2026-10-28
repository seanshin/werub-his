import { Controller, Get, Patch, Delete, Param, Body, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response as ExpressResponse } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TelehealthRecordingsService } from './telehealth-recordings.service';
import { UpdateTelehealthRecordingDto } from './dto/telehealth-recording.dto';

/**
 * 원격진료 녹화 관리 — **서버 프록시**(외부 점검).
 * 종전에는 브라우저가 Jitsi 녹화 API 를 직접 불렀고 그 API 키가 번들·URL 쿼리에 실려 있었다.
 * 이제 키는 서버에만 있고, 여기서 RBAC(역할)과 감사(변이 기본 ON)가 걸린다.
 * 부르는 화면: `apps/web/src/app/(main)/telehealth/recordings/page.tsx`(EP 와 한 벌).
 */
@ApiTags('Telehealth (원격진료)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/telehealth/recordings')
export class TelehealthRecordingsController {
  constructor(private readonly recordings: TelehealthRecordingsService) {}

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE) // 녹화 관리 메뉴 역할(Sidebar /telehealth/recordings)
  @ApiOperation({ summary: '녹화 목록 — 미설정이면 503(빈 목록으로 위장하지 않는다)' })
  async list(@Query('keyword') keyword?: string) {
    const body = (await this.recordings.list(keyword)) as { data?: unknown } | null;
    // 녹화 서버는 `{ data: [...] }` 로 답한다(종전 화면이 그렇게 읽었다). 다른 모양이면 그대로 넘긴다 — 지어내지 않는다.
    return { data: body && typeof body === 'object' && 'data' in body ? body.data : body };
  }

  @Patch(':id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '녹화 메모·태그 수정' })
  async update(@Param('id') id: string, @Body() body: UpdateTelehealthRecordingDto) {
    return { data: await this.recordings.update(id, { memo: body.memo, tags: body.tags }) };
  }

  /**
   * 🔴 삭제는 ADMIN 만. 녹화 파일은 의무기록의 일부(의료법 시행규칙 보존)라 삭제는 기록관리 권한이다.
   *    종전에는 화면이 가진 API 키 역할이 admin/operator 이면 **누가 그 화면을 열든** 삭제가 나갔다.
   *    화면은 `useHasRole('ADMIN')` 으로 같은 판정을 그린다(가진 적 없는 권한을 가진 척하지 않는다).
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '녹화 삭제(ADMIN) — 의무기록 관련 파일은 녹화 서버가 거부할 수 있다' })
  async remove(@Param('id') id: string) {
    return { data: await this.recordings.remove(id) };
  }

  @Get(':id/download')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '녹화 파일 다운로드 중계' })
  async download(@Param('id') id: string, @Res() res: ExpressResponse) {
    const { contentType, fileName, body } = await this.recordings.download(id);
    res.set({
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      'Content-Disposition': `attachment; filename="${(fileName ?? `recording-${id}`).replace(/["\r\n]/g, '')}"`,
      'Cache-Control': 'private, no-store', // 진료 영상 — 중간 캐시 금지
    });
    res.send(body);
  }
}
