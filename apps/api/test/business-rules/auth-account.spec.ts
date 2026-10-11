import { describe, expect, it, beforeEach } from 'vitest';
import { AuthService, hashResetToken } from '../../src/auth/auth.service.js';
import { MailService } from '../../src/mail/mail.service.js';
import { createMockPrisma, type MockPrisma } from '../helpers/prisma-mock.js';

/**
 * Unit coverage for customer account self-service.
 *
 * The e2e suite already proves the HTTP behaviour against a real database. What
 * is asserted HERE is what a database cannot easily show: that the recovery
 * response is byte-identical for a registered and an unregistered address, that
 * only a HASH of the reset token is persisted, and that a lost token-claim race
 * is reported as an invalid link rather than as a server error.
 */

const FORGOT_MESSAGE =
  'Nếu email này có tài khoản AgriMarket, chúng tôi đã gửi liên kết đặt lại mật khẩu.';

interface Harness {
  prisma: MockPrisma;
  service: AuthService;
  mail: {
    mode: string;
    isRealDelivery: boolean;
    send: ReturnType<typeof vi.fn>;
    sent: Array<{ to: string; subject: string; text: string }>;
  };
}

function setup(): Harness {
  const prisma = createMockPrisma();

  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const mail = {
    mode: 'test' as string,
    isRealDelivery: false as boolean,
    send: null as unknown as ReturnType<typeof vi.fn>,
    sent,
  };
  mail.send = vi.fn(async (message: { to: string; subject: string; text: string }) => {
    sent.push(message);
  });

  const jwt = { signAsync: vi.fn(async () => 'signed.jwt.token') };
  const config = { get: vi.fn((key: string) => (key === 'customerWebUrl' ? 'http://web.test' : undefined)) };
  const audit = { record: vi.fn(async () => undefined) };

  const service = new AuthService(
    prisma as never,
    jwt as never,
    config as never,
    audit as never,
    mail as unknown as MailService,
  );

  return { prisma, service, mail };
}

describe('AuthService', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
  });

  // -------------------------------------------------------------------------
  describe('register', () => {
    it('always creates a CUSTOMER with a profile, and issues no token', async () => {
      h.prisma.user.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        id: 7,
        email: args.data.email,
        fullName: args.data.fullName,
        role: args.data.role,
      }));

      const result = await h.service.register({
        email: 'Khach@Example.com ',
        password: 'MatKhau@12345',
        fullName: '  Trần Văn An  ',
        phone: '0912345678',
      });

      const created = h.prisma.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
      // The e-mail is lower-cased and trimmed, so the unique index sees one
      // account for one address regardless of how it was typed.
      expect(created.data.email).toBe('khach@example.com');
      expect(created.data.fullName).toBe('Trần Văn An');
      expect(created.data.role).toBe('CUSTOMER');
      expect(created.data.status).toBe('ACTIVE');
      // A profile-less customer could not own a cart or an address.
      expect(created.data.customerProfile).toEqual({ create: {} });
      // No session: the customer signs in on the login screen.
      expect(result).not.toHaveProperty('accessToken');
    });

    it('stores a bcrypt hash, never the password itself', async () => {
      h.prisma.user.create.mockResolvedValue({
        id: 7,
        email: 'a@b.vn',
        fullName: 'A',
        role: 'CUSTOMER',
      });

      await h.service.register({
        email: 'a@b.vn',
        password: 'MatKhau@12345',
        fullName: 'A',
        phone: '0912345678',
      });

      const created = h.prisma.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
      const hash = String(created.data.passwordHash);
      expect(hash).not.toContain('MatKhau@12345');
      expect(hash.startsWith('$2')).toBe(true);
    });

    it('normalises an international phone number to the local form', async () => {
      h.prisma.user.create.mockResolvedValue({
        id: 7,
        email: 'a@b.vn',
        fullName: 'A',
        role: 'CUSTOMER',
      });

      await h.service.register({
        email: 'a@b.vn',
        password: 'MatKhau@12345',
        fullName: 'A',
        phone: '+84912345678',
      });

      const created = h.prisma.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(created.data.phone).toBe('0912345678');
    });

    it('rejects a phone number that is not a Vietnamese mobile', async () => {
      await expect(
        h.service.register({
          email: 'a@b.vn',
          password: 'MatKhau@12345',
          fullName: 'A',
          phone: '123',
        }),
      ).rejects.toThrow(/Số điện thoại chưa hợp lệ/);
      // Nothing may be written for a rejected registration.
      expect(h.prisma.user.create).not.toHaveBeenCalled();
    });

    it('turns a unique-constraint violation into a 409, not a 500', async () => {
      h.prisma.user.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      await expect(
        h.service.register({
          email: 'a@b.vn',
          password: 'MatKhau@12345',
          fullName: 'A',
          phone: '0912345678',
        }),
      ).rejects.toThrow(/Email này đã được đăng ký/);
    });

    it('never writes the password or its hash to the audit trail', async () => {
      h.prisma.user.create.mockResolvedValue({
        id: 7,
        email: 'a@b.vn',
        fullName: 'A',
        role: 'CUSTOMER',
      });

      await h.service.register({
        email: 'a@b.vn',
        password: 'MatKhau@12345',
        fullName: 'A',
        phone: '0912345678',
      });

      const audited = JSON.stringify(
        (h.prisma.auditLog as unknown as { create: { mock: { calls: unknown[] } } }).create.mock
          .calls,
      );
      expect(audited).not.toContain('MatKhau@12345');
      expect(audited).not.toContain('$2');
    });
  });

  // -------------------------------------------------------------------------
  describe('login', () => {
    it('binds the token to the current password version', async () => {
      const changedAt = new Date('2026-10-12T08:30:00.000Z');
      h.prisma.user.findUnique.mockResolvedValue({
        id: 5,
        email: 'a@b.vn',
        role: 'CUSTOMER',
        fullName: 'A',
        phone: '0912345678',
        status: 'ACTIVE',
        passwordHash: await bcryptHash('MatKhau@12345'),
        passwordChangedAt: changedAt,
      });

      await h.service.login('a@b.vn', 'MatKhau@12345');

      const payload = (
        (h.service as unknown as { jwt: { signAsync: { mock: { calls: unknown[][] } } } }).jwt
          .signAsync.mock.calls[0][0]
      ) as Record<string, unknown>;
      // The version is what lets `JwtStrategy` end this session the moment the
      // password changes, with no reliance on second-precision `iat`.
      expect(payload.pwd).toBe(changedAt.getTime());
    });

    it('uses version 0 for an account that never changed its password', async () => {
      h.prisma.user.findUnique.mockResolvedValue({
        id: 5,
        email: 'a@b.vn',
        role: 'CUSTOMER',
        fullName: 'A',
        phone: '0912345678',
        status: 'ACTIVE',
        passwordHash: await bcryptHash('MatKhau@12345'),
        passwordChangedAt: null,
      });

      await h.service.login('a@b.vn', 'MatKhau@12345');

      const payload = (
        (h.service as unknown as { jwt: { signAsync: { mock: { calls: unknown[][] } } } }).jwt
          .signAsync.mock.calls[0][0]
      ) as Record<string, unknown>;
      expect(payload.pwd).toBe(0);
    });

    it('rejects a wrong password', async () => {
      h.prisma.user.findUnique.mockResolvedValue({
        id: 5,
        email: 'a@b.vn',
        role: 'CUSTOMER',
        fullName: 'A',
        phone: '0912345678',
        status: 'ACTIVE',
        passwordHash: await bcryptHash('MatKhau@12345'),
        passwordChangedAt: null,
      });

      await expect(h.service.login('a@b.vn', 'SaiMatKhau@1')).rejects.toThrow(/Invalid/);
    });

    it('rejects a non-ACTIVE account even with the right password', async () => {
      h.prisma.user.findUnique.mockResolvedValue({
        id: 5,
        email: 'a@b.vn',
        role: 'CUSTOMER',
        fullName: 'A',
        phone: '0912345678',
        status: 'LOCKED',
        passwordHash: await bcryptHash('MatKhau@12345'),
        passwordChangedAt: null,
      });

      await expect(h.service.login('a@b.vn', 'MatKhau@12345')).rejects.toThrow(/Invalid/);
    });
  });

  // -------------------------------------------------------------------------
  describe('forgotPassword', () => {
    it('answers identically for a registered and an unregistered address', async () => {
      h.prisma.user.findUnique.mockResolvedValueOnce({
        id: 5,
        email: 'co@b.vn',
        fullName: 'Có tài khoản',
        status: 'ACTIVE',
      });
      h.prisma.passwordResetToken.create.mockResolvedValue({ id: 1 });

      const known = await h.service.forgotPassword({ email: 'co@b.vn' });

      h.prisma.user.findUnique.mockResolvedValueOnce(null);
      const unknown = await h.service.forgotPassword({ email: 'khong@b.vn' });

      // Byte-for-byte identical: no enumeration signal at all.
      expect(JSON.stringify(known)).toBe(JSON.stringify(unknown));
      expect(known.message).toBe(FORGOT_MESSAGE);
      // No mail is sent for an address with no account.
      expect(h.mail.send).toHaveBeenCalledTimes(1);
      expect(h.mail.send.mock.calls[0][0].to).toBe('co@b.vn');
    });

    it('treats a non-ACTIVE account exactly like a missing one', async () => {
      h.prisma.user.findUnique.mockResolvedValue({
        id: 5,
        email: 'khoa@b.vn',
        fullName: 'Bị khoá',
        status: 'LOCKED',
      });

      const result = await h.service.forgotPassword({ email: 'khoa@b.vn' });

      expect(result.message).toBe(FORGOT_MESSAGE);
      expect(h.prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(h.mail.send).not.toHaveBeenCalled();
    });

    it('persists only a SHA-256 hash, never the token from the e-mail', async () => {
      h.prisma.user.findUnique.mockResolvedValue({
        id: 5,
        email: 'co@b.vn',
        fullName: 'Có tài khoản',
        status: 'ACTIVE',
      });
      h.prisma.passwordResetToken.create.mockResolvedValue({ id: 1 });

      await h.service.forgotPassword({ email: 'co@b.vn' });

      const created = h.prisma.passwordResetToken.create.mock.calls[0][0] as {
        data: { tokenHash: string; expiresAt: Date };
      };
      expect(created.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      // The raw token exists ONLY in the mail body. Pull it out and prove the
      // stored value is its hash and not the value itself.
      const body = h.mail.send.mock.calls[0][0].text as string;
      const raw = /token=([0-9a-f]{64})/.exec(body)?.[1];
      expect(raw).toBeDefined();
      expect(created.data.tokenHash).toBe(hashResetToken(raw as string));
      expect(created.data.tokenHash).not.toBe(raw);
    });

    it('points the recovery link at the Customer Web reset page', async () => {
      h.prisma.user.findUnique.mockResolvedValue({
        id: 5,
        email: 'co@b.vn',
        fullName: 'Có tài khoản',
        status: 'ACTIVE',
      });
      h.prisma.passwordResetToken.create.mockResolvedValue({ id: 1 });

      await h.service.forgotPassword({ email: 'co@b.vn' });

      const body = h.mail.send.mock.calls[0][0].text as string;
      expect(body).toContain('http://web.test/dat-lai-mat-khau?token=');
    });

    it('supersedes every earlier unused link', async () => {
      h.prisma.user.findUnique.mockResolvedValue({
        id: 5,
        email: 'co@b.vn',
        fullName: 'Có tài khoản',
        status: 'ACTIVE',
      });
      h.prisma.passwordResetToken.create.mockResolvedValue({ id: 1 });

      await h.service.forgotPassword({ email: 'co@b.vn' });

      // Only the newest link may stay usable.
      expect(h.prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 5, usedAt: null } }),
      );
    });

    it('answers neutrally even when delivery fails (no existence leak)', async () => {
      h.prisma.user.findUnique.mockResolvedValue({
        id: 5,
        email: 'co@b.vn',
        fullName: 'Có tài khoản',
        status: 'ACTIVE',
      });
      h.prisma.passwordResetToken.create.mockResolvedValue({ id: 1 });
      h.mail.send.mockRejectedValue(new Error('SMTP is down'));

      const result = await h.service.forgotPassword({ email: 'co@b.vn' });
      expect(result.message).toBe(FORGOT_MESSAGE);
    });

    it('reports the delivery mode so a test transport is never called delivery', async () => {
      h.prisma.user.findUnique.mockResolvedValue(null);

      h.mail.mode = 'test';
      h.mail.isRealDelivery = false;
      const captured = await h.service.forgotPassword({ email: 'x@b.vn' });
      expect(captured.delivery).toEqual({ mode: 'test', delivered: false });

      h.mail.mode = 'smtp';
      h.mail.isRealDelivery = true;
      const real = await h.service.forgotPassword({ email: 'x@b.vn' });
      expect(real.delivery).toEqual({ mode: 'smtp', delivered: true });
    });

    it('never audits the token or its hash', async () => {
      h.prisma.user.findUnique.mockResolvedValue({
        id: 5,
        email: 'co@b.vn',
        fullName: 'Có tài khoản',
        status: 'ACTIVE',
      });
      h.prisma.passwordResetToken.create.mockResolvedValue({ id: 1 });

      await h.service.forgotPassword({ email: 'co@b.vn' });

      const body = h.mail.send.mock.calls[0][0].text as string;
      const raw = /token=([0-9a-f]{64})/.exec(body)?.[1] as string;
      const audited = JSON.stringify(h.prisma.auditLog.create.mock.calls);
      expect(audited).not.toContain(raw);
      expect(audited).not.toContain(hashResetToken(raw));
    });
  });

  // -------------------------------------------------------------------------
  describe('resetPassword', () => {
    function validRecord() {
      return {
        id: 11,
        userId: 5,
        tokenHash: 'a'.repeat(64),
        usedAt: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        user: { id: 5, status: 'ACTIVE', email: 'co@b.vn', role: 'CUSTOMER' },
      };
    }

    it('sets the new password and consumes the token in one transaction', async () => {
      h.prisma.passwordResetToken.findUnique.mockResolvedValue(validRecord());
      h.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await h.service.resetPassword({
        token: 'a'.repeat(64),
        newPassword: 'MatKhauMoi@12345',
      });

      expect(result.message).toMatch(/đã được đặt lại/);
      // No session is issued: the customer signs in with the new password.
      expect(result).not.toHaveProperty('accessToken');

      const update = h.prisma.user.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(update.data.passwordHash).not.toContain('MatKhauMoi@12345');
      // Stamping the change is what signs out every existing session.
      expect(update.data.passwordChangedAt).toBeInstanceOf(Date);
    });

    it('hashes the submitted token before looking it up', async () => {
      h.prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        h.service.resetPassword({ token: 'raw-token-value', newPassword: 'MatKhauMoi@12345' }),
      ).rejects.toThrow(/không hợp lệ hoặc đã hết hạn/);

      const where = (h.prisma.passwordResetToken.findUnique.mock.calls[0][0] as {
        where: { tokenHash: string };
      }).where;
      // The raw token is never a lookup key: only its hash is stored.
      expect(where.tokenHash).toBe(hashResetToken('raw-token-value'));
      expect(where.tokenHash).not.toBe('raw-token-value');
    });

    it('refuses an unknown, used or expired token with ONE identical error', async () => {
      const cases = [
        null,
        { ...validRecord(), usedAt: new Date() },
        { ...validRecord(), expiresAt: new Date(Date.now() - 1000) },
        { ...validRecord(), user: { ...validRecord().user, status: 'LOCKED' } },
      ];

      for (const record of cases) {
        h.prisma.passwordResetToken.findUnique.mockResolvedValue(record);
        const error = await h.service
          .resetPassword({ token: 'x'.repeat(64), newPassword: 'MatKhauMoi@12345' })
          .catch((e: Error) => e);
        // One message for every failure mode: a caller cannot tell a guessed
        // token from a genuinely expired one.
        expect((error as Error).message).toMatch(/không hợp lệ hoặc đã hết hạn/);
      }
    });

    it('reports a lost claim race as an invalid link, not a server error', async () => {
      h.prisma.passwordResetToken.findUnique.mockResolvedValue(validRecord());
      // Another request consumed the token between the read and the claim.
      h.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        h.service.resetPassword({ token: 'a'.repeat(64), newPassword: 'MatKhauMoi@12345' }),
      ).rejects.toThrow(/không hợp lệ hoặc đã hết hạn/);

      // The losing request must not have written a password.
      expect(h.prisma.user.update).not.toHaveBeenCalled();
    });

    it('voids every other outstanding link for the account', async () => {
      h.prisma.passwordResetToken.findUnique.mockResolvedValue(validRecord());
      h.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

      await h.service.resetPassword({ token: 'a'.repeat(64), newPassword: 'MatKhauMoi@12345' });

      const calls = h.prisma.passwordResetToken.updateMany.mock.calls as Array<
        [{ where: Record<string, unknown> }]
      >;
      // One claim on this exact token, then one sweep over the account's others.
      expect(calls[0][0].where).toEqual({ id: 11, usedAt: null });
      expect(calls[1][0].where).toEqual({ userId: 5, usedAt: null });
    });

    it('never audits the token', async () => {
      h.prisma.passwordResetToken.findUnique.mockResolvedValue(validRecord());
      h.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

      await h.service.resetPassword({ token: 'a'.repeat(64), newPassword: 'MatKhauMoi@12345' });

      const audited = JSON.stringify(h.prisma.auditLog.create.mock.calls);
      expect(audited).not.toContain('a'.repeat(64));
    });
  });

  // -------------------------------------------------------------------------
  describe('changePassword', () => {
    async function currentUser(passwordChangedAt: Date | null = null) {
      return {
        id: 5,
        email: 'a@b.vn',
        role: 'CUSTOMER',
        fullName: 'A',
        phone: '0912345678',
        status: 'ACTIVE',
        passwordHash: await bcryptHash('MatKhauCu@12345'),
        passwordChangedAt,
      };
    }

    it('requires the current password', async () => {
      h.prisma.user.findUnique.mockResolvedValue(await currentUser());

      await expect(
        h.service.changePassword(5, {
          currentPassword: 'SaiMatKhau@1',
          newPassword: 'MatKhauMoi@12345',
        }),
      ).rejects.toThrow(/Mật khẩu hiện tại chưa đúng/);
      expect(h.prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses a new password identical to the current one', async () => {
      h.prisma.user.findUnique.mockResolvedValue(await currentUser());

      await expect(
        h.service.changePassword(5, {
          currentPassword: 'MatKhauCu@12345',
          newPassword: 'MatKhauCu@12345',
        }),
      ).rejects.toThrow(/phải khác mật khẩu hiện tại/);
    });

    it('stamps the change, voids recovery links and returns a fresh token', async () => {
      h.prisma.user.findUnique.mockResolvedValue(await currentUser());
      h.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await h.service.changePassword(5, {
        currentPassword: 'MatKhauCu@12345',
        newPassword: 'MatKhauMoi@12345',
      });

      expect(typeof result.accessToken).toBe('string');

      const update = h.prisma.user.update.mock.calls[0][0] as { data: Record<string, unknown> };
      const changedAt = update.data.passwordChangedAt as Date;
      expect(changedAt).toBeInstanceOf(Date);

      // The fresh token must carry the NEW version, or the device that made the
      // change would sign itself out immediately.
      const payload = (
        (h.service as unknown as { jwt: { signAsync: { mock: { calls: unknown[][] } } } }).jwt
          .signAsync.mock.calls[0][0]
      ) as Record<string, unknown>;
      expect(payload.pwd).toBe(changedAt.getTime());

      // An outstanding recovery link is void once the password is known.
      expect(h.prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 5, usedAt: null } }),
      );
    });

    it('rejects a caller whose account no longer exists', async () => {
      h.prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        h.service.changePassword(5, {
          currentPassword: 'MatKhauCu@12345',
          newPassword: 'MatKhauMoi@12345',
        }),
      ).rejects.toThrow(/no longer exists/);
    });
  });
});

/** bcrypt hash helper, kept local so the spec reads as plain assertions. */
async function bcryptHash(plain: string): Promise<string> {
  const bcrypt = await import('bcryptjs');
  return bcrypt.hash(plain, 10);
}
