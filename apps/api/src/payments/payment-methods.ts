import { ServiceUnavailableException } from '@nestjs/common';
import { PaymentMethod } from '../../generated/prisma/enums.js';

/**
 * Which payment methods this deployment can actually settle.
 *
 * `PaymentMethod` is a database enum, not a capability list. `VNPAY` and
 * `MOCK_ONLINE` exist because historical rows may carry them, but no payment
 * gateway is integrated: there is no initiation endpoint, no signature
 * verification and no callback. Offering them at checkout would create an order
 * that can never be paid and would let a client "choose" a method that has no
 * implementation behind it.
 *
 * The switch is explicit and fails closed: online methods are refused unless
 * `PAYMENTS_ONLINE_ENABLED=true` AND the gateway integration is actually
 * deployed. `MOCK_ONLINE` is a development stub and is refused in production
 * even when the flag is on, so a misconfigured production deployment cannot
 * accept a fake "successful" online payment.
 */
export function isOnlinePaymentEnabled(
  raw: string | undefined = process.env.PAYMENTS_ONLINE_ENABLED,
): boolean {
  return (raw ?? '').trim().toLowerCase() === 'true';
}

export function isPaymentMethodAvailable(
  method: PaymentMethod,
  options: {
    onlineEnabled?: string;
    nodeEnv?: string;
  } = {},
): boolean {
  if (method === PaymentMethod.COD) return true;
  if (!isOnlinePaymentEnabled(options.onlineEnabled)) return false;
  // The mock gateway only ever produces fake confirmations; it must never be
  // selectable in a production build.
  if (method === PaymentMethod.MOCK_ONLINE) {
    return (options.nodeEnv ?? process.env.NODE_ENV) !== 'production';
  }
  return method === PaymentMethod.VNPAY;
}

/**
 * Throws 503 (not 400) when a method exists in the enum but is not configured:
 * the request is well-formed, the deployment simply cannot serve it yet.
 */
export function assertPaymentMethodAvailable(
  method: PaymentMethod,
  options: { onlineEnabled?: string; nodeEnv?: string } = {},
): void {
  if (isPaymentMethodAvailable(method, options)) return;
  throw new ServiceUnavailableException(
    'Phương thức thanh toán trực tuyến chưa được kích hoạt. Vui lòng chọn thanh toán khi nhận hàng (COD).',
  );
}

/** The methods a client may actually choose right now. */
export function availablePaymentMethods(
  options: { onlineEnabled?: string; nodeEnv?: string } = {},
): PaymentMethod[] {
  return Object.values(PaymentMethod).filter((method) =>
    isPaymentMethodAvailable(method, options),
  );
}
