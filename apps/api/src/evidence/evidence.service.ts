/**
 * Private storage for after-sales evidence photos.
 *
 * REUSE, NOT REINVENTION
 *
 * Product images already solved the hard part: size/extension/magic-byte
 * validation, a decode check with sharp, re-encoding, dimension clamping and
 * random UUID file names. `EvidenceService` calls the same
 * `ProductImagesService.validateAndProcess` instead of copying it, so a fix to
 * the validation pipeline fixes both callers and the two can never drift.
 *
 * WHAT IS DIFFERENT — AND WHY IT MATTERS
 *
 * Product images are public: they live under `uploads/products` and are served
 * by the static middleware. Evidence is the opposite. A complaint photo is a
 * picture of the customer's own kitchen; a return photo may show their door. It
 * must not sit on a guessable public URL.
 *
 * So evidence files go to `uploads/evidence` — a directory the static
 * middleware is NOT configured to serve — and every read goes through
 * `GET /evidence/:id/file`, which resolves the owning entity and authorises the
 * caller. Possessing the URL grants nothing; no URL works without a token.
 *
 * THE UPLOAD → BIND SPLIT
 *
 * A phone uploads bytes before the entity exists (the customer is still typing
 * the reason). So an upload creates a row with NO owner — a temporary file —
 * and the create endpoint binds the ids it was given in the same transaction
 * that inserts the review/complaint/return. Consequences:
 *
 *  - An unbound row is unreachable: no policy grants access to it, and
 *    `sweepOrphans` deletes it (and its file) once it is older than the TTL, so
 *    an abandoned form cannot fill the disk.
 *  - Binding only happens in the owner's own create call and only for rows the
 *    caller uploaded, so customer A cannot bind B's upload.
 *  - Success is reported only after the entity AND its images exist, so the UI
 *    never claims a request was saved with photos that were lost.
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../database/prisma.service.js';
import {
  MAX_IMAGE_BYTES,
  ProductImagesService,
  uploadsRoot,
} from '../products/product-images.service.js';
import type { EvidenceImage, Prisma } from '../../generated/prisma/client.js';
import { ReviewStatus } from '../../generated/prisma/enums.js';

/** Max evidence photos per review, complaint or return request. */
export const MAX_EVIDENCE_PER_REQUEST = 5;

/**
 * How long an unbound upload survives before the sweep removes it.
 *
 * Long enough for a customer to fill in a form (and to recover from a dropped
 * connection and retry), short enough that an abandoned upload does not sit on
 * disk indefinitely.
 */
export const EVIDENCE_ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;

/** Private directory for evidence files. NOT served by static middleware. */
export function evidenceDir(): string {
  return path.join(uploadsRoot(), 'evidence');
}

/** What a caller is allowed to do with one image, resolved from the DB. */
export type EvidenceAccess = 'owner' | 'admin' | 'public' | 'none';

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ProductImagesService,
  ) {}

  /**
   * Accepts one upload and stores it as an UNBOUND row.
   *
   * The file is validated by the shared pipeline (size, extension, magic bytes,
   * decodability) and re-encoded, so what lands on disk is a known-good image
   * and never the customer's original bytes. The name on disk is a fresh UUID:
   * the uploaded name is kept as a column for support and is never used to
   * build a path, so a name like `../../etc/passwd` is inert.
   *
   * The row is mapped before it is returned. Returning it raw would put
   * `storageKey` — the actual file name on disk — into an HTTP response, which
   * is exactly the piece of information the private directory is meant to keep
   * unguessable.
   */
  async upload(
    uploaderId: number,
    file: Express.Multer.File | undefined,
  ): Promise<EvidenceImageView> {
    if (!file) throw new BadRequestException('Vui lòng chọn ảnh để tải lên.');

    const processed = await this.images.validateAndProcess(file.buffer, file.originalname);
    const storageKey = `${randomUUID()}.${processed.ext}`;

    await fs.mkdir(evidenceDir(), { recursive: true });
    await fs.writeFile(path.join(evidenceDir(), storageKey), processed.buffer);

    const row = await this.prisma.evidenceImage.create({
      data: {
        storageKey,
        mimeType: processed.mime,
        sizeBytes: processed.buffer.length,
        width: processed.width,
        height: processed.height,
        originalName: file.originalname.slice(0, 255),
        uploadedById: uploaderId,
      },
    });
    return toEvidenceView(row);
  }

  /**
   * Attaches the caller's unbound uploads to a freshly created entity.
   *
   * Runs inside the caller's transaction (`tx`), so the entity and its images
   * commit together: there is no window in which a request exists without the
   * photos it claimed to have, and a failure rolls the images back to unbound
   * (where the sweep cleans them) rather than leaving them pointing at a row
   * that was never created.
   *
   * Every id must be an unbound row uploaded BY THIS CALLER. That single
   * condition closes three holes at once: binding someone else's upload,
   * re-binding an image that already belongs to another request, and attaching
   * an id that was never uploaded at all.
   */
  async bind(
    tx: Prisma.TransactionClient,
    uploaderId: number,
    evidenceIds: number[] | undefined,
    owner: { reviewId?: number; complaintId?: number; returnId?: number },
  ): Promise<number> {
    const ids = [...new Set(evidenceIds ?? [])];
    if (ids.length === 0) return 0;
    if (ids.length > MAX_EVIDENCE_PER_REQUEST) {
      throw new BadRequestException(`Tối đa ${MAX_EVIDENCE_PER_REQUEST} ảnh cho mỗi yêu cầu.`);
    }

    const rows = await tx.evidenceImage.findMany({
      where: {
        id: { in: ids },
        uploadedById: uploaderId,
        reviewId: null,
        complaintId: null,
        returnId: null,
      },
      select: { id: true },
    });
    if (rows.length !== ids.length) {
      throw new BadRequestException(
        'Ảnh đính kèm không hợp lệ hoặc đã thuộc yêu cầu khác. Vui lòng tải lại ảnh.',
      );
    }

    await tx.evidenceImage.updateMany({
      where: { id: { in: ids } },
      data: { ...owner, sortOrder: 0 },
    });
    return ids.length;
  }

  /**
   * Authorises a read and returns the file location.
   *
   * The policy lives here, in one place, and is the reason the file is not
   * publicly served:
   *
   *  - unbound upload → nobody (not even the uploader can read it back; it is a
   *    temporary artefact of a form that has not been submitted);
   *  - complaint / return image → the customer who owns the request, or an
   *    ADMIN. Never the public, and never another customer;
   *  - review image → the reviewer, or an ADMIN, and the public ONLY while the
   *    review is APPROVED. A PENDING or HIDDEN review leaks nothing, which is
   *    what makes moderation meaningful.
   *
   * `viewer === null` means an anonymous request.
   */
  async resolveForRead(
    id: number,
    viewer: { id: number; role: string } | null,
  ): Promise<{ image: EvidenceImage; access: EvidenceAccess }> {
    const image = await this.prisma.evidenceImage.findUnique({
      where: { id },
      include: {
        review: { select: { customerId: true, status: true } },
        complaint: { select: { customerId: true } },
        returnReq: { select: { customerId: true } },
      },
    });
    if (!image) throw new NotFoundException('Không tìm thấy ảnh.');

    const isAdmin = viewer?.role === 'ADMIN';
    let access: EvidenceAccess = 'none';

    if (image.review) {
      if (isAdmin || viewer?.id === image.review.customerId) access = 'owner';
      else if (image.review.status === ReviewStatus.APPROVED) access = 'public';
    } else if (image.complaint) {
      if (isAdmin) access = 'admin';
      else if (viewer?.id === image.complaint.customerId) access = 'owner';
    } else if (image.returnReq) {
      if (isAdmin) access = 'admin';
      else if (viewer?.id === image.returnReq.customerId) access = 'owner';
    }

    return { image, access };
  }

  /**
   * Reads the stored bytes for an already-authorised image.
   *
   * `storageKey` is re-checked with `path.basename` before use: even though the
   * value was generated by us, resolving a path from a database column is
   * exactly where a traversal would live if that column were ever written by
   * another code path. The check makes the read safe by construction.
   */
  async readFile(image: EvidenceImage): Promise<Buffer> {
    const safe = path.basename(image.storageKey);
    if (!safe || safe === '.' || safe === '..') {
      throw new NotFoundException('Không tìm thấy ảnh.');
    }
    try {
      return await fs.readFile(path.join(evidenceDir(), safe));
    } catch {
      // The row exists but the file does not: a real inconsistency, reported as
      // a missing image rather than a 500.
      throw new NotFoundException('Không tìm thấy tệp ảnh.');
    }
  }

  /**
   * Metadata for the images bound to one owner, in display order.
   *
   * Only ids and dimensions travel — never `storageKey`. The client builds a
   * URL from the id, and an id alone is useless without a token, so a leaked
   * response body cannot be turned into access.
   */
  async listForOwner(owner: {
    reviewId?: number;
    complaintId?: number;
    returnId?: number;
  }): Promise<EvidenceImageView[]> {
    const rows = await this.prisma.evidenceImage.findMany({
      where: {
        ...(owner.reviewId !== undefined ? { reviewId: owner.reviewId } : {}),
        ...(owner.complaintId !== undefined ? { complaintId: owner.complaintId } : {}),
        ...(owner.returnId !== undefined ? { returnId: owner.returnId } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toEvidenceView);
  }

  /**
   * Deletes uploads that were never bound to anything and are older than the
   * TTL, along with their files.
   *
   * The row is deleted first and the file after, so a crash between the two
   * leaves an unreferenced file rather than a row pointing at nothing. Files
   * belonging to a bound row are never touched: the delete is scoped to rows
   * with all three owner columns null.
   */
  async sweepOrphans(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - EVIDENCE_ORPHAN_TTL_MS);
    const stale = await this.prisma.evidenceImage.findMany({
      where: {
        reviewId: null,
        complaintId: null,
        returnId: null,
        createdAt: { lt: cutoff },
      },
      select: { id: true, storageKey: true },
      take: 500,
    });
    if (stale.length === 0) return 0;

    const { count } = await this.prisma.evidenceImage.deleteMany({
      where: { id: { in: stale.map((s) => s.id) } },
    });

    for (const row of stale) {
      const safe = path.basename(row.storageKey);
      if (!safe || safe === '.' || safe === '..') continue;
      try {
        await fs.unlink(path.join(evidenceDir(), safe));
      } catch {
        // Already gone (manual cleanup, previous sweep): the row is what
        // matters and it is deleted.
        this.logger.debug(`Evidence file already absent: ${safe}`);
      }
    }
    return count;
  }
}

/** Wire shape of one evidence image. Never contains `storageKey`. */
export interface EvidenceImageView {
  id: number;
  width: number;
  height: number;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export function toEvidenceView(row: EvidenceImage): EvidenceImageView {
  return {
    id: row.id,
    width: row.width,
    height: row.height,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Re-exported so callers share one limit instead of declaring their own. */
export const EVIDENCE_MAX_BYTES = MAX_IMAGE_BYTES;
