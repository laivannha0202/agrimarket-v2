import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import {
  buildCode,
  isUniqueViolationOn,
  nextSequence,
} from '../common/utils/code.util.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto.js';
import type { Prisma, Warehouse } from '../../generated/prisma/client.js';
import { RecordStatus } from '../../generated/prisma/enums.js';

const CODE_ATTEMPTS = 3;

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateWarehouseDto, actorUserId?: number): Promise<Warehouse> {
    const name = dto.name?.trim();
    const address = dto.address?.trim();
    if (!name) throw new BadRequestException('Tên kho không được để trống');
    if (!address) throw new BadRequestException('Địa chỉ kho không được để trống');
    const status = dto.status ?? RecordStatus.ACTIVE;

    for (let attempt = 1; ; attempt += 1) {
      try {
        const existing = await this.prisma.warehouse.findMany({ select: { code: true } });
        const code = buildCode('WH', nextSequence(existing.map((r) => r.code), 'WH'));
        const warehouse = await this.prisma.warehouse.create({
          data: { code, name, address, status },
        });
        await this.audit.record({
          actorUserId,
          action: 'WAREHOUSE_CREATE',
          entityType: 'Warehouse',
          entityId: String(warehouse.id),
          afterJson: warehouse,
        });
        return warehouse;
      } catch (error) {
        if (isUniqueViolationOn(error, 'code') && attempt < CODE_ATTEMPTS) continue;
        if (isUniqueViolationOn(error, 'code')) {
          throw new ConflictException('Mã kho đã tồn tại, vui lòng thử lại');
        }
        throw error;
      }
    }
  }

  async findAll(query: {
    page?: number;
    limit?: number;
  }): Promise<PaginatedResult<Warehouse>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const [data, total] = await Promise.all([
      this.prisma.warehouse.findMany({ skip, take, orderBy: { id: 'asc' } }),
      this.prisma.warehouse.count(),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number): Promise<Warehouse> {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    return warehouse;
  }

  /**
   * Update a warehouse (name/address/status).
   *
   * The warehouse code is immutable and history is never moved: only the
   * display fields and the ACTIVE/INACTIVE flag may change.
   *
   * ACTIVE → INACTIVE is guarded inside a transaction with a `SELECT ... FOR
   * UPDATE` row lock: a warehouse with on-hand / reserved / blocked stock, an
   * open DRAFT document, or an open allocation (order not DELIVERED/CANCELLED)
   * is refused with 409 and its status is left untouched. The lock serialises
   * deactivation against inbound/reserve paths that lock the same row before
   * writing stock (see `InventoryService.requireActiveWarehouse`), so a
   * concurrent inbound cannot slip in between the check and the status flip.
   */
  async update(id: number, dto: UpdateWarehouseDto, actorUserId?: number): Promise<Warehouse> {
    const data: Prisma.WarehouseUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Tên kho không được để trống');
      data.name = name;
    }
    if (dto.address !== undefined) {
      const address = dto.address.trim();
      if (!address) throw new BadRequestException('Địa chỉ kho không được để trống');
      data.address = address;
    }
    const wantsDeactivate = dto.status === RecordStatus.INACTIVE;
    const wantsActivate = dto.status === RecordStatus.ACTIVE;

    if (!wantsDeactivate) {
      const before = await this.findOne(id);
      const updated = await this.prisma.warehouse.update({ where: { id }, data: { ...data, ...(wantsActivate ? { status: RecordStatus.ACTIVE } : {}) } });
      await this.audit.record(
        {
          actorUserId,
          action: wantsActivate && before.status !== RecordStatus.ACTIVE ? 'WAREHOUSE_REACTIVATE' : 'WAREHOUSE_UPDATE',
          entityType: 'Warehouse',
          entityId: String(id),
          beforeJson: before,
          afterJson: updated,
        },
      );
      return updated;
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number; status: string }[]>`
        SELECT id, status FROM warehouses WHERE id = ${id} FOR UPDATE
      `;
      if (locked.length === 0) throw new NotFoundException('Warehouse not found');
      const current = locked[0].status;
      if (current !== RecordStatus.ACTIVE) {
        const before = await tx.warehouse.findUniqueOrThrow({ where: { id } });
        const updated = await tx.warehouse.update({ where: { id }, data });
        await this.audit.record(
          { actorUserId, action: 'WAREHOUSE_UPDATE', entityType: 'Warehouse', entityId: String(id), beforeJson: before, afterJson: updated },
          tx,
        );
        return updated;
      }

      const sums = await tx.$queryRaw<{ onHand: unknown; reserved: unknown; blocked: unknown }[]>`
        SELECT COALESCE(SUM(on_hand), 0) AS onHand,
               COALESCE(SUM(reserved), 0) AS reserved,
               COALESCE(SUM(blocked), 0) AS blocked
          FROM inventory_balances WHERE warehouse_id = ${id}
      `;
      const onHand = Number(sums[0]?.onHand ?? 0);
      const reserved = Number(sums[0]?.reserved ?? 0);
      const blocked = Number(sums[0]?.blocked ?? 0);
      if (onHand > 0) {
        throw new ConflictException(`Không thể ngừng kho: còn ${onHand} tồn thực tế`);
      }
      if (reserved > 0) {
        throw new ConflictException(`Không thể ngừng kho: còn ${reserved} giữ chỗ chưa kết thúc`);
      }
      if (blocked > 0) {
        throw new ConflictException(`Không thể ngừng kho: còn ${blocked} hàng cách ly chưa xử lý`);
      }

      const draftCount = await tx.warehouseDocument.count({
        where: { warehouseId: id, status: 'DRAFT' },
      });
      if (draftCount > 0) {
        throw new ConflictException(`Không thể ngừng kho: còn ${draftCount} phiếu nháp chưa xử lý`);
      }

      const openAllocations = await tx.inventoryAllocation.count({
        where: {
          inventoryBalance: { warehouseId: id },
          orderItem: { partnerOrder: { order: { status: { notIn: ['DELIVERED', 'CANCELLED'] } } } },
        },
      });
      if (openAllocations > 0) {
        throw new ConflictException(
          `Không thể ngừng kho: còn ${openAllocations} cấp phát cho đơn chưa kết thúc`,
        );
      }

      const before = await tx.warehouse.findUniqueOrThrow({ where: { id } });
      const claimed = await tx.warehouse.updateMany({
        where: { id, status: RecordStatus.ACTIVE },
        data: { ...data, status: RecordStatus.INACTIVE },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Trạng thái kho đã thay đổi, vui lòng tải lại');
      }
      const updated = await tx.warehouse.findUniqueOrThrow({ where: { id } });
      await this.audit.record(
        {
          actorUserId,
          action: 'WAREHOUSE_DEACTIVATE',
          entityType: 'Warehouse',
          entityId: String(id),
          beforeJson: before,
          afterJson: updated,
        },
        tx,
      );
      return updated;
    });
  }

}
