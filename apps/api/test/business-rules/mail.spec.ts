import { describe, expect, it } from 'vitest';
import { MailService } from '../../src/mail/mail.service.js';

/**
 * Transport selection and honest delivery reporting.
 *
 * The recovery endpoint tells the customer whether mail was really delivered
 * (see `AuthService.forgotPassword`), so `isRealDelivery` has to be true ONLY
 * when an SMTP server is configured. If the `test` transport ever reported
 * itself as real delivery, the API would claim an e-mail was sent that never
 * left the process — and no test would notice, because the capture buffer would
 * still hold the message.
 */

/** Minimal ConfigService stand-in; only `get` is used by MailService. */
function configWith(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as never;
}

describe('MailService', () => {
  describe('mode selection', () => {
    it('uses the test transport when nothing is configured', () => {
      const service = new MailService(configWith({}));
      expect(service.mode).toBe('test');
      expect(service.isRealDelivery).toBe(false);
    });

    it('uses SMTP when a host is configured, even without MAIL_TRANSPORT', () => {
      const service = new MailService(configWith({ smtpHost: 'smtp.example.com' }));
      expect(service.mode).toBe('smtp');
      expect(service.isRealDelivery).toBe(true);
    });

    it('honours an explicit MAIL_TRANSPORT=test even when a host is set', () => {
      // This is what keeps the test suite from mailing real people.
      const service = new MailService(
        configWith({ mailTransport: 'test', smtpHost: 'smtp.example.com' }),
      );
      expect(service.mode).toBe('test');
      expect(service.isRealDelivery).toBe(false);
    });

    it('honours an explicit MAIL_TRANSPORT=smtp', () => {
      const service = new MailService(
        configWith({ mailTransport: 'smtp', smtpHost: 'smtp.example.com' }),
      );
      expect(service.mode).toBe('smtp');
    });

    it('is case-insensitive about the transport name', () => {
      const service = new MailService(configWith({ mailTransport: 'TEST' }));
      expect(service.mode).toBe('test');
    });

    it('falls back to the host check for an unrecognised transport name', () => {
      const service = new MailService(configWith({ mailTransport: 'carrier-pigeon' }));
      expect(service.mode).toBe('test');
    });
  });

  describe('the test transport captures without delivering', () => {
    it('records a sent message so a test can assert on it', async () => {
      const service = new MailService(configWith({ mailTransport: 'test' }));
      service.clearCaptured();

      await service.send({ to: 'khach@agrimarket.vn', subject: 'Đặt lại mật khẩu', text: 'nội dung' });

      const captured = service.sentMessages();
      expect(captured).toHaveLength(1);
      expect(captured[0].to).toBe('khach@agrimarket.vn');
      expect(captured[0].subject).toBe('Đặt lại mật khẩu');
      expect(captured[0].capturedAt).toBeInstanceOf(Date);
    });

    it('clearCaptured empties the buffer', async () => {
      const service = new MailService(configWith({ mailTransport: 'test' }));
      await service.send({ to: 'a@b.vn', subject: 's', text: 't' });
      service.clearCaptured();
      expect(service.sentMessages()).toHaveLength(0);
    });
  });

  describe('SMTP mode', () => {
    it('keeps no capture buffer, because nothing is captured', () => {
      const service = new MailService(
        configWith({ mailTransport: 'smtp', smtpHost: 'smtp.example.com' }),
      );
      expect(service.sentMessages()).toHaveLength(0);
    });
  });
});
