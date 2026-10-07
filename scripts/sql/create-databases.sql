-- AgriMarket V2 — create databases (MySQL 8.4, utf8mb4)
-- Run as a user with CREATE DATABASE privileges, e.g.:
--   mysql -u root -p < scripts/sql/create-databases.sql
--
-- After creating the databases, point DATABASE_URL / TEST_DATABASE_URL in
-- apps/api/.env at them, then run:
--   pnpm --filter @agrimarket/api db:migrate
--   pnpm --filter @agrimarket/api db:seed

CREATE DATABASE IF NOT EXISTS `agrimarket_v2`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS `agrimarket_v2_test`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
