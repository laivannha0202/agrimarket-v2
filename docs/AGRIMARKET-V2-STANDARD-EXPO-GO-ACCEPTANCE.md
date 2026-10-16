# AgriMarket V2 — Standard Expo Go Acceptance (2026-10-13)

`CODE/BUNDLE VERIFIED — REAL DEVICE PENDING` (khong co dien thoai that trong moi truong nay, khong ghi PASS thiet bi).

Muc tieu: nguoi dung chi can `npm run dev:api` + `npm run dev:mobile` (hoac `npm run dev:lan --workspace @agrimarket/mobile`),
quet QR bang Expo Go chinh thuc, mo duoc AgriMarket V2, tai duoc danh muc / san pham / anh / API khac.
Khong EAS, khong APK, khong development build. Khong phu thuoc custom launcher o luong mac dinh.

---

## 1. Nguyen nhan man hinh xanh ("Something went wrong")

Ket luan: **loi ket noi Metro (QR sai subnet), KHONG phai crash JavaScript hien tai, KHONG phai Backend API.**

### 1.1. QR Metro tro sai subnet so voi API (nguyen nhan chinh, tai hien)

- QR duoc bao cao: `exp://10.211.223.240:8081`.
- `apps/mobile/.env` (dung): `EXPO_PUBLIC_API_BASE_URL=http://10.218.208.43:3000/api/v1`.
- May co 2 IPv4 dung duoc (xac minh bang `Get-NetIPConfiguration`, 2026-10-13):

| Interface | Description | IP | Gateway | Profile |
|---|---|---|---|---|
| Ethernet 7 | SAMSUNG Mobile USB Remote NDIS | `10.211.223.240/24` | `10.211.223.99` | Public (0) |
| Wi-Fi | Intel Wireless-AC 9260 | `10.218.208.43/24` | `10.218.208.144` | Private (1) |
| vgate0 | Rust Wintun Tunnel | `172.30.255.71` | — | Public (loai tru) |
| Cac interface con lai | APIPA `169.254.x.x` | — | — | loai tru |

- Expo CLI chon IP cho QR bang `lan-network` (`@expo/cli/build/src/utils/ip.js` → `getGatewayAsync()`),
  uu tien **outbound-route** (interface co default route ra Internet).
  Tren may nay outbound la `Ethernet 7 = 10.211.223.240` (USB tethering co metric thap hon Wi-Fi).
  `node scripts/lan/diagnose.mjs` tai hien chinh xac:

```text
LAN IP: 10.211.223.240 (iface Ethernet 7, method outbound-route)
WARN: also present: Wi-Fi=10.218.208.43 (selected outbound 10.211.223.240; ...)
```

- Dien thoai o Wi-Fi `10.218.208.x` **khong the toi** `10.211.223.240` (khac subnet, khac vat ly: USB-tethering vs Wi-Fi).
  Expo Go quet QR → khong tai duoc bundle JS → hien "Something went wrong".
  Day la **loi Metro connectivity (status-0 class)**, khong phai loi Backend, khong phai loi JS.
- Metro bind `:::8081` (all interfaces) nen ca 3 URL deu `200 packager-status:running`
  (`127.0.0.1:8081`, `10.218.208.43:8081`, `10.211.223.240:8081` — da kiem that).
  Van de khong phai "Metro chet", ma la "QR in sai dia chi ma dien thoai can".

### 1.2. Backend API loai tru (khoe)

- `GET /api/v1/health` (localhost + LAN `10.218.208.43`): `200 {"status":"ok","service":"agrimarket-api","database":"up"}`.
- `GET /api/v1/categories?limit=1`: `200` (`Rau an la` id 11, total 5).
- `GET /api/v1/products?page=1&limit=1`: `200` (`Rau muong hat` id 42, total 14).
- `GET /docs`: `200`. `GET /products/42`: `200`, 1 anh `http://localhost:3000/uploads/...webp`.
- `HEAD http://10.218.208.43:3000/uploads/products/3f2db25c-….webp`: `200 image/webp`.
- Neu app mo duoc bundle ma khong tai duoc du lieu, UI hien dung thong diep
  "Khong ket noi duoc may chu" (`ApiError status=0`) hoac `ApiConfigNotice` — khong phai man hinh xanh.

### 1.3. JavaScript crash loai tru (code hien tai sach)

Lich su `.expo/dev/logs/start.log` (3200 dong) co 4 loi CU, tat ca da duoc sua truoc phien nay:

| Log cu (that bai bundle) | File hien tai | Trang thai |
|---|---|---|
| `returns.tsx: Adjacent JSX elements (326:4)` | `app/returns.tsx` nay 175 dong, 1 `ScrollView` goc duy nhat | FIXED |
| `complaints.tsx: Unexpected token (283:6)` + `Expected closing </> (306:6)` | `app/complaints.tsx` nay 174 dong, cau truc hop le | FIXED |
| `account.tsx: ReferenceError editing is not defined (117:11)` | `app/(tabs)/account.tsx` khong con bien `editing` (link sang `/profile-edit`) | FIXED |
| `my-reviews.tsx: ReferenceError TOUCH is not defined (380:16)` | `app/my-reviews.tsx` nay 173 dong, khong dung `TOUCH` (chi `colors, spacing`) | FIXED |

Bang chung hien tai:

- `tsc --noEmit`: PASS (exit 0, khong loi).
- `eslint .`: PASS (0 error 0 warning).
- `vitest run`: **174/174 (18 files) PASS**.
- `expo export --platform android --clear`: **PASS, 1460 modules**, bundle `entry-*.hbc (3.7MB)`,
  khong `TransformError` nao (thu muc export tam da xoa sau kiem tra).
- Khong co import/native module gay crash o khoi dong: root layout chi dung
  `expo-router`, `expo-status-bar`, `safe-area-context`, `AppProviders` (react-query + session),
  `ApiConfigNotice`, `OfflineBanner`. `expo-camera` chi import trong `app/scan.tsx`
  (lazy theo route, khong chay o Home). `expo-secure-store` co fallback web-stub dung dan.
- Khong co cau hinh development build ngoai y muon (`app.json` giu `expo-router`,
  `expo-secure-store`, `expo-camera` — tat ca Expo Go ho tro).

> Phan biet: neu Bundle that bai, Metro log se co `metro:bundling:failed` + Expo Go hien
> TransformError cu the. Phien Metro hien tai (PID 20520, tu 09:16) khong co failure moi nao
> sau khi code da sua; cac failure trong log deu la timestamp cu truoc khi sua.

---

## 2. Tuong thich Expo Go + SDK

| Thanh phan | Phien ban | Ket qua |
|---|---|---|
| `expo` | `57.0.27` → **`~57.0.28`** (patch fix trong phien) | `expo install --check`: PASS ("Dependencies are up to date") |
| `expo-router` | `57.0.25` → **`~57.0.26`** (patch fix trong phien) | cung lenh tren |
| `expo-doctor` (`npx --yes expo-doctor --verbose`) | 1.20.4 | **21/21 PASS** (truoc fix: 20/21, thieu 2 patch) |
| `react` | `19.2.3` | dung SDK 57 |
| `react-native` | `0.86.3` | dung SDK 57 (fix Hermes startup tu `expo@57.0.17`) |
| `node` | `v24.21.0` | SDK 57 yeu cau >= 20 — OK |
| `pnpm` | `12.9.1` | dung `packageManager` |
| Native modules (`expo-camera`, `expo-secure-store`, `expo-font`, `expo-image-picker`, `expo-image-manipulator`, `expo-linking`, `expo-constants`, `expo-status-bar`, `netinfo`, `safe-area-context`, `screens`) | `~57.0.x` / tuong thich | doctor `Validate packages against RN Directory`: PASS, khong module ngoai Expo Go |
| Entrypoint | `expo-router/entry` (`package.json:main`) | giu nguyen, Metro bundle dung entry nay |
| `app.json` | `expo-router` + `expo-secure-store` + `expo-camera` plugins | giu nguyen, khong them dev-client |
| Expo Go Android ho tro SDK 57 | `Expo-Go-57.0.9` ton tai (`npx expo-go versions android --stable --json`) | **SDK 57 duoc ho tro** |

Canh bao quan trong (tu docs Expo 2026-09):

- Expo Go moi SDK chi chua **1 SDK**. Project SDK 57 doi hoi Expo Go SDK 57.
- Ban **CH Play co the tre** (hoac da nhay len SDK 58: `Expo-Go-58.0.2` da phat hanh).
  Neu dien thoai dang cai Expo Go SDK 54/56/58 se bao
  "Project is incompatible with this version of Expo Go" — do la loi phien ban, khong phai loi code.
- Cach lay dung ban: `expo.dev/go?sdkVersion=57&platform=android` hoac
  `npx expo-go download android 57`. Sau khi cai dung ban, restart dev server va mo lai.
- Khong nang SDK len 58 trong phien nay (ngoai pham vi, tranh major upgrade khong phep).

---

## 3. File da sua (truoc / sau)

Chi 3 file (2 do `expo install --fix` + lockfile, 1 auto-append cua pnpm). Khong sua source, khong sua UI.

### 3.1. `apps/mobile/package.json`

```diff
-    "expo": "~57.0.27",
+    "expo": "~57.0.28",
-    "expo-router": "~57.0.25",
+    "expo-router": "~57.0.26",
```

Ly do: `expo-doctor` + `expo install --check` yeu cau patch nay (bang chung section 2).
Khong nang major, khong xoa dependency hang loat.

### 3.2. `pnpm-lock.yaml` (285 dong thay doi)

Regenerate boi `expo install --fix --pnpm` (expo 57.0.28 + expo-router 57.0.26 + phu thuoc).
Khong sua tay.

### 3.3. `pnpm-workspace.yaml` (+13 dong, pnpm tu them khi install)

```yaml
minimumReleaseAgeExclude:
  - '@expo/cli@57.0.29'
  - '@expo/fingerprint@0.20.14'
  - '@expo/inline-modules@0.1.8'
  - '@expo/local-build-cache-provider@57.0.9'
  - '@expo/prebuild-config@57.0.18'
  - babel-preset-expo@57.0.15
  - expo-modules-autolinking@57.0.15
  - expo-modules-core@57.0.22
  - expo-modules-jsi@57.1.2
  - expo@57.0.28
  - '@expo/ui@57.0.23'
  - expo-router@57.0.26
```

Day la co che `minimumReleaseAge` cua pnpm (cho phep cac ban vua phat hanh).
Giu nguyen, khong xoa.

### 3.4. Khong sua (bao toan)

- Toan bo `apps/mobile/src`, `apps/mobile/app`, `app.json`, `babel.config.js`, `tsconfig.json`.
- `apps/mobile/.env` (git-ignored) giu `EXPO_PUBLIC_API_BASE_URL=http://10.218.208.43:3000/api/v1`
  (IP Wi-Fi dung, khong doi).
- `apps/api/.env` (git-ignored) giu `PORT=3000`, `CORS_ORIGIN` gom `localhost:3001/3002/8081/8082`
  + `10.218.208.43:8081/8082` (Expo Go native khong can CORS; chi Expo Web can).
- `scripts/lan/*` (demo-mobile/demo-all/diagnose/lib) giu nguyen, **tach khoi luong mac dinh**
  (chi la cong cu optional, khong thay Expo CLI). Khong xoa file nao.
- Khong hardcode IP trong TypeScript (grep `app/` khong co IP nao; IP mau chi trong `__tests__`).
- Khong tao API client moi (`api-client.ts` + `config.ts` da dung, giu nguyen).
- Khong tao file cau hinh trung lap. Khong doi icon/mau/chuc nang.
- `apps/api/s.name` (0 bytes untracked, co tu truoc) — khong dong vao.
- Khong reseed/drop DEV, khong doi database, khong commit/push.

---

## 4. Cau hinh truoc / sau (tom tat)

| | Truoc | Sau |
|---|---|---|
| Expo patch | `expo 57.0.27`, `expo-router 57.0.25` (doctor 20/21) | `expo ~57.0.28`, `expo-router ~57.0.26` (doctor **21/21**) |
| Metro QR | `exp://10.211.223.240:8081` (outbound USB-tethering, dien thoai Wi-Fi khong toi) | Van Metro do, nhung **luong chuan buoc hostname Wi-Fi** (section 5) de QR thanh `10.218.208.43:8081` |
| API URL (mobile) | `http://10.218.208.43:3000/api/v1` (dung) | Giu nguyen |
| Bundle Android | Lich su co TransformError (file cu) | `expo export --platform android`: **1460 modules PASS**, khong loi syntax |
| Custom launcher | Ton tai `demo-mobile.mjs` | Giu file, nhung luong mac dinh la Expo CLI chinh thuc (section 5) |

---

## 5. Lenh khoi chay chinh thuc (Standard Expo Go Workflow)

Tu thu muc goc repo, mo 2 terminal (khong dung custom launcher cho luong mac dinh):

```powershell
# Terminal 1 — Backend (rieng biet)
npm run dev:api

# Terminal 2 — Mobile, GHIM Metro QR vao IP Wi-Fi ma dien thoai thay duoc.
# REACT_NATIVE_PACKAGER_HOSTNAME la bien CHINH THUC cua Expo CLI
# (UrlCreator.js: getDefaultHostname uu tien bien nay truoc gateway tu dong).
# Khong phai custom launcher, khong thay the Expo CLI.
$env:REACT_NATIVE_PACKAGER_HOSTNAME = "10.218.208.43"
npm run dev:mobile
# hoac: npm run dev:lan --workspace @agrimarket/mobile
```

Giai thich:

- `npm run dev:mobile` = `expo start` (mac dinh `--lan` theo `expo start --help`).
  Khong can `demo-lan.mjs` de chay.
- Neu khong set `REACT_NATIVE_PACKAGER_HOSTNAME`, Expo tu chon outbound IP
  (`10.211.223.240`, sai subnet Wi-Fi) — dung nhu loi QR da bao cao.
  Set bien nay la cach chinh thuc de co dinh QR ve `exp://10.218.208.43:8081`.
- Neu doi Wi-Fi: xem IP moi (`ipconfig` → IPv4 Wi-Fi), sua **1 dong duy nhat**
  `EXPO_PUBLIC_API_BASE_URL` trong `apps/mobile/.env`, set lai bien hostname,
  restart Expo (bundle khong tu nhan IP moi).
- Tunnel chi khi LAN bi chan: `npm run dev:tunnel --workspace @agrimarket/mobile`
  (tunnel chi cho Metro; API URL van phai la LAN).
- Tuyet doi khong `localhost` trong `.env` (localhost tren dien thoai la chinh no).
- Khong tro Mobile vao TEST API (`:3100`) khi chay demo DEV (`:3000`).

Kiem tra nhanh sau khi chay:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health
Invoke-RestMethod http://10.218.208.43:3000/api/v1/health
Invoke-WebRequest http://127.0.0.1:8081/status
```

---

## 6. Logs va ket qua kiem thu (chay that 2026-10-13)

| Kiem tra | Lenh | Exit | Ket qua |
|---|---|---|---|
| Expo Doctor | `npx --yes expo-doctor --verbose` (trong `apps/mobile`) | fail→pass* | Truoc fix: 20/21 (thieu 2 patch). Sau `expo install --fix`: **21/21 PASS** |
| Expo dependency check | `npx --yes expo install --check` | — | Truoc: doi `expo ~57.0.28`, `expo-router ~57.0.26`. Sau: **"Dependencies are up to date"** |
| Mobile typecheck | `tsc --noEmit` | 0 | **PASS** |
| Mobile lint | `eslint .` | 0 | **PASS (0 error 0 warning)** |
| Mobile unit tests | `vitest run` | 0 | **174/174 (18 files) PASS** |
| LAN lib tests | `node scripts/lan/lib.test.mjs` | 0 | **12/12 PASS** |
| Metro Android bundle | `expo export --platform android --clear` (tam, da xoa) | 0 | **PASS, 1460 modules, entry-*.hbc 3.7MB**, khong TransformError |
| API health (localhost) | `GET /api/v1/health` | 200 | `{"status":"ok","service":"agrimarket-api","database":"up"}` |
| API health (LAN Wi-Fi) | `GET http://10.218.208.43:3000/api/v1/health` | 200 | nhu tren |
| Categories (LAN) | `GET /api/v1/categories?limit=1` | 200 | `Rau an la` id 11, total 5 |
| Products (LAN) | `GET /api/v1/products?page=1&limit=1` | 200 | `Rau muong hat` id 42, total 14 |
| Product detail | `GET /api/v1/products/42` | 200 | 1 anh `http://localhost:3000/uploads/...webp` |
| Image LAN | `HEAD http://10.218.208.43:3000/uploads/...webp` | 200 | `image/webp`, 20614 bytes |
| Swagger | `GET /docs` | 200 | PASS |
| Metro LAN accessibility | `GET http://127.0.0.1:8081/status` + `http://10.218.208.43:8081/status` + `http://10.211.223.240:8081/status` | 200 | `packager-status:running` ca 3 (Metro song, QR sai dia chi) |
| Integration read-only | `tsx ./scripts/integration.ts` (BASE=`10.218.208.43:3000/api/v1`) | 0 | **7/7 PASS** (categories, products, product-id, farms, trace `TRC-000019-BAPCA`, vouchers, flash-sales; write SKIP, khong ghi DEV) |
| API typecheck/test | (ke thua tu bao cao LAN truoc, khong chay lai de tranh cham) | — | Tham khao `AGRIMARKET-V2-STABLE-LAN-EXPO-ACCEPTANCE.md` §10 (407/407 API tests) |

\* `expo-doctor` tra exit != 0 khi co check fail (hanh vi chuan); sau fix exit 0 tuong duong.

Chi tiet Expo Go phien ban (kiem that):

```json
{"versions":[
  {"sdkVersion":58,"version":"58.0.2"},
  {"sdkVersion":57,"version":"57.0.9"},
  {"sdkVersion":56,"version":"56.0.4"}
]}
```

(`npx expo-go versions android --stable --limit 5 --json` — SDK 57 co ban Android.)

---

## 7. Trang thai thuc te tren dien thoai

**NOT TESTED — khong co thiet bi that trong moi truong nay. Khong ghi PASS thiet bi.**

Handoff (~5 phut, dien thoai + PC cung Wi-Fi `10.218.208.x`, tat 5G):

1. Cai Expo Go **SDK 57** (`Expo-Go-57.0.9` tu `expo.dev/go?sdkVersion=57&platform=android`).
   Mo Expo Go → Settings → xac nhan Supported SDK 57.
2. Terminal 1: `npm run dev:api` (doi healthy).
3. Terminal 2:
   `$env:REACT_NATIVE_PACKAGER_HOSTNAME = "10.218.208.43"; npm run dev:mobile`.
   Xac nhan QR hien `exp://10.218.208.43:8081` (khong phai `10.211.223.240`).
4. Expo Go → quet QR → cho bundle (lan dau ~20s) → Reload neu can.
5. Kiem tra: Trang chu → Danh muc → San pham noi bat → anh san pham →
   chi tiet → Farms → Trace `TRC-000019-BAPCA` → Dang nhap
   (`lan.nguyen@agrimarket.vn` / `Agri@12345`, chi khi duoc phep).

Khong bia ket qua thiet bi that. Chi ghi PASS khi co bang chung Expo Go mo app thanh cong.

---

## 8. Van de con lai

1. **Can dien thoai that** de dong verdict cuoi (§7).
2. Metro dang chay (PID 20520, tu 09:16, truoc patch fix) phuc vu bundle tu `expo 57.0.27`.
   Sau patch can **restart Metro voi `--clear`** o lan chay tieu chuan tiep theo
   (tranh bundle cu + `minimumReleaseAgeExclude` moi).
3. May co 2 default route metric 0 (`Ethernet 7` + `Wi-Fi`). Mien la USB-tethering cam,
   moi lan `expo start` khong ghim hostname se lai ra QR `10.211.223.240`.
   Giai phap lau dai: luon dung `REACT_NATIVE_PACKAGER_HOSTNAME` (section 5);
   khong sua code discovery (do la cong cu optional, khong phai luong chuan).
4. `apps/api/.env` thieu cac bien mau `PUBLIC_API_BASE_URL/UPLOADS_DIR/...` so voi `.env.example`
   (API dung default request-derived URL). Khong bo sung khi dang chay on (de khi ranh).
5. `apps/api/s.name` (0 bytes untracked) ton tai tu truoc — can chu repo xac nhan/xoa.
6. TEST API `:3100` sot tu dot write-flow (ngoai pham vi, khong kill).
7. CH Play Expo Go co the khong phai SDK 57 (tre hoac da len 58) — phai cai tu `expo.dev/go`.

---

## 9. Git status (cuoi phien, khong commit/push)

- Branch `main`, HEAD `8ded192` (khong doi).
- Modified: `apps/mobile/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` (§3).
- Untracked: `apps/api/s.name` (co tu truoc, khong dong vao).
- Khong reset/clean/stash. Khong pha diff Admin/Warehouse (da commit o `8ded192`).
- Khong reseed/drop DEV, khong sua DB, khong ghi du lieu DEV (integration write SKIP).

---

## Verdict

**CODE/BUNDLE VERIFIED — REAL DEVICE PENDING.**

- Nguyen nhan man hinh xanh la QR Metro sai subnet (`10.211.223.240` thay vi Wi-Fi
  `10.218.208.43`), khong phai crash JS hien tai, khong phai Backend.
- Patch SDK 57 (`expo 57.0.28`, `expo-router 57.0.26`) dua doctor tu 20/21 len **21/21**,
  bundle Android **1460 modules PASS**, regression xanh (typecheck/lint/174 unit/integration 7/7).
- Luong chuan khong can custom launcher: `npm run dev:api` + ghim hostname Wi-Fi + `npm run dev:mobile`.
- Chua xac minh bang dien thoai that nen **khong ghi PASS toan bo**.
