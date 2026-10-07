/**
 * AgriMarket V2 seed — natural, fully-linked demo data around Hưng Yên.
 *
 * Dates are relative to "today" so the demo is always valid (sellable lots are
 * not expired, orders sit in the past). Re-runnable: it wipes existing rows in
 * FK-safe order then inserts fresh data.
 *
 * Run with: pnpm --filter @agrimarket/api db:seed
 */
import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '../generated/prisma/client.js';
import {
  CertificateVerificationStatus,
  ComplaintStatus,
  ComplaintType,
  DiscountType,
  FarmingEventType,
  InventoryMovementType,
  OrderStatus,
  PartnerOrderStatus,
  PaymentMethod,
  PaymentStatus,
  PayoutStatus,
  ProductLotStatus,
  QcResult,
  RecordStatus,
  ReviewStatus,
  SeasonStatus,
  SettlementStatus,
  ShipmentStatus,
  TraceEventType,
  UserRole,
  WarehouseDocumentStatus,
  WarehouseDocumentType,
} from '../generated/prisma/enums.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) });

// ---- Date helpers (all relative to today) ---------------------------------
const NOW = new Date();
const TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
const addDays = (n: number) => new Date(TODAY.getTime() + n * 86_400_000);
const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);
const stamp = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

async function wipe() {
  // Delete children before parents (respecting FK order).
  await prisma.auditLog.deleteMany();

  // Settlement / payout chain
  await prisma.settlementLine.deleteMany();
  await prisma.payout.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.commissionRule.deleteMany();

  // Return / refund / review / complaint (all reference order_item)
  await prisma.returnRequest.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.review.deleteMany();
  await prisma.complaint.deleteMany();

  // Payment / shipment / fulfillment / allocation
  await prisma.payment.deleteMany();
  await prisma.shipmentEvent.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.fulfillment.deleteMany();
  await prisma.inventoryAllocation.deleteMany();

  // Order chain
  await prisma.orderItem.deleteMany();
  await prisma.voucherRedemption.deleteMany();
  await prisma.partnerOrder.deleteMany();
  await prisma.order.deleteMany();

  // Cart
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();

  // Promotions
  await prisma.flashSaleItem.deleteMany();
  await prisma.flashSale.deleteMany();
  await prisma.productDiscount.deleteMany();
  await prisma.voucher.deleteMany();

  // Inventory / warehouse
  await prisma.inventoryMovement.deleteMany();
  await prisma.warehouseDocumentLine.deleteMany();
  await prisma.warehouseDocument.deleteMany();
  await prisma.inventoryBalance.deleteMany();
  await prisma.warehouse.deleteMany();

  // Traceability / lots
  await prisma.traceEvent.deleteMany();
  await prisma.qcInspection.deleteMany();
  await prisma.productLot.deleteMany();

  // Farming
  await prisma.harvest.deleteMany();
  await prisma.farmingEvent.deleteMany();
  await prisma.season.deleteMany();
  await prisma.certificate.deleteMany();

  // Catalog
  await prisma.productVariant.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();

  // Partner / farm
  await prisma.farm.deleteMany();
  await prisma.partner.deleteMany();

  // Users
  await prisma.address.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  console.log('Seeding AgriMarket V2 ...');
  await wipe();

  const password = await bcrypt.hash('Agri@12345', 10);
  const adminPassword = await bcrypt.hash('Admin@12345', 10);

  // ---- Users --------------------------------------------------------------
  const admin = await prisma.user.create({
    data: {
      email: 'admin@agrimarket.vn',
      passwordHash: adminPassword,
      fullName: 'Quản trị viên AgriMarket',
      phone: '0900000001',
      role: UserRole.ADMIN,
      status: 'ACTIVE',
    },
  });

  const customerSeeds = [
    { email: 'lan.nguyen@agrimarket.vn', fullName: 'Nguyễn Thị Lan', phone: '0912345601' },
    { email: 'hung.tran@agrimarket.vn', fullName: 'Trần Văn Hùng', phone: '0912345602' },
    { email: 'mai.pham@agrimarket.vn', fullName: 'Phạm Thị Mai', phone: '0912345603' },
    { email: 'duc.le@agrimarket.vn', fullName: 'Lê Minh Đức', phone: '0912345604' },
    { email: 'hoa.vu@agrimarket.vn', fullName: 'Vũ Thanh Hoa', phone: '0912345605' },
  ];
  const customers = [];
  for (const c of customerSeeds) {
    const user = await prisma.user.create({
      data: {
        email: c.email,
        passwordHash: password,
        fullName: c.fullName,
        phone: c.phone,
        role: UserRole.CUSTOMER,
        status: 'ACTIVE',
        customerProfile: { create: { loyaltyPoints: 0 } },
      },
      include: { customerProfile: true },
    });
    customers.push(user);
    await prisma.address.create({
      data: {
        customerId: user.customerProfile!.id,
        recipientName: c.fullName,
        phone: c.phone,
        province: 'Hưng Yên',
        district: 'Văn Lâm',
        ward: 'Tân Quang',
        detail: `Số ${Math.floor(Math.random() * 90) + 1}, đường Nguyễn Văn Linh`,
        isDefault: true,
      },
    });
  }

  // ---- Partners -----------------------------------------------------------
  const minhChau = await prisma.partner.create({
    data: {
      code: 'PARTNER-0001',
      name: 'HTX Rau quả Minh Châu',
      representativeName: 'Nguyễn Văn Minh',
      phone: '0987654321',
      email: 'minhchau@agrimarket.vn',
      address: 'Thôn Đa Hòa, xã Minh Châu, huyện Văn Lâm, Hưng Yên',
      taxCode: '0900123456',
      bankAccountName: 'HTX Rau quả Minh Châu',
      bankAccountNumber: '1029384756',
      bankName: 'Vietcombank - CN Hưng Yên',
      status: RecordStatus.ACTIVE,
    },
  });
  const phuCuong = await prisma.partner.create({
    data: {
      code: 'PARTNER-0002',
      name: 'HTX Nông nghiệp Phú Cường',
      representativeName: 'Trần Văn Cường',
      phone: '0987654322',
      email: 'phucuong@agrimarket.vn',
      address: 'Thôn Phú Thị, xã Phú Cường, huyện Kim Động, Hưng Yên',
      taxCode: '0900654321',
      bankAccountName: 'HTX Nông nghiệp Phú Cường',
      bankAccountNumber: '2019384756',
      bankName: 'Agribank - CN Hưng Yên',
      status: RecordStatus.ACTIVE,
    },
  });
  const songHong = await prisma.partner.create({
    data: {
      code: 'PARTNER-0003',
      name: 'Nông sản Sông Hồng',
      representativeName: 'Lê Thị Hồng',
      phone: '0987654323',
      email: 'songhong@agrimarket.vn',
      address: 'Số 25, phố Bãi Sậy, TP Hưng Yên, tỉnh Hưng Yên',
      taxCode: '0900112233',
      bankAccountName: 'Công ty Nông sản Sông Hồng',
      bankAccountNumber: '3018273645',
      bankName: 'BIDV - CN Hưng Yên',
      status: RecordStatus.ACTIVE,
    },
  });

  // ---- Farms --------------------------------------------------------------
  const farmMinhChau1 = await prisma.farm.create({
    data: {
      code: 'FARM-0001',
      partnerId: minhChau.id,
      name: 'Trang trại Minh Châu 1',
      address: 'Thôn Đa Hòa, xã Minh Châu, huyện Văn Lâm, Hưng Yên',
      latitude: 20.9764,
      longitude: 106.0512,
      areaHa: 3.5,
      description: 'Vùng trồng rau ăn quả theo hướng VietGAP, hệ thống tưới nhỏ giọt.',
      status: RecordStatus.ACTIVE,
    },
  });
  const farmMinhChau2 = await prisma.farm.create({
    data: {
      code: 'FARM-0002',
      partnerId: minhChau.id,
      name: 'Trang trại Minh Châu 2',
      address: 'Thôn Đình Dù, xã Đình Dù, huyện Văn Lâm, Hưng Yên',
      latitude: 20.9821,
      longitude: 106.0587,
      areaHa: 2.2,
      description: 'Khu nhà màng trồng cà chua và dưa leo.',
      status: RecordStatus.ACTIVE,
    },
  });
  const farmPhuCuong = await prisma.farm.create({
    data: {
      code: 'FARM-0003',
      partnerId: phuCuong.id,
      name: 'Cánh đồng Phú Cường',
      address: 'Thôn Phú Thị, xã Phú Cường, huyện Kim Động, Hưng Yên',
      latitude: 20.7412,
      longitude: 106.0321,
      areaHa: 5.0,
      description: 'Cánh đồng lúa và rau màu luân canh.',
      status: RecordStatus.ACTIVE,
    },
  });
  const farmSongHong = await prisma.farm.create({
    data: {
      code: 'FARM-0004',
      partnerId: songHong.id,
      name: 'Vườn cây ăn quả Sông Hồng',
      address: 'Xã Hồng Nam, TP Hưng Yên, tỉnh Hưng Yên',
      latitude: 20.6521,
      longitude: 106.0512,
      areaHa: 4.0,
      description: 'Vườn nhãn và vải thiều lâu năm ven sông Hồng.',
      status: RecordStatus.ACTIVE,
    },
  });

  // ---- Certificates -------------------------------------------------------
  await prisma.certificate.create({
    data: {
      farmId: farmMinhChau1.id,
      type: 'VietGAP',
      certificateCode: 'VG-HY-2026-014',
      issuer: 'Trung tâm Kiểm định và Chứng nhận Hưng Yên',
      issuedAt: addDays(-120),
      expiresAt: addDays(245),
      fileUrl: 'https://cdn.agrimarket.vn/certs/vg-hy-2026-014.pdf',
      verificationStatus: CertificateVerificationStatus.VERIFIED,
      verifiedAt: addDays(-115),
      status: RecordStatus.ACTIVE,
    },
  });
  await prisma.certificate.create({
    data: {
      farmId: farmMinhChau2.id,
      type: 'VietGAP',
      certificateCode: 'VG-HY-2026-027',
      issuer: 'Trung tâm Kiểm định và Chứng nhận Hưng Yên',
      issuedAt: addDays(-95),
      expiresAt: addDays(270),
      verificationStatus: CertificateVerificationStatus.VERIFIED,
      verifiedAt: addDays(-90),
      status: RecordStatus.ACTIVE,
    },
  });
  await prisma.certificate.create({
    data: {
      farmId: farmPhuCuong.id,
      type: 'GlobalGAP',
      certificateCode: 'GG-HY-2025-003',
      issuer: 'Tổ chức Chứng nhận Quốc tế',
      issuedAt: addDays(-400),
      expiresAt: addDays(-30),
      verificationStatus: CertificateVerificationStatus.VERIFIED,
      verifiedAt: addDays(-395),
      status: RecordStatus.ACTIVE,
    },
  });
  await prisma.certificate.create({
    data: {
      farmId: farmSongHong.id,
      type: 'VietGAP',
      certificateCode: 'VG-HY-2026-041',
      issuer: 'Trung tâm Kiểm định và Chứng nhận Hưng Yên',
      issuedAt: addDays(-60),
      expiresAt: addDays(305),
      verificationStatus: CertificateVerificationStatus.PENDING,
      status: RecordStatus.ACTIVE,
    },
  });

  // ---- Categories ---------------------------------------------------------
  const catRauAnLa = await prisma.category.create({
    data: { name: 'Rau ăn lá', slug: 'rau-an-la', status: RecordStatus.ACTIVE },
  });
  const catRauAnQua = await prisma.category.create({
    data: { name: 'Rau ăn quả', slug: 'rau-an-qua', status: RecordStatus.ACTIVE },
  });
  const catCuQua = await prisma.category.create({
    data: { name: 'Củ quả', slug: 'cu-qua', status: RecordStatus.ACTIVE },
  });
  const catTraiCay = await prisma.category.create({
    data: { name: 'Trái cây', slug: 'trai-cay', status: RecordStatus.ACTIVE },
  });
  const catGaoNguCoc = await prisma.category.create({
    data: { name: 'Gạo và ngũ cốc', slug: 'gao-ngu-coc', status: RecordStatus.ACTIVE },
  });

  // ---- Products + variants ------------------------------------------------
  interface VariantSeed {
    sku: string;
    name: string;
    weight: number;
    weightUnit: string;
    saleUnit: string;
    basePrice: number;
  }
  interface ProductSeed {
    partnerId: number;
    categoryId: number;
    farmId?: number;
    name: string;
    slug: string;
    description: string;
    variants: VariantSeed[];
  }

  const productSeeds: ProductSeed[] = [
    {
      partnerId: minhChau.id,
      categoryId: catRauAnQua.id,
      farmId: farmMinhChau2.id,
      name: 'Cà chua bi đỏ',
      slug: 'ca-chua-bi-do',
      description: 'Cà chua bi đỏ trồng trong nhà màng, quả nhỏ ngọt, giàu vitamin C.',
      variants: [
        { sku: 'CCB-500G', name: 'Gói 500 g', weight: 500, weightUnit: 'g', saleUnit: 'gói', basePrice: 32000 },
        { sku: 'CCB-1KG', name: 'Túi 1 kg', weight: 1000, weightUnit: 'g', saleUnit: 'túi', basePrice: 60000 },
      ],
    },
    {
      partnerId: minhChau.id,
      categoryId: catRauAnQua.id,
      farmId: farmMinhChau2.id,
      name: 'Dưa leo baby',
      slug: 'dua-leo-baby',
      description: 'Dưa leo baby giòn ngọt, thích hợp ăn sống và làm salad.',
      variants: [
        { sku: 'DLB-500G', name: 'Gói 500 g', weight: 500, weightUnit: 'g', saleUnit: 'gói', basePrice: 25000 },
      ],
    },
    {
      partnerId: minhChau.id,
      categoryId: catRauAnLa.id,
      farmId: farmMinhChau1.id,
      name: 'Cải ngọt Hưng Yên',
      slug: 'cai-ngot-hung-yen',
      description: 'Cải ngọt non trồng theo hướng VietGAP, lá xanh mướt.',
      variants: [
        { sku: 'CNY-500G', name: 'Bó 500 g', weight: 500, weightUnit: 'g', saleUnit: 'bó', basePrice: 15000 },
      ],
    },
    {
      partnerId: minhChau.id,
      categoryId: catRauAnLa.id,
      farmId: farmMinhChau1.id,
      name: 'Xà lách lô tô',
      slug: 'xa-lach-lo-to',
      description: 'Xà lách lô tô xanh, giòn, dùng cho salad và cuốn.',
      variants: [
        { sku: 'XLL-300G', name: 'Gói 300 g', weight: 300, weightUnit: 'g', saleUnit: 'gói', basePrice: 20000 },
      ],
    },
    {
      partnerId: phuCuong.id,
      categoryId: catCuQua.id,
      farmId: farmPhuCuong.id,
      name: 'Cà rốt Phú Cường',
      slug: 'ca-rot-phu-cuong',
      description: 'Cà rốt đỏ tươi, ngọt tự nhiên, thu hoạch trong ngày.',
      variants: [
        { sku: 'CRP-1KG', name: 'Túi 1 kg', weight: 1000, weightUnit: 'g', saleUnit: 'túi', basePrice: 28000 },
      ],
    },
    {
      partnerId: phuCuong.id,
      categoryId: catCuQua.id,
      farmId: farmPhuCuong.id,
      name: 'Khoai tây Đà Lạt',
      slug: 'khoai-tay-da-lat',
      description: 'Khoai tây vàng ruột, thích hợp chiên và hầm.',
      variants: [
        { sku: 'KTL-1KG', name: 'Túi 1 kg', weight: 1000, weightUnit: 'g', saleUnit: 'túi', basePrice: 35000 },
      ],
    },
    {
      partnerId: phuCuong.id,
      categoryId: catRauAnLa.id,
      farmId: farmPhuCuong.id,
      name: 'Hành lá Phú Cường',
      slug: 'hanh-la-phu-cuong',
      description: 'Hành lá thơm, thu hoạch buổi sáng, giao trong ngày.',
      variants: [
        { sku: 'HLP-200G', name: 'Bó 200 g', weight: 200, weightUnit: 'g', saleUnit: 'bó', basePrice: 10000 },
      ],
    },
    {
      partnerId: phuCuong.id,
      categoryId: catGaoNguCoc.id,
      farmId: farmPhuCuong.id,
      name: 'Gạo nếp cái hoa vàng',
      slug: 'gao-nep-cai-hoa-vang',
      description: 'Gạo nếp cái hoa vàng Hưng Yên, hạt tròn dẻo thơm.',
      variants: [
        { sku: 'GNV-2KG', name: 'Túi 2 kg', weight: 2000, weightUnit: 'g', saleUnit: 'túi', basePrice: 90000 },
        { sku: 'GNV-5KG', name: 'Bao 5 kg', weight: 5000, weightUnit: 'g', saleUnit: 'bao', basePrice: 215000 },
      ],
    },
    {
      partnerId: songHong.id,
      categoryId: catTraiCay.id,
      farmId: farmSongHong.id,
      name: 'Nhãn lồng Hưng Yên',
      slug: 'nhan-long-hung-yen',
      description: 'Nhãn lồng Hưng Yên chính gốc, cùi dày, ngọt đậm.',
      variants: [
        { sku: 'NLH-1KG', name: 'Túi 1 kg', weight: 1000, weightUnit: 'g', saleUnit: 'túi', basePrice: 65000 },
        { sku: 'NLH-3KG', name: 'Hộp 3 kg', weight: 3000, weightUnit: 'g', saleUnit: 'hộp', basePrice: 185000 },
      ],
    },
    {
      partnerId: songHong.id,
      categoryId: catTraiCay.id,
      farmId: farmSongHong.id,
      name: 'Vải thiều Hưng Yên',
      slug: 'vai-thieu-hung-yen',
      description: 'Vải thiều chín đỏ, hạt nhỏ, vị ngọt thanh.',
      variants: [
        { sku: 'VTH-1KG', name: 'Túi 1 kg', weight: 1000, weightUnit: 'g', saleUnit: 'túi', basePrice: 55000 },
      ],
    },
    {
      partnerId: songHong.id,
      categoryId: catTraiCay.id,
      farmId: farmSongHong.id,
      name: 'Chuối tiêu hồng',
      slug: 'chuoi-tieu-hong',
      description: 'Chuối tiêu hồng chín tự nhiên, thơm ngọt.',
      variants: [
        { sku: 'CTH-1KG', name: 'Nải 1 kg', weight: 1000, weightUnit: 'g', saleUnit: 'nải', basePrice: 22000 },
      ],
    },
    {
      partnerId: minhChau.id,
      categoryId: catRauAnQua.id,
      farmId: farmMinhChau2.id,
      name: 'Ớt chuông đỏ',
      slug: 'ot-chuong-do',
      description: 'Ớt chuông đỏ giòn ngọt, nhiều màu sắc cho món xào.',
      variants: [
        { sku: 'OCD-500G', name: 'Gói 500 g', weight: 500, weightUnit: 'g', saleUnit: 'gói', basePrice: 45000 },
      ],
    },
    {
      partnerId: phuCuong.id,
      categoryId: catRauAnLa.id,
      farmId: farmPhuCuong.id,
      name: 'Bắp cải trắng',
      slug: 'bap-cai-trang',
      description: 'Bắp cải trắng cuộn chặt, giòn ngọt.',
      variants: [
        { sku: 'BCT-1KG', name: 'Cây 1 kg', weight: 1000, weightUnit: 'g', saleUnit: 'cây', basePrice: 18000 },
      ],
    },
    {
      partnerId: minhChau.id,
      categoryId: catRauAnLa.id,
      farmId: farmMinhChau1.id,
      name: 'Rau muống hạt',
      slug: 'rau-muong-hat',
      description: 'Rau muống hạt non, thân giòn, xào tỏi rất ngon.',
      variants: [
        { sku: 'RMH-500G', name: 'Bó 500 g', weight: 500, weightUnit: 'g', saleUnit: 'bó', basePrice: 12000 },
      ],
    },
  ];

  const variantBySku: Record<
    string,
    { id: number; productId: number; partnerId: number; categoryId: number }
  > = {};
  const productsBySlug: Record<string, { id: number; partnerId: number; categoryId: number }> = {};

  for (const p of productSeeds) {
    const product = await prisma.product.create({
      data: {
        partnerId: p.partnerId,
        categoryId: p.categoryId,
        farmId: p.farmId,
        name: p.name,
        slug: p.slug,
        description: p.description,
        status: RecordStatus.ACTIVE,
        images: {
          create: [
            { url: `https://cdn.agrimarket.vn/products/${p.slug}-1.jpg`, sortOrder: 0, isPrimary: true },
            { url: `https://cdn.agrimarket.vn/products/${p.slug}-2.jpg`, sortOrder: 1, isPrimary: false },
          ],
        },
      },
    });
    productsBySlug[p.slug] = { id: product.id, partnerId: p.partnerId, categoryId: p.categoryId };
    for (const v of p.variants) {
      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: v.sku,
          name: v.name,
          weight: v.weight,
          weightUnit: v.weightUnit,
          saleUnit: v.saleUnit,
          basePrice: v.basePrice,
          status: RecordStatus.ACTIVE,
        },
      });
      variantBySku[v.sku] = {
        id: variant.id,
        productId: product.id,
        partnerId: p.partnerId,
        categoryId: p.categoryId,
      };
    }
  }

  // ---- Seasons / farming events / harvests --------------------------------
  const seasonTomato = await prisma.season.create({
    data: {
      farmId: farmMinhChau2.id,
      cropName: 'Cà chua bi',
      variety: 'Cà chua bi đỏ F1',
      plantingDate: addDays(-95),
      expectedHarvestDate: addDays(-25),
      expectedYield: 8.5,
      yieldUnit: 'tấn',
      status: SeasonStatus.HARVESTING,
    },
  });
  const seasonCucumber = await prisma.season.create({
    data: {
      farmId: farmMinhChau2.id,
      cropName: 'Dưa leo baby',
      variety: 'Dưa leo Nhật',
      plantingDate: addDays(-80),
      expectedHarvestDate: addDays(-5),
      expectedYield: 6.0,
      yieldUnit: 'tấn',
      status: SeasonStatus.HARVESTING,
    },
  });
  const seasonCai = await prisma.season.create({
    data: {
      farmId: farmMinhChau1.id,
      cropName: 'Cải ngọt',
      variety: 'Cải ngọt địa phương',
      plantingDate: addDays(-60),
      expectedHarvestDate: addDays(-20),
      expectedYield: 4.0,
      yieldUnit: 'tấn',
      status: SeasonStatus.HARVESTING,
    },
  });
  const seasonCarrot = await prisma.season.create({
    data: {
      farmId: farmPhuCuong.id,
      cropName: 'Cà rốt',
      variety: 'Cà rốt đỏ',
      plantingDate: addDays(-110),
      expectedHarvestDate: addDays(-18),
      expectedYield: 12.0,
      yieldUnit: 'tấn',
      status: SeasonStatus.HARVESTING,
    },
  });
  const seasonNhan = await prisma.season.create({
    data: {
      farmId: farmSongHong.id,
      cropName: 'Nhãn lồng',
      variety: 'Nhãn lồng Hưng Yên',
      plantingDate: addDays(-400),
      expectedHarvestDate: addDays(-12),
      expectedYield: 9.0,
      yieldUnit: 'tấn',
      status: SeasonStatus.HARVESTING,
    },
  });
  const seasonXaLach = await prisma.season.create({
    data: {
      farmId: farmMinhChau1.id,
      cropName: 'Xà lách lô tô',
      variety: 'Xà lách lô tô xanh',
      plantingDate: addDays(-45),
      expectedHarvestDate: addDays(-12),
      expectedYield: 2.5,
      yieldUnit: 'tấn',
      status: SeasonStatus.HARVESTING,
    },
  });
  const seasonRauMuong = await prisma.season.create({
    data: {
      farmId: farmMinhChau1.id,
      cropName: 'Rau muống hạt',
      variety: 'Rau muống hạt địa phương',
      plantingDate: addDays(-35),
      expectedHarvestDate: addDays(-8),
      expectedYield: 2.0,
      yieldUnit: 'tấn',
      status: SeasonStatus.HARVESTING,
    },
  });
  const seasonOtChuong = await prisma.season.create({
    data: {
      farmId: farmMinhChau2.id,
      cropName: 'Ớt chuông đỏ',
      variety: 'Ớt chuông đỏ nhà màng',
      plantingDate: addDays(-85),
      expectedHarvestDate: addDays(-10),
      expectedYield: 4.5,
      yieldUnit: 'tấn',
      status: SeasonStatus.HARVESTING,
    },
  });
  const seasonKhoaiTay = await prisma.season.create({
    data: {
      farmId: farmPhuCuong.id,
      cropName: 'Khoai tây',
      variety: 'Khoai tây vàng',
      plantingDate: addDays(-100),
      expectedHarvestDate: addDays(-14),
      expectedYield: 8.0,
      yieldUnit: 'tấn',
      status: SeasonStatus.HARVESTING,
    },
  });
  const seasonHanhLa = await prisma.season.create({
    data: {
      farmId: farmPhuCuong.id,
      cropName: 'Hành lá',
      variety: 'Hành lá địa phương',
      plantingDate: addDays(-40),
      expectedHarvestDate: addDays(-7),
      expectedYield: 1.8,
      yieldUnit: 'tấn',
      status: SeasonStatus.HARVESTING,
    },
  });
  const seasonGaoNep = await prisma.season.create({
    data: {
      farmId: farmPhuCuong.id,
      cropName: 'Lúa nếp cái hoa vàng',
      variety: 'Nếp cái hoa vàng Hưng Yên',
      plantingDate: addDays(-150),
      expectedHarvestDate: addDays(-30),
      expectedYield: 15.0,
      yieldUnit: 'tấn',
      status: SeasonStatus.COMPLETED,
    },
  });
  const seasonBapCai = await prisma.season.create({
    data: {
      farmId: farmPhuCuong.id,
      cropName: 'Bắp cải trắng',
      variety: 'Bắp cải trắng vụ đông',
      plantingDate: addDays(-75),
      expectedHarvestDate: addDays(-15),
      expectedYield: 6.0,
      yieldUnit: 'tấn',
      status: SeasonStatus.HARVESTING,
    },
  });
  const seasonVai = await prisma.season.create({
    data: {
      farmId: farmSongHong.id,
      cropName: 'Vải thiều',
      variety: 'Vải thiều Hưng Yên',
      plantingDate: addDays(-400),
      expectedHarvestDate: addDays(-9),
      expectedYield: 7.0,
      yieldUnit: 'tấn',
      status: SeasonStatus.HARVESTING,
    },
  });
  const seasonChuoi = await prisma.season.create({
    data: {
      farmId: farmSongHong.id,
      cropName: 'Chuối tiêu hồng',
      variety: 'Chuối tiêu hồng',
      plantingDate: addDays(-300),
      expectedHarvestDate: addDays(-8),
      expectedYield: 5.0,
      yieldUnit: 'tấn',
      status: SeasonStatus.HARVESTING,
    },
  });

  const farmingEvents: { seasonId: number; type: FarmingEventType; occurredAt: Date; content: string }[] = [
    { seasonId: seasonTomato.id, type: FarmingEventType.WATERING, occurredAt: addDays(-80), content: 'Tưới nhỏ giọt 30 phút buổi sáng.' },
    { seasonId: seasonTomato.id, type: FarmingEventType.FERTILIZING, occurredAt: addDays(-65), content: 'Bón phân hữu cơ vi sinh định kỳ 2 tuần/lần.' },
    { seasonId: seasonTomato.id, type: FarmingEventType.PEST_CHECK, occurredAt: addDays(-45), content: 'Kiểm tra sâu bệnh, không phát hiện sâu hại.' },
    { seasonId: seasonTomato.id, type: FarmingEventType.CARE, occurredAt: addDays(-30), content: 'Tỉa cành, buộc dây leo cho cây cà chua.' },
    { seasonId: seasonCai.id, type: FarmingEventType.WATERING, occurredAt: addDays(-40), content: 'Tưới phun sương giữ ẩm luống cải.' },
    { seasonId: seasonCarrot.id, type: FarmingEventType.FERTILIZING, occurredAt: addDays(-70), content: 'Bón lót phân chuồng hoai mục.' },
    { seasonId: seasonNhan.id, type: FarmingEventType.CARE, occurredAt: addDays(-50), content: 'Tỉa cành, vệ sinh gốc nhãn sau thu hoạch.' },
  ];
  for (const e of farmingEvents) {
    await prisma.farmingEvent.create({ data: { ...e, isPublic: true } });
  }

  const harvestTomato = await prisma.harvest.create({
    data: {
      seasonId: seasonTomato.id,
      harvestDate: addDays(-18),
      quantity: 1200.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Thu hoạch đợt 1, cà chua đều quả, độ chín vừa.',
    },
  });
  const harvestCucumber = await prisma.harvest.create({
    data: {
      seasonId: seasonCucumber.id,
      harvestDate: addDays(-6),
      quantity: 600.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Dưa leo baby vụ chính.',
    },
  });
  const harvestCai = await prisma.harvest.create({
    data: {
      seasonId: seasonCai.id,
      harvestDate: addDays(-14),
      quantity: 450.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Cải ngọt thu hoạch buổi sáng.',
    },
  });
  const harvestCarrot = await prisma.harvest.create({
    data: {
      seasonId: seasonCarrot.id,
      harvestDate: addDays(-12),
      quantity: 1800.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Cà rốt đỏ, củ đều.',
    },
  });
  const harvestNhan = await prisma.harvest.create({
    data: {
      seasonId: seasonNhan.id,
      harvestDate: addDays(-10),
      quantity: 900.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Nhãn lồng chính vụ.',
    },
  });
  const harvestXaLach = await prisma.harvest.create({
    data: {
      seasonId: seasonXaLach.id,
      harvestDate: addDays(-12),
      quantity: 300.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Xà lách lô tô thu hoạch buổi sáng.',
    },
  });
  const harvestRauMuong = await prisma.harvest.create({
    data: {
      seasonId: seasonRauMuong.id,
      harvestDate: addDays(-8),
      quantity: 260.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Rau muống hạt non.',
    },
  });
  const harvestOtChuong = await prisma.harvest.create({
    data: {
      seasonId: seasonOtChuong.id,
      harvestDate: addDays(-10),
      quantity: 520.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Ớt chuông đỏ nhà màng.',
    },
  });
  const harvestKhoaiTay = await prisma.harvest.create({
    data: {
      seasonId: seasonKhoaiTay.id,
      harvestDate: addDays(-14),
      quantity: 1400.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Khoai tây vàng ruột.',
    },
  });
  const harvestHanhLa = await prisma.harvest.create({
    data: {
      seasonId: seasonHanhLa.id,
      harvestDate: addDays(-7),
      quantity: 220.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Hành lá thu hoạch buổi sáng.',
    },
  });
  const harvestGaoNep = await prisma.harvest.create({
    data: {
      seasonId: seasonGaoNep.id,
      harvestDate: addDays(-30),
      quantity: 3000.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Lúa nếp cái hoa vàng đã phơi sấy, đóng bao.',
    },
  });
  const harvestBapCai = await prisma.harvest.create({
    data: {
      seasonId: seasonBapCai.id,
      harvestDate: addDays(-15),
      quantity: 700.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Bắp cải trắng cuộn chặt.',
    },
  });
  const harvestVai = await prisma.harvest.create({
    data: {
      seasonId: seasonVai.id,
      harvestDate: addDays(-9),
      quantity: 800.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Vải thiều chín đỏ, hạt nhỏ.',
    },
  });
  const harvestChuoi = await prisma.harvest.create({
    data: {
      seasonId: seasonChuoi.id,
      harvestDate: addDays(-8),
      quantity: 600.0,
      unit: 'kg',
      grade: 'Loại 1',
      note: 'Chuối tiêu hồng chín tự nhiên.',
    },
  });

  // ---- Warehouse ----------------------------------------------------------
  const warehouse = await prisma.warehouse.create({
    data: {
      code: 'WH-0001',
      name: 'Kho trung tâm Hưng Yên',
      address: 'KCN Phố Nối A, Văn Lâm, Hưng Yên',
      status: RecordStatus.ACTIVE,
    },
  });

  // ---- Product lots + QC + trace events -----------------------------------
  interface LotSeed {
    seq: number;
    productSlug: string;
    variantSku: string;
    harvestId: number;
    harvestDate: Date;
    quantity: number;
    expiresAt: Date;
    qcPass: boolean;
    status: ProductLotStatus;
  }

  const lotSeeds: LotSeed[] = [
    // Cà chua bi đỏ — two SELLABLE lots with different expiry (FEFO demo) + one rejected
    { seq: 1, productSlug: 'ca-chua-bi-do', variantSku: 'CCB-500G', harvestId: harvestTomato.id, harvestDate: addDays(-18), quantity: 500, expiresAt: addDays(9), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 2, productSlug: 'ca-chua-bi-do', variantSku: 'CCB-500G', harvestId: harvestTomato.id, harvestDate: addDays(-18), quantity: 400, expiresAt: addDays(14), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 3, productSlug: 'ca-chua-bi-do', variantSku: 'CCB-500G', harvestId: harvestTomato.id, harvestDate: addDays(-18), quantity: 300, expiresAt: addDays(-2), qcPass: false, status: ProductLotStatus.REJECTED },
    { seq: 4, productSlug: 'ca-chua-bi-do', variantSku: 'CCB-1KG', harvestId: harvestTomato.id, harvestDate: addDays(-18), quantity: 250, expiresAt: addDays(12), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 5, productSlug: 'dua-leo-baby', variantSku: 'DLB-500G', harvestId: harvestCucumber.id, harvestDate: addDays(-6), quantity: 600, expiresAt: addDays(8), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 6, productSlug: 'cai-ngot-hung-yen', variantSku: 'CNY-500G', harvestId: harvestCai.id, harvestDate: addDays(-14), quantity: 450, expiresAt: addDays(4), qcPass: true, status: ProductLotStatus.SELLABLE },
    // Cà rốt — two SELLABLE lots (FEFO demo)
    { seq: 7, productSlug: 'ca-rot-phu-cuong', variantSku: 'CRP-1KG', harvestId: harvestCarrot.id, harvestDate: addDays(-12), quantity: 1000, expiresAt: addDays(21), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 8, productSlug: 'ca-rot-phu-cuong', variantSku: 'CRP-1KG', harvestId: harvestCarrot.id, harvestDate: addDays(-12), quantity: 800, expiresAt: addDays(25), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 9, productSlug: 'nhan-long-hung-yen', variantSku: 'NLH-1KG', harvestId: harvestNhan.id, harvestDate: addDays(-10), quantity: 900, expiresAt: addDays(12), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 10, productSlug: 'gao-nep-cai-hoa-vang', variantSku: 'GNV-5KG', harvestId: harvestGaoNep.id, harvestDate: addDays(-30), quantity: 600, expiresAt: addDays(180), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 11, productSlug: 'gao-nep-cai-hoa-vang', variantSku: 'GNV-2KG', harvestId: harvestGaoNep.id, harvestDate: addDays(-30), quantity: 400, expiresAt: addDays(180), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 12, productSlug: 'vai-thieu-hung-yen', variantSku: 'VTH-1KG', harvestId: harvestVai.id, harvestDate: addDays(-9), quantity: 700, expiresAt: addDays(6), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 13, productSlug: 'chuoi-tieu-hong', variantSku: 'CTH-1KG', harvestId: harvestChuoi.id, harvestDate: addDays(-8), quantity: 600, expiresAt: addDays(10), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 14, productSlug: 'xa-lach-lo-to', variantSku: 'XLL-300G', harvestId: harvestXaLach.id, harvestDate: addDays(-12), quantity: 300, expiresAt: addDays(5), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 15, productSlug: 'rau-muong-hat', variantSku: 'RMH-500G', harvestId: harvestRauMuong.id, harvestDate: addDays(-8), quantity: 260, expiresAt: addDays(4), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 16, productSlug: 'ot-chuong-do', variantSku: 'OCD-500G', harvestId: harvestOtChuong.id, harvestDate: addDays(-10), quantity: 520, expiresAt: addDays(16), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 17, productSlug: 'khoai-tay-da-lat', variantSku: 'KTL-1KG', harvestId: harvestKhoaiTay.id, harvestDate: addDays(-14), quantity: 1400, expiresAt: addDays(45), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 18, productSlug: 'hanh-la-phu-cuong', variantSku: 'HLP-200G', harvestId: harvestHanhLa.id, harvestDate: addDays(-7), quantity: 220, expiresAt: addDays(5), qcPass: true, status: ProductLotStatus.SELLABLE },
    { seq: 19, productSlug: 'bap-cai-trang', variantSku: 'BCT-1KG', harvestId: harvestBapCai.id, harvestDate: addDays(-15), quantity: 700, expiresAt: addDays(20), qcPass: true, status: ProductLotStatus.SELLABLE },
  ];

  const lotByCode: Record<string, { id: number; traceCode: string; productSlug: string }> = {};

  for (const l of lotSeeds) {
    const product = productsBySlug[l.productSlug];
    const code = `LOT-${stamp(l.harvestDate)}-${String(l.seq).padStart(4, '0')}`;
    const traceCode = `TRC-${String(l.seq).padStart(6, '0')}-${l.productSlug.replace(/-/g, '').slice(0, 5).toUpperCase()}`;
    const packedAt = addHours(l.harvestDate, 8);

    const lot = await prisma.productLot.create({
      data: {
        code,
        traceCode,
        productId: product.id,
        harvestId: l.harvestId,
        quantity: l.quantity,
        unit: 'kg',
        remainingQuantity: l.quantity,
        grade: 'Loại 1',
        packedAt,
        expiresAt: l.expiresAt,
        status: l.status,
      },
    });
    lotByCode[code] = { id: lot.id, traceCode: lot.traceCode, productSlug: l.productSlug };

    await prisma.traceEvent.create({
      data: {
        productLotId: lot.id,
        type: TraceEventType.HARVEST,
        occurredAt: packedAt,
        location: 'Hưng Yên',
        description: `Lô ${code} được đóng gói từ vụ thu hoạch.`,
        isPublic: true,
      },
    });

    const inspectedAt = addHours(packedAt, 1);
    await prisma.qcInspection.create({
      data: {
        productLotId: lot.id,
        inspectorUserId: admin.id,
        result: l.qcPass ? QcResult.PASS : QcResult.FAIL,
        appearancePassed: l.qcPass,
        freshnessPassed: l.qcPass,
        packagingPassed: l.qcPass,
        damagePassed: l.qcPass,
        note: l.qcPass ? 'Đạt tiêu chuẩn chất lượng.' : 'Không đạt: một số quả dập, loại bỏ lô.',
        inspectedAt,
      },
    });

    await prisma.traceEvent.create({
      data: {
        productLotId: lot.id,
        type: TraceEventType.QC,
        occurredAt: inspectedAt,
        location: 'Kho trung tâm Hưng Yên',
        description: l.qcPass ? 'Kiểm định chất lượng đạt (QC PASS).' : 'Kiểm định chất lượng không đạt (QC FAIL).',
        isPublic: true,
      },
    });
  }

  // ---- Warehouse documents + inventory ------------------------------------
  const inboundDoc = await prisma.warehouseDocument.create({
    data: {
      code: `WHD-${stamp(addDays(-17))}-0001`,
      warehouseId: warehouse.id,
      type: WarehouseDocumentType.INBOUND,
      status: WarehouseDocumentStatus.COMPLETED,
      note: 'Nhập kho lô rau củ đợt đầu.',
      createdByUserId: admin.id,
      completedAt: addDays(-17),
    },
  });

  for (const l of lotSeeds) {
    if (l.status !== ProductLotStatus.SELLABLE) continue;
    const lot = lotByCode[`LOT-${stamp(l.harvestDate)}-${String(l.seq).padStart(4, '0')}`];
    const variantId = variantBySku[l.variantSku].id;

    await prisma.warehouseDocumentLine.create({
      data: {
        documentId: inboundDoc.id,
        productLotId: lot.id,
        productVariantId: variantId,
        quantity: l.quantity,
        unit: 'kg',
      },
    });

    await prisma.inventoryBalance.create({
      data: {
        warehouseId: warehouse.id,
        productLotId: lot.id,
        productVariantId: variantId,
        onHand: l.quantity,
        reserved: 0,
        blocked: 0,
        unit: 'kg',
      },
    });

    await prisma.inventoryMovement.create({
      data: {
        warehouseId: warehouse.id,
        productLotId: lot.id,
        productVariantId: variantId,
        type: InventoryMovementType.INBOUND,
        quantityDelta: l.quantity,
        beforeQuantity: 0,
        afterQuantity: l.quantity,
        referenceType: 'WarehouseDocument',
        referenceId: inboundDoc.id,
        note: 'Nhập kho ban đầu.',
        createdByUserId: admin.id,
      },
    });

    await prisma.traceEvent.create({
      data: {
        productLotId: lot.id,
        type: TraceEventType.WAREHOUSE_IN,
        occurredAt: addDays(-17),
        location: 'Kho trung tâm Hưng Yên',
        description: `Nhập kho theo phiếu ${inboundDoc.code}.`,
        isPublic: true,
      },
    });
  }

  // ---- Promotions ---------------------------------------------------------
  await prisma.voucher.create({
    data: {
      code: 'HUNGYEN50K',
      name: 'Giảm 50.000đ cho đơn từ 300.000đ',
      discountType: DiscountType.FIXED,
      discountValue: 50000,
      minOrderAmount: 300000,
      maxDiscount: 50000,
      usageLimit: 500,
      perCustomerLimit: 1,
      usedCount: 0,
      startsAt: addDays(-30),
      endsAt: addDays(60),
      status: RecordStatus.ACTIVE,
    },
  });

  await prisma.productDiscount.create({
    data: {
      productVariantId: variantBySku['NLH-1KG'].id,
      discountType: DiscountType.PERCENT,
      discountValue: 10,
      startsAt: addDays(-30),
      endsAt: addDays(60),
      status: RecordStatus.ACTIVE,
    },
  });

  const flashSale = await prisma.flashSale.create({
    data: {
      name: 'Flash Sale cuối tuần Hưng Yên',
      startsAt: addDays(-30),
      endsAt: addDays(30),
      status: RecordStatus.ACTIVE,
      items: {
        create: [
          { productVariantId: variantBySku['CCB-1KG'].id, flashPrice: 50000, quota: 100, perCustomerLimit: 2 },
          { productVariantId: variantBySku['CRP-1KG'].id, flashPrice: 24000, quota: 200, perCustomerLimit: 3 },
        ],
      },
    },
    include: { items: true },
  });

  // ---- Commission rules ---------------------------------------------------
  await prisma.commissionRule.create({
    data: {
      partnerId: null,
      categoryId: null,
      ratePercent: 5,
      effectiveFrom: addDays(-180),
      status: RecordStatus.ACTIVE,
    },
  });
  await prisma.commissionRule.create({
    data: {
      partnerId: songHong.id,
      categoryId: catTraiCay.id,
      ratePercent: 7,
      effectiveFrom: addDays(-180),
      status: RecordStatus.ACTIVE,
    },
  });

  // ---- Orders (FEFO allocation, partner split, payments) ------------------
  const defaultAddress = {
    recipientName: 'Nguyễn Thị Lan',
    phone: '0912345601',
    province: 'Hưng Yên',
    district: 'Văn Lâm',
    ward: 'Tân Quang',
    detail: 'Số 12, đường Nguyễn Văn Linh',
  };

  interface OrderSeed {
    seq: number;
    dayOffset: number;
    customerIndex: number;
    items: { sku: string; quantity: number }[];
    paymentMethod: PaymentMethod;
    status: OrderStatus;
  }

  const orderSeeds: OrderSeed[] = [
    {
      seq: 1,
      dayOffset: -16,
      customerIndex: 0,
      items: [
        { sku: 'CCB-500G', quantity: 3 },
        { sku: 'CRP-1KG', quantity: 2 },
      ],
      paymentMethod: PaymentMethod.COD,
      status: OrderStatus.DELIVERED,
    },
    {
      seq: 2,
      dayOffset: -15,
      customerIndex: 1,
      items: [{ sku: 'GNV-5KG', quantity: 1 }],
      paymentMethod: PaymentMethod.VNPAY,
      status: OrderStatus.DELIVERED,
    },
    {
      seq: 3,
      dayOffset: -9,
      customerIndex: 2,
      items: [
        { sku: 'NLH-1KG', quantity: 2 },
        { sku: 'CCB-500G', quantity: 2 },
      ],
      paymentMethod: PaymentMethod.COD,
      status: OrderStatus.SHIPPING,
    },
    {
      seq: 4,
      dayOffset: -7,
      customerIndex: 3,
      items: [{ sku: 'DLB-500G', quantity: 4 }],
      paymentMethod: PaymentMethod.COD,
      status: OrderStatus.CONFIRMED,
    },
    {
      seq: 5,
      dayOffset: -5,
      customerIndex: 4,
      items: [
        { sku: 'VTH-1KG', quantity: 3 },
        { sku: 'CTH-1KG', quantity: 2 },
      ],
      paymentMethod: PaymentMethod.VNPAY,
      status: OrderStatus.DELIVERED,
    },
    {
      seq: 6,
      dayOffset: -2,
      customerIndex: 0,
      items: [{ sku: 'CRP-1KG', quantity: 5 }],
      paymentMethod: PaymentMethod.COD,
      status: OrderStatus.PENDING_CONFIRMATION,
    },
  ];

  const createdOrders: {
    id: number;
    code: string;
    customerId: number;
    status: OrderStatus;
    partnerOrders: { id: number; partnerId: number; code: string; subtotal: number; commissionAmount: number; payableAmount: number }[];
  }[] = [];

  for (const seed of orderSeeds) {
    const customer = customers[seed.customerIndex];
    const createdAt = addHours(addDays(seed.dayOffset), 9);

    const lines = [];
    for (const item of seed.items) {
      const variant = variantBySku[item.sku];
      const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
      let unitPrice = Number(v.basePrice);
      if (item.sku === 'CCB-1KG') unitPrice = 50000;
      if (item.sku === 'CRP-1KG') unitPrice = 24000;
      if (item.sku === 'NLH-1KG') unitPrice = Math.round(unitPrice * 0.9);
      lines.push({
        sku: item.sku,
        variantId: variant.id,
        productId: variant.productId,
        partnerId: variant.partnerId,
        categoryId: variant.categoryId,
        quantity: item.quantity,
        unitPrice,
        subtotal: unitPrice * item.quantity,
      });
    }

    const orderSubtotal = lines.reduce((s, l) => s + l.subtotal, 0);
    const shippingFee = 20000;
    const grandTotal = orderSubtotal + shippingFee;
    const orderCode = `ORD-${stamp(createdAt)}-${String(seed.seq).padStart(4, '0')}`;

    const order = await prisma.order.create({
      data: {
        code: orderCode,
        customerId: customer.id,
        shippingAddressSnapshot: defaultAddress,
        subtotal: orderSubtotal,
        discountTotal: 0,
        shippingFee,
        grandTotal,
        status: seed.status,
        createdAt,
        updatedAt: createdAt,
      },
    });

    const byPartner = new Map<number, typeof lines>();
    for (const l of lines) {
      const arr = byPartner.get(l.partnerId) ?? [];
      arr.push(l);
      byPartner.set(l.partnerId, arr);
    }

    let pIdx = 0;
    const partnerOrders: typeof createdOrders[number]['partnerOrders'] = [];
    for (const [partnerId, pLines] of byPartner) {
      pIdx += 1;
      const pSubtotal = pLines.reduce((s, l) => s + l.subtotal, 0);
      const rate = partnerId === songHong.id ? 7 : 5;
      const commissionAmount = Math.round(((pSubtotal * rate) / 100) * 100) / 100;
      const payableAmount = Math.round((pSubtotal - commissionAmount) * 100) / 100;

      const partnerOrder = await prisma.partnerOrder.create({
        data: {
          code: `${orderCode}-P${String(pIdx).padStart(2, '0')}`,
          orderId: order.id,
          partnerId,
          subtotal: pSubtotal,
          discountTotal: 0,
          commissionAmount,
          payableAmount,
          status: seed.status as unknown as PartnerOrderStatus,
          createdAt,
          updatedAt: createdAt,
        },
      });
      partnerOrders.push({
        id: partnerOrder.id,
        partnerId,
        code: partnerOrder.code,
        subtotal: pSubtotal,
        commissionAmount,
        payableAmount,
      });

      for (const l of pLines) {
        const product = await prisma.product.findUniqueOrThrow({ where: { id: l.productId } });
        const orderItem = await prisma.orderItem.create({
          data: {
            partnerOrderId: partnerOrder.id,
            productVariantId: l.variantId,
            productNameSnapshot: product.name,
            skuSnapshot: l.sku,
            unitPriceSnapshot: l.unitPrice,
            quantity: l.quantity,
            subtotal: l.subtotal,
            discountAmount: 0,
          },
        });

        // FEFO allocate from SELLABLE, non-expired balances of this variant.
        const candidateBalances = await prisma.inventoryBalance.findMany({
          where: {
            productVariantId: l.variantId,
            productLot: { status: ProductLotStatus.SELLABLE, expiresAt: { gte: NOW } },
          },
          include: { productLot: true },
          orderBy: { productLot: { expiresAt: 'asc' } },
        });
        let remaining = l.quantity;
        for (const balance of candidateBalances) {
          if (remaining <= 0) break;
          const available = Number(balance.onHand) - Number(balance.reserved) - Number(balance.blocked);
          if (available <= 0) continue;
          const take = Math.min(remaining, available);
          await prisma.inventoryAllocation.create({
            data: {
              orderItemId: orderItem.id,
              inventoryBalanceId: balance.id,
              productLotId: balance.productLotId,
              quantity: take,
            },
          });
          await prisma.inventoryBalance.update({
            where: { id: balance.id },
            data: { reserved: Number(balance.reserved) + take },
          });
          await prisma.productLot.update({
            where: { id: balance.productLotId },
            data: { remainingQuantity: { decrement: take } },
          });
          remaining -= take;
        }
        if (remaining > 0) {
          throw new Error(`Seed: insufficient stock for ${l.sku} in order ${orderCode}`);
        }
      }
    }

    const paymentStatus = seed.status === OrderStatus.DELIVERED ? PaymentStatus.PAID : PaymentStatus.PENDING;
    await prisma.payment.create({
      data: {
        orderId: order.id,
        method: seed.paymentMethod,
        amount: grandTotal,
        status: paymentStatus,
        paidAt: paymentStatus === PaymentStatus.PAID ? createdAt : null,
        transactionReference: paymentStatus === PaymentStatus.PAID ? `TXN-${orderCode}` : null,
        createdAt,
      },
    });

    if (
      ([OrderStatus.SHIPPING, OrderStatus.DELIVERED, OrderStatus.READY_TO_SHIP] as OrderStatus[]).includes(
        seed.status,
      )
    ) {
      let sIdx = 0;
      for (const po of partnerOrders) {
        sIdx += 1;
        const shipment = await prisma.shipment.create({
          data: {
            code: `SHP-${stamp(createdAt)}-${String(seed.seq).padStart(4, '0')}-${String(sIdx).padStart(2, '0')}`,
            partnerOrderId: po.id,
            carrier: 'Giao Hàng Nhanh',
            trackingCode: `GHN${Math.floor(Math.random() * 900000 + 100000)}`,
            status: seed.status === OrderStatus.DELIVERED ? ShipmentStatus.DELIVERED : ShipmentStatus.IN_TRANSIT,
            shippedAt: createdAt,
            deliveredAt: seed.status === OrderStatus.DELIVERED ? addDays(seed.dayOffset + 1) : null,
            createdAt,
          },
        });
        await prisma.shipmentEvent.create({
          data: { shipmentId: shipment.id, status: ShipmentStatus.PENDING, occurredAt: createdAt, note: 'Tạo vận đơn.' },
        });
        await prisma.shipmentEvent.create({
          data: {
            shipmentId: shipment.id,
            status: seed.status === OrderStatus.DELIVERED ? ShipmentStatus.DELIVERED : ShipmentStatus.IN_TRANSIT,
            occurredAt: addDays(seed.dayOffset + 1),
            note: seed.status === OrderStatus.DELIVERED ? 'Giao hàng thành công.' : 'Đang trên đường giao.',
          },
        });
      }
    }

    createdOrders.push({
      id: order.id,
      code: order.code,
      customerId: customer.id,
      status: seed.status,
      partnerOrders,
    });
  }

  // ---- Reviews (only for delivered orders) --------------------------------
  const deliveredOrder = createdOrders[0];
  const firstItem = await prisma.orderItem.findFirst({
    where: { partnerOrder: { orderId: deliveredOrder.id } },
  });
  if (firstItem) {
    await prisma.review.create({
      data: {
        customerId: deliveredOrder.customerId,
        orderItemId: firstItem.id,
        productId: variantBySku['CCB-500G'].productId,
        rating: 5,
        content: 'Cà chua bi tươi ngon, đóng gói cẩn thận, giao hàng nhanh.',
        status: ReviewStatus.APPROVED,
      },
    });
  }
  const deliveredOrder2 = createdOrders[1];
  const secondItem = await prisma.orderItem.findFirst({
    where: { partnerOrder: { orderId: deliveredOrder2.id } },
  });
  if (secondItem) {
    await prisma.review.create({
      data: {
        customerId: deliveredOrder2.customerId,
        orderItemId: secondItem.id,
        productId: variantBySku['GNV-5KG'].productId,
        rating: 4,
        content: 'Gạo nếp dẻo thơm, đóng bao chắc chắn.',
        status: ReviewStatus.APPROVED,
      },
    });
  }

  // ---- Complaint + Return -------------------------------------------------
  const deliveredOrder3 = createdOrders[4];
  const complaintItem = await prisma.orderItem.findFirst({
    where: { partnerOrder: { orderId: deliveredOrder3.id } },
  });
  if (complaintItem) {
    await prisma.complaint.create({
      data: {
        customerId: deliveredOrder3.customerId,
        orderId: deliveredOrder3.id,
        orderItemId: complaintItem.id,
        type: ComplaintType.PRODUCT_QUALITY,
        content: 'Một số quả vải bị dập trong quá trình vận chuyển.',
        status: ComplaintStatus.PROCESSING,
      },
    });
    await prisma.returnRequest.create({
      data: {
        orderId: deliveredOrder3.id,
        orderItemId: complaintItem.id,
        customerId: deliveredOrder3.customerId,
        quantity: 1,
        reason: 'Vải bị dập, yêu cầu đổi trả 1 kg.',
        status: 'REQUESTED',
      },
    });
  }

  // ---- Settlement + Payout ------------------------------------------------
  const minhChauPartnerOrders = createdOrders
    .flatMap((o) => o.partnerOrders)
    .filter((po) => po.partnerId === minhChau.id);
  const gross = minhChauPartnerOrders.reduce((s, po) => s + po.subtotal, 0);
  const commissionTotal = minhChauPartnerOrders.reduce((s, po) => s + po.commissionAmount, 0);
  const payable = Math.round((gross - commissionTotal) * 100) / 100;

  const settlement = await prisma.settlement.create({
    data: {
      code: 'SET-0001',
      partnerId: minhChau.id,
      periodStart: addDays(-30),
      periodEnd: TODAY,
      grossAmount: gross,
      refundAmount: 0,
      commissionAmount: commissionTotal,
      adjustmentAmount: 0,
      payableAmount: payable,
      status: SettlementStatus.CONFIRMED,
      confirmedAt: addDays(-1),
      lines: {
        create: minhChauPartnerOrders.map((po) => ({
          partnerOrderId: po.id,
          grossAmount: po.subtotal,
          refundAmount: 0,
          commissionAmount: po.commissionAmount,
          payableAmount: po.payableAmount,
        })),
      },
    },
  });

  await prisma.payout.create({
    data: {
      code: `PAY-${stamp(addDays(-1))}-0001`,
      settlementId: settlement.id,
      partnerId: minhChau.id,
      amount: payable,
      status: PayoutStatus.PENDING,
      requestedAt: addDays(-1),
    },
  });

  const traceLot = lotByCode[`LOT-${stamp(addDays(-18))}-0001`];
  console.log('Seed complete.');
  console.log('  Admin:     admin@agrimarket.vn / Admin@12345');
  console.log('  Customer:  lan.nguyen@agrimarket.vn / Agri@12345');
  console.log(`  Trace:     GET /api/v1/trace/${traceLot.traceCode}`);
  console.log(`  FlashSale: ${flashSale.name} (${flashSale.items.length} items)`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
