import { Controller, Get, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createReadStream, promises as fsp } from 'fs';
import { ScribeService } from './scribe.service';

/**
 * 스크라이브 오디오(PHI) 스트리밍 — 의도적으로 JwtAuthGuard 미적용.
 * <audio src>는 Authorization 헤더를 못 실으므로, 인증은 세션 EP(JWT+소유 검증)가 발급한
 * HMAC 단기 토큰으로 대체. 파일명 화이트리스트로 traversal 차단. HTTP Range 지원(오디오 탐색).
 * 저장 위치는 정적 /uploads 밖 storage/scribe/ (무인증 서빙 금지).
 */
@ApiTags('Scribe')
@Controller('api/v1/encounters')
export class ScribeAudioFileController {
  constructor(private readonly scribe: ScribeService) {}

  @Get(':encounterId/scribe/audio/:fname')
  @ApiOperation({ summary: '스크라이브 오디오 스트리밍 (HMAC 토큰·Range)' })
  async streamAudio(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Param('fname') fname: string,
    @Query('exp') exp: string,
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { absPath, mimeType } = await this.scribe.resolveAudioFile(encounterId, fname, exp, token);

    let size: number;
    try {
      size = (await fsp.stat(absPath)).size;
    } catch {
      res.status(404).end();
      return;
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, no-store'); // PHI — 중간 캐시 금지
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m && (m[1] !== '' || m[2] !== '')) {
        let start: number;
        let end: number;
        if (m[1] === '') {
          // suffix range: bytes=-N → 마지막 N바이트 (RFC 7233)
          const n = parseInt(m[2], 10);
          start = Math.max(0, size - n);
          end = size - 1;
        } else {
          start = parseInt(m[1], 10);
          end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1; // end 클램프
        }
        if (start > end || start >= size) {
          res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
          return;
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', String(end - start + 1));
        createReadStream(absPath, { start, end }).pipe(res);
        return;
      }
    }
    res.setHeader('Content-Length', String(size));
    createReadStream(absPath).pipe(res);
  }
}
