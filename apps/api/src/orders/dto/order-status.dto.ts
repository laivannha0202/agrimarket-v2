import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { OrderStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status!: OrderStatus;
}

/** Query DTO for `GET /orders` (admin): strict order-status enum. */
export class OrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  declare status?: OrderStatus;
}

/**
 * Query DTO for `GET /orders/me` (customer). The status filter is a strict
 * enum, so the server-side filter and `meta.total` are accurate and an unknown
 * value is a 400 rather than a silently ignored parameter.
 */
export class MyOrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  declare status?: OrderStatus;
}
