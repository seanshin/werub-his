import { BadRequestException, Controller, Get, Post, Delete, Param, Query, UseGuards, UseInterceptors, UploadedFile, ParseUUIDPipe } from '@nestjs/common';
import { extname } from 'path';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/homepage/media')
export class MediaController {
  constructor(private readonly service: MediaService) {}

  @Get()
  @ApiOperation({ summary: '미디어 목록' })
  async findAll(
    @Query('folder') folder?: string,
    @Query('type') mimeType?: string,
    @Query('search') search?: string,
  ) {
    return { data: await this.service.findAll({ folder, mimeType, search }) };
  }

  @Get('stats')
  @ApiOperation({ summary: '미디어 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  @Get('folders')
  @ApiOperation({ summary: '폴더 목록' })
  async getFolders() {
    return { data: await this.service.getFolders() };
  }

  @Post('upload')
  @ApiOperation({ summary: '파일 업로드' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    // 🔴 /media 는 공개 정적 서빙(확장자로 Content-Type 결정) — SVG·HTML 이 올라오면 저장형 XSS.
    // 이미지 MIME + 확장자 allowlist(SVG 제외)로 차단(2026-07 업로드 콘텐츠 검증 전수).
    fileFilter: (_req, file, cb) => {
      const okMime = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype);
      const okExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extname(file.originalname).toLowerCase());
      cb(okMime && okExt ? null : new BadRequestException('이미지 파일만 업로드할 수 있습니다 (jpg/png/gif/webp)'), okMime && okExt);
    },
  }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') folder: string = '/',
    @CurrentUser() user: any,
  ) {
    if (!file) throw new BadRequestException({ code: 'NO_FILE', message: '파일이 없습니다' });
    return { data: await this.service.upload(file, folder, (user.id ?? user.sub)!) };
  }

  @Post('sync')
  @ApiOperation({ summary: '파일시스템 → DB 동기화 (self-healing)' })
  async sync() {
    const result = await this.service.syncFilesystemToDb();
    return { data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: '파일 삭제' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
    return { data: { success: true } };
  }
}
