import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import {
  EVIDENCE_MAX_BYTES,
  EvidenceService,
  MAX_EVIDENCE_PER_REQUEST,
} from './evidence.service.js';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.js';

/**
 * Evidence photos for reviews, complaints and return requests.
 *
 * TWO THINGS ARE DELIBERATELY ABSENT HERE
 *
 * 1. There is no public URL. The file route is authenticated (see `file`), so a
 *    customer cannot share a link that keeps working for anyone. The product
 *    image controller serves files through static middleware because catalogue
 *    photos are public by design; evidence is not, and the two must not share a
 *    route or a directory.
 *
 * 2. There is no "attach to entity" route. Binding happens inside the create
 *    call of the owning feature (`POST /reviews`, `/complaints`, `/returns`) in
 *    the same transaction that inserts the entity, so an image can never be
 *    attached to a request that does not exist, and a request can never be
 *    reported as saved while its photos are still in flight.
 */
@ApiTags('evidence')
@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @Post()
  @ApiOperation({
    summary: 'Upload one evidence photo, unbound (CUSTOMER)',
    description:
      `Validated and re-encoded server-side (max ${Math.round(EVIDENCE_MAX_BYTES / 1024 / 1024)} MB, ` +
      'JPG/PNG/WebP by real magic bytes). Returns an id to pass as `evidenceIds` when ' +
      'creating a review, complaint or return. Unbound uploads are swept after 24h.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: EVIDENCE_MAX_BYTES + 1024 * 1024, files: 1 },
      fileFilter: (_req, file, cb) => {
        const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
        if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return cb(null, true);
        cb(
          new BadRequestException('Chỉ nhận ảnh JPG, PNG hoặc WebP.') as unknown as Error,
          false,
        );
      },
    }),
  )
  upload(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: Express.Multer.File) {
    return this.evidence.upload(user.id, file);
  }

  /**
   * Serves the bytes of one image.
   *
   * `@Public()` is not "anyone may read it" — it disables the route-level JWT
   * requirement so that an anonymous browser request reaches the handler, where
   * `resolveForRead` applies the real policy. A missing/invalid token therefore
   * means `viewer === null`, which only ever unlocks APPROVED review images;
   * complaint and return evidence stays invisible.
   *
   * The response is streamed with the stored MIME type and `Cache-Control:
   * private`, so a shared cache cannot hand one customer's photo to another.
   * No filename is echoed and `Content-Disposition` is inline, so the bytes are
   * never treated as a download with a caller-influenced name.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id/file')
  @ApiOperation({
    summary: 'Read one evidence photo (owner, ADMIN, or public when the review is APPROVED)',
  })
  async file(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const viewer = (req as Request & { user?: AuthenticatedUser }).user ?? null;
    const { image, access } = await this.evidence.resolveForRead(
      id,
      viewer ? { id: viewer.id, role: viewer.role } : null,
    );

    if (access === 'none') {
      // 404 rather than 403: confirming that an id exists but is not yours
      // would turn this endpoint into an oracle for enumerating other
      // customers' requests.
      res.status(404).json({ statusCode: 404, message: 'Không tìm thấy ảnh.' });
      return;
    }

    const bytes = await this.evidence.readFile(image);
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Content-Length', String(bytes.length));
    // `private` keeps the customer's photo out of shared caches; the images are
    // immutable once written, so the client may reuse its own copy.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).end(bytes);
  }
}
