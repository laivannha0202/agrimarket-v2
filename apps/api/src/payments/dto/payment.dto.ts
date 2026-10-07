import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PaymentMethod, PaymentStatus } from '../../../generated/prisma/enums.js';

export class CreatePaymentDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  orderId!: number;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiProperty({ example: 250000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;
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
}
