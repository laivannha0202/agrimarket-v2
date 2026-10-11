-- Session invalidation marker for password changes.
--
-- WHY
--   Access tokens are stateless JWTs: changing a password cannot delete an
--   already-issued token from a session store, because there is no session
--   store. Recording WHEN the password changed lets `JwtStrategy` reject every
--   token issued before that instant — which is what actually terminates the
--   sessions that were open when the password changed, including an attacker's.
--
-- SAFETY
--   Additive and nullable. Existing users get NULL, meaning "never changed", so
--   no token is rejected because of this column until a password is actually
--   changed. Nobody signed in today is logged out by applying this migration.

ALTER TABLE `users`
  ADD COLUMN `password_changed_at` DATETIME(3) NULL;
