import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";
import { readFileSync } from "node:fs";
const db = readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)[1];
const p = new PrismaClient({ adapter: new PrismaMariaDb(db) });
const fsItems = await p.flashSaleItem.findMany({ include: { productVariant: { include: { product: true } } } });
for (const it of fsItems)
  console.log(`fsItem#${it.id} fs#${it.flashSaleId} ${it.productVariant.product.name}/${it.productVariant.name} flashPrice=${it.flashPrice} base=${it.productVariant.basePrice} sold=${it.soldQuantity}/${it.quota}`);
const seasons = await p.season.findMany({ orderBy: { id: "asc" } });
console.log("\nseason keys:", Object.keys(seasons[0]).join(","));
for (const s of seasons)
  console.log(`season#${s.id} name="${s.name}" status=${s.status} crop=${s.cropName ?? ""}`);
await p.$disconnect();
