import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { MAX_IDEMPOTENCY_KEY_LENGTH } from '../idempotency/idempotency.constants.js';

/**
 * Requires and normalises the `Idempotency-Key` header on a state-changing
 * endpoint. These endpoints refuse an unsafe retry instead of silently
 * applying the operation twice; clients must send a stable key per logical
 * operation and reuse it when retrying.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const raw = request.headers?.['idempotency-key'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const key = value?.trim();
    if (!key) {
      throw new BadRequestException('Idempotency-Key header is required for this operation');
    }
    if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException(
        `Idempotency-Key header is too long (max ${MAX_IDEMPOTENCY_KEY_LENGTH} characters)`,
      );
    }
    return key;
  },
);
