import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { EncounterService } from './encounter.service';

/**
 * 진료 첨부(PHI 이미지) 스트리밍 — 의도적으로 JwtAuthGuard 미적용.
 * <img src>는 Authorization 헤더를 못 실으므로, 인증은 목록 EP(JWT 가드)가 발급한
 * HMAC 단기 토큰(exp 1시간·파일 단위 바인딩)으로 대체한다. 토큰 검증은 서비스에서
 * timingSafeEqual + 파일명 화이트리스트(traversal 차단)로 수행.
 * (종전: 정적 /uploads 무인증 서빙 + nginx 공개 캐시 30d — PHI 노출이라 폐지)
 */
@ApiTags('encounters')
@Controller('api/v1/encounters')
export class EncounterAttachmentFileController {
  constructor(private readonly encounterService: EncounterService) {}

  @Get(':id/attachments/file/:fname')
  @ApiOperation({ summary: '진료 첨부 이미지 스트리밍 (HMAC 토큰 검증)' })
  async streamAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fname') fname: string,
    @Query('exp') exp: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const { buf, mimeType } = await this.encounterService.readAttachmentFile(id, fname, exp, token);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, no-store'); // PHI — 중간 캐시 금지
    res.setHeader('Content-Disposition', 'inline');
    res.send(buf);
  }
}
