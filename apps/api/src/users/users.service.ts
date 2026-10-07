import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../database/prisma.service.js';
import {
  buildPagination,
  normalizeSearch,
  paginate,
  type PaginatedResult,
} from '../common/dto/pagination-query.dto.js';
import { CreateAddressDto, CreateUserDto } from './dto/user.dto.js';
import type { Prisma, User } from '../../generated/prisma/client.js';
import { UserRole, UserStatus } from '../../generated/prisma/enums.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const role = dto.role ?? UserRole.CUSTOMER;
    return this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        fullName: dto.fullName,
        phone: dto.phone,
        role,
        status: dto.status,
        customerProfile: role === UserRole.CUSTOMER ? { create: {} } : undefined,
      },
      select: this.safeSelect(),
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    role?: string;
  }): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status as UserStatus } : {}),
      ...(query.role ? { role: query.role as UserRole } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search } },
              { email: { contains: search } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        select: this.safeSelect(),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { ...this.safeSelect(), customerProfile: { include: { addresses: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async addAddress(customerId: number, dto: CreateAddressDto) {
    const profile = await this.prisma.customerProfile.findUnique({ where: { userId: customerId } });
    if (!profile) throw new NotFoundException('Customer profile not found');
    if (dto.isDefault) {
      await this.prisma.address.updateMany({
        where: { customerId: profile.id },
        data: { isDefault: false },
      });
    }
    return this.prisma.address.create({ data: { ...dto, customerId: profile.id } });
  }

  async listAddresses(customerId: number) {
    const profile = await this.prisma.customerProfile.findUnique({ where: { userId: customerId } });
    if (!profile) throw new NotFoundException('Customer profile not found');
    return this.prisma.address.findMany({
      where: { customerId: profile.id },
      orderBy: [{ isDefault: 'desc' }, { id: 'desc' }],
    });
  }

  async setStatus(id: number, status: UserStatus): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.ADMIN && status === UserStatus.INACTIVE) {
      const adminCount = await this.prisma.user.count({ where: { role: UserRole.ADMIN } });
      if (adminCount <= 1) throw new BadRequestException('Cannot deactivate the last admin');
    }
    return this.prisma.user.update({ where: { id }, data: { status } });
  }

  private safeSelect() {
    return {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    } satisfies Prisma.UserSelect;
  }
}
