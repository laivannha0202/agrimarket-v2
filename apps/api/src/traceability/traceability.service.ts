import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { publicFarmVisibility } from '../farms/farm-visibility.js';

/**
 * Public traceability. Given a lot traceCode, walk the full origin chain:
 * ProductLot -> Product -> Harvest -> Season -> Farm -> Partner,
 * plus valid certificates, latest QC result and public trace events.
 * Only safe fields are returned (no ids we don't need, no bank/audit data).
 */
export type TraceCheckStatus = 'OK' | 'WARNING' | 'MISSING';

export interface TraceCheck {
  key: string;
  label: string;
  status: TraceCheckStatus;
  detail: string;
}

@Injectable()
export class TraceabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * C-14 admin-side audit of one lot's chain. Unlike the public trace this
   * includes non-public events and returns explicit completeness checks, so an
   * operator can see WHICH link is missing before publishing a trace code.
   * Nothing is fabricated: a missing link is reported, never filled in.
   */
  async adminTrace(lotId: number) {
    const lot = await this.prisma.productLot.findUnique({
      where: { id: lotId },
      include: {
        product: {
          include: {
            category: true,
            partner: { select: { id: true, code: true, name: true } },
          },
        },
        harvest: {
          include: {
            season: {
              include: {
                farm: { include: { partner: { select: { id: true, code: true, name: true } } } },
                farmingEvents: { orderBy: { occurredAt: 'asc' } },
              },
            },
          },
        },
        qcInspections: { orderBy: { inspectedAt: 'desc' } },
        traceEvents: { orderBy: { occurredAt: 'asc' } },
      },
    });
    if (!lot) throw new NotFoundException('Product lot not found');

    const checks: TraceCheck[] = [];
    const add = (
      key: string,
      label: string,
      ok: boolean,
      detail: string,
      statusIfFailed: TraceCheckStatus = 'MISSING',
    ) => checks.push({ key, label, status: ok ? 'OK' : statusIfFailed, detail });

    add('lot', 'Lô hàng và mã truy xuất', !!lot.code && !!lot.traceCode, `${lot.code} / ${lot.traceCode}`);
    add('product', 'Sản phẩm và danh mục', !!lot.product?.category, lot.product?.name ?? 'Thiếu sản phẩm');
    add(
      'partner',
      'Đối tác sở hữu',
      !!lot.product?.partner,
      lot.product?.partner?.name ?? 'Thiếu đối tác',
    );
    add(
      'harvest',
      'Vụ thu hoạch',
      !!lot.harvest,
      lot.harvest ? `${lot.harvest.grade} · ${lot.harvest.quantity} ${lot.harvest.unit}` : 'Thiếu vụ thu hoạch',
    );
    add(
      'season',
      'Vụ mùa',
      !!lot.harvest?.season,
      lot.harvest?.season?.cropName ?? 'Thiếu vụ mùa',
    );
    add(
      'farm',
      'Trang trại',
      !!lot.harvest?.season?.farm,
      lot.harvest?.season?.farm?.name ?? 'Thiếu trang trại',
    );
    add(
      'farm-partner',
      'Trang trại thuộc đúng đối tác',
      !!lot.harvest?.season?.farm &&
        lot.harvest.season.farm.partnerId === lot.product?.partnerId,
      'Trang trại và sản phẩm phải cùng một đối tác',
    );

    const plantingDate = lot.harvest?.season?.plantingDate ?? null;
    const harvestDate = lot.harvest?.harvestDate ?? null;
    const chronologyOk = !plantingDate || !harvestDate || harvestDate >= plantingDate;
    add(
      'chronology',
      'Thứ tự ngày trồng → thu hoạch',
      chronologyOk,
      chronologyOk
        ? 'Ngày thu hoạch không trước ngày trồng'
        : 'Ngày thu hoạch trước ngày trồng',
    );

    const publicEvents = lot.harvest?.season?.farmingEvents.filter((e) => e.isPublic) ?? [];
    add(
      'farming-public',
      'Nhật ký canh tác công khai',
      publicEvents.length > 0,
      publicEvents.length > 0
        ? `${publicEvents.length} hoạt động công khai`
        : 'Chưa có hoạt động canh tác công khai',
      'WARNING',
    );

    const latestQc = lot.qcInspections[0];
    add(
      'qc',
      'Kiểm định chất lượng',
      !!latestQc,
      latestQc ? `Kết quả ${latestQc.result}` : 'Chưa có phiếu kiểm định',
      'WARNING',
    );
    add(
      'qc-sellable',
      'Lô bán được phải đạt QC',
      lot.status !== 'SELLABLE' || latestQc?.result === 'PASS',
      lot.status === 'SELLABLE' && latestQc?.result !== 'PASS'
        ? 'Lô SELLABLE nhưng chưa có QC PASS'
        : 'Không vi phạm',
    );

    const eventTypes = new Set(lot.traceEvents.map((e) => e.type));
    add(
      'trace-harvest',
      'Sự kiện truy xuất thu hoạch',
      eventTypes.has('HARVEST'),
      eventTypes.has('HARVEST') ? 'Đã có' : 'Thiếu sự kiện HARVEST',
    );
    add(
      'trace-qc',
      'Sự kiện truy xuất kiểm định',
      eventTypes.has('QC'),
      eventTypes.has('QC') ? 'Đã có' : 'Chưa có sự kiện QC',
      'WARNING',
    );

    const ordered = lot.traceEvents.every(
      (event, index, all) => index === 0 || all[index - 1].occurredAt <= event.occurredAt,
    );
    add(
      'trace-order',
      'Thứ tự sự kiện truy xuất',
      ordered,
      ordered ? 'Sự kiện tăng dần theo thời gian' : 'Sự kiện không theo thứ tự thời gian',
    );

    const expired = lot.expiresAt < new Date();
    add(
      'expiry',
      'Hạn sử dụng',
      !expired,
      expired ? 'Lô đã hết hạn' : `Còn hạn đến ${lot.expiresAt.toISOString().slice(0, 10)}`,
      'WARNING',
    );

    const missing = checks.filter((check) => check.status === 'MISSING');
    return {
      lot: {
        id: lot.id,
        code: lot.code,
        traceCode: lot.traceCode,
        status: lot.status,
        quantity: lot.quantity.toString(),
        remainingQuantity: lot.remainingQuantity.toString(),
        unit: lot.unit,
      },
      product: { id: lot.product.id, name: lot.product.name },
      partner: lot.product.partner,
      farm: lot.harvest?.season?.farm
        ? {
            id: lot.harvest.season.farm.id,
            code: lot.harvest.season.farm.code,
            name: lot.harvest.season.farm.name,
          }
        : null,
      season: lot.harvest?.season
        ? { id: lot.harvest.season.id, cropName: lot.harvest.season.cropName }
        : null,
      harvest: lot.harvest
        ? {
            id: lot.harvest.id,
            harvestDate: lot.harvest.harvestDate,
            quantity: lot.harvest.quantity.toString(),
            unit: lot.harvest.unit,
            grade: lot.harvest.grade,
          }
        : null,
      farmingEventCount: lot.harvest?.season?.farmingEvents.length ?? 0,
      publicFarmingEventCount: publicEvents.length,
      traceEventCount: lot.traceEvents.length,
      checks,
      complete: missing.length === 0,
      missing: missing.length,
      warnings: checks.filter((check) => check.status === 'WARNING').length,
    };
  }

  async trace(traceCode: string) {
    const lot = await this.prisma.productLot.findFirst({
      where: {
        traceCode,
        harvest: { is: { season: { is: { farm: publicFarmVisibility } } } },
      },
      include: {
        product: {
          include: {
            category: true,
            partner: { select: { id: true, code: true, name: true, representativeName: true } },
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
