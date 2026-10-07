import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Public traceability. Given a lot traceCode, walk the full origin chain:
 * ProductLot -> Product -> Harvest -> Season -> Farm -> Partner,
 * plus valid certificates, latest QC result and public trace events.
 * Only safe fields are returned (no ids we don't need, no bank/audit data).
 */
@Injectable()
export class TraceabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async trace(traceCode: string) {
    const lot = await this.prisma.productLot.findUnique({
      where: { traceCode },
      include: {
        product: {
          include: {
            category: true,
            partner: true,
            images: { orderBy: { sortOrder: 'asc' } },
          },
        },
        harvest: {
          include: {
            season: {
              include: {
                farm: {
                  include: {
                    certificates: true,
                  },
                },
                farmingEvents: {
                  where: { isPublic: true },
                  orderBy: { occurredAt: 'asc' },
                },
              },
            },
          },
        },
        qcInspections: { orderBy: { inspectedAt: 'desc' } },
        traceEvents: { where: { isPublic: true }, orderBy: { occurredAt: 'asc' } },
      },
    });

    if (!lot) throw new NotFoundException('Trace code not found');

    const now = new Date();
    const farm = lot.harvest.season.farm;

    const validCertificates = farm.certificates
      .filter(
        (c) =>
          c.verificationStatus === 'VERIFIED' &&
          c.status === 'ACTIVE' &&
          c.issuedAt <= now &&
          c.expiresAt >= now,
      )
      .map((c) => ({
        type: c.type,
        certificateCode: c.certificateCode,
        issuer: c.issuer,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        verifiedAt: c.verifiedAt,
      }));

    const latestQc = lot.qcInspections[0] ?? null;

    return {
      lot: {
        code: lot.code,
        traceCode: lot.traceCode,
        grade: lot.grade,
        unit: lot.unit,
        quantity: lot.quantity.toString(),
        remainingQuantity: lot.remainingQuantity.toString(),
        packedAt: lot.packedAt,
        expiresAt: lot.expiresAt,
        status: lot.status,
        isExpired: lot.expiresAt < now,
      },
      product: {
        name: lot.product.name,
        slug: lot.product.slug,
        description: lot.product.description,
        category: lot.product.category.name,
        images: lot.product.images.map((i) => i.url),
      },
      partner: {
        name: lot.product.partner.name,
        representativeName: lot.product.partner.representativeName,
      },
      farm: {
        name: farm.name,
        address: farm.address,
        areaHa: farm.areaHa?.toString() ?? null,
        description: farm.description,
      },
      season: {
        cropName: lot.harvest.season.cropName,
        variety: lot.harvest.season.variety,
        plantingDate: lot.harvest.season.plantingDate,
        expectedHarvestDate: lot.harvest.season.expectedHarvestDate,
        status: lot.harvest.season.status,
      },
      farmingEvents: lot.harvest.season.farmingEvents.map((e) => ({
        type: e.type,
        occurredAt: e.occurredAt,
        content: e.content,
      })),
      harvest: {
        harvestDate: lot.harvest.harvestDate,
        quantity: lot.harvest.quantity.toString(),
        unit: lot.harvest.unit,
        grade: lot.harvest.grade,
      },
      qualityControl: latestQc
        ? {
            result: latestQc.result,
            appearancePassed: latestQc.appearancePassed,
            freshnessPassed: latestQc.freshnessPassed,
            packagingPassed: latestQc.packagingPassed,
            damagePassed: latestQc.damagePassed,
            inspectedAt: latestQc.inspectedAt,
          }
        : null,
      certificates: validCertificates,
      traceEvents: lot.traceEvents.map((e) => ({
        type: e.type,
        occurredAt: e.occurredAt,
        location: e.location,
        description: e.description,
      })),
    };
  }
}
