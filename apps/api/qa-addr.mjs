import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";
import { readFileSync } from "node:fs";
const db = readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)[1];
const p = new PrismaClient({ adapter: new PrismaMariaDb(db) });
console.log("wards=", await p.ward.count());
const addrs = await p.address.findMany({ orderBy: { id: "asc" } });
console.log("address keys:", Object.keys(addrs[0]).join(","));
for (const a of addrs)
  console.log(`addr#${a.id} user=${a.customerId ?? a.userId} ward=${a.wardCode ?? a.ward ?? "-"} "${a.line1 ?? a.detail ?? ""}" district=${a.district ?? "-"} province=${a.province ?? "-"}`);
await p.$disconnect();
