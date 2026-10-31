import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { PaymentMethod, PaymentStatus, RefundStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class CreatePaymentDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  orderId!: number;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiPropertyOptional({ example: 250000, description: 'Ignored: the amount is derived from the order grandTotal' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amount?: number;
}

export class UpdatePaymentStatusDto {
  @ApiProperty({ enum: PaymentStatus })
  @IsEnum(PaymentStatus)
  status!: PaymentStatus;

  @ApiPropertyOptional({ example: 'VNP-TXN-889900' })
  @IsOptional()
  @IsString()
  transactionReference?: string;
}

export class CreateRefundDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  paymentId!: number;

  @ApiProperty({ example: 50000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({ example: 'Hoàn tiền do hàng dập nát' })
  @IsString()
  reason!: string;

  /**
   * Link the refund to the return request it settles. The refund then counts
   * as a direct liability of that return's partner order instead of being
   * spread proportionally across the order.
   */
  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  returnRequestId?: number;
}

/** Proof that the money actually left: required to complete a refund. */
export class CompleteRefundDto {
  @ApiProperty({ example: 'BANK-TXN-20261023-001', description: 'Bank/gateway reference' })
  @IsString()
  @MinLength(1)
  reference!: string;
}

export class FailRefundDto {
  @ApiProperty({ example: 'Ngân hàng từ chối do sai số tài khoản' })
  @IsString()
  @MinLength(1)
  failureReason!: string;
}

/** Query DTO for `GET /payments` (admin): strict payment-status enum. */
export class PaymentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  declare status?: PaymentStatus;
}

/** Query DTO for `GET /refunds` (admin): strict refund-status enum. */
export class RefundQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RefundStatus })
  @IsOptional()
  @IsEnum(RefundStatus)
  declare status?: RefundStatus;
}
