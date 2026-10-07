import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { buildCode } from '../common/utils/code.util.js';
import { buildPagination, paginate, type PaginatedResult } from '../common/dto/pagination-query.dto.js';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto.js';
import type { Warehouse } from '../../generated/prisma/client.js';

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateWarehouseDto): Promise<Warehouse> {
    const count = await this.prisma.warehouse.count();
    const code = buildCode('WH', count + 1);
    return this.prisma.warehouse.create({ data: { ...dto, code } });
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

  async update(id: number, dto: UpdateWarehouseDto): Promise<Warehouse> {
    await this.findOne(id);
    return this.prisma.warehouse.update({ where: { id }, data: dto });
  }
}
