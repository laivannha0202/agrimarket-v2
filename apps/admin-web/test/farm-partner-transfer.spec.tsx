import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./utils";
import type { Farm, Paginated, Partner } from "@/types/api";
import { FarmPartnerTransfer } from "@/components/farm/FarmPartnerTransfer";

const authMock = vi.hoisted(() => ({ user: { id: 1, email: "admin@test.vn", role: "ADMIN", fullName: "Admin" } as { id: number; email: string; role: string; fullName: string } | null }));
const resourcesMock = vi.hoisted(() => ({
  partners: vi.fn(),
  transferFarmPartner: vi.fn(),
}));

vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: authMock.user }) }));
vi.mock("@/lib/api/resources", () => ({ resources: resourcesMock }));

const partner = (id: number, status: Partner["status"] = "ACTIVE", verificationStatus: Partner["verificationStatus"] = "VERIFIED"): Partner => ({
  id,
  code: `HTX-${String(id).padStart(3, "0")}`,
  type: "COOPERATIVE",
  name: `HTX ${id}`,
  representativeName: null,
  phone: "0900000000",
  email: null,
  address: null,
  taxCode: null,
  registrationDocumentUrl: null,
  verificationStatus,
  bankAccountName: null,
  bankAccountNumber: null,
  bankName: null,
  status,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const farm = (status: Farm["status"] = "INACTIVE"): Farm => ({
  id: 15,
  code: "FARM-015",
  partnerId: 1,
  partner: { id: 1, code: "HTX-001", name: "HTX 1" },
  name: "Trang trại thử nghiệm",
  address: "Hưng Yên",
  latitude: null,
  longitude: null,
  areaHa: null,
  description: null,
  status,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const eligible = [partner(1), partner(2), partner(3, "INACTIVE"), partner(4, "ACTIVE", "PENDING")];
const paginated = <T,>(data: T[]): Paginated<T> => ({
  data,
  meta: { page: 1, limit: 100, total: data.length, totalPages: 1 },
});

function transferDialog(): HTMLElement {
  return screen.getByText("Chuyển trang trại sang HTX khác").closest(".ant-modal") as HTMLElement;
}

async function openDialog(user = userEvent.setup()) {
  await user.click(screen.getByRole("button", { name: "Chuyển HTX" }));
  return { user, dialog: transferDialog() };
}

async function selectDestinationPartner(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole("combobox", { name: "HTX tiếp nhận" }));
  const option = await waitFor(() => {
    const candidate = document.querySelector(
      ".ant-select-dropdown .ant-select-item-option:not(.ant-select-item-option-disabled)",
    );
    if (!(candidate instanceof HTMLElement)) throw new Error("HTX tiếp nhận chưa xuất hiện.");
    return candidate;
  });
  expect(option.textContent).toContain("HTX-002 — HTX 2");
  await user.click(option);
}

describe("Farm partner transfer", () => {
  beforeEach(() => {
    authMock.user = { id: 1, email: "admin@test.vn", role: "ADMIN", fullName: "Admin" };
    resourcesMock.partners.mockReset().mockResolvedValue(paginated(eligible));
    resourcesMock.transferFarmPartner.mockReset().mockImplementation(async (_id, body) => ({
      ...farm(),
      partnerId: body.newPartnerId,
      partner: { id: 2, code: "HTX-002", name: "HTX 2" },
    }));
  });

  it("shows the transfer action to ADMIN and loads eligible partners through the authenticated admin API", async () => {
    renderWithProviders(<FarmPartnerTransfer farm={farm()} />);
    const { dialog } = await openDialog();

    await waitFor(() => expect(resourcesMock.partners).toHaveBeenCalledWith({
      limit: 100,
      status: "ACTIVE",
      verificationStatus: "VERIFIED",
      page: 1,
    }));
    expect(within(dialog).getByText("HTX hiện tại")).toBeInTheDocument();
    expect(within(dialog).getByText("HTX-001 — HTX 1")).toBeInTheDocument();
  });

  it("does not render the transfer feature for a user without ADMIN permission", () => {
    authMock.user = { id: 2, email: "staff@test.vn", role: "CUSTOMER", fullName: "Staff" };
    renderWithProviders(<FarmPartnerTransfer farm={farm()} />);

    expect(screen.queryByRole("button", { name: "Chuyển HTX" })).not.toBeInTheDocument();
    expect(screen.queryByText("Quản lý HTX")).not.toBeInTheDocument();
  });

  it("blocks ACTIVE farms and explains that they must be changed to INACTIVE first", () => {
    renderWithProviders(<FarmPartnerTransfer farm={farm("ACTIVE")} />);

    expect(screen.getByRole("button", { name: "Chuyển HTX" })).toBeDisabled();
    expect(screen.getByText(/chuyển trạng thái trang trại sang INACTIVE trước/i)).toBeInTheDocument();
    expect(document.querySelector(".ant-modal-wrap")?.getAttribute("style")).toContain("display: none");
    expect(resourcesMock.transferFarmPartner).not.toHaveBeenCalled();
  });

  it("allows selecting only another VERIFIED + ACTIVE partner and requires a reason", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FarmPartnerTransfer farm={farm()} />);
    const { dialog } = await openDialog(user);
    await waitFor(() => expect(resourcesMock.partners).toHaveBeenCalled());

    await user.click(within(dialog).getByRole("combobox", { name: "HTX tiếp nhận" }));
    expect(await screen.findByRole("option", { name: "HTX-002 — HTX 2" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "HTX-001 — HTX 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "HTX-003 — HTX 3" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "HTX-004 — HTX 4" })).not.toBeInTheDocument();

    await user.click(document.querySelector(".ant-select-dropdown .ant-select-item-option:not(.ant-select-item-option-disabled)") as HTMLElement);
    const confirm = within(dialog).getByRole("button", { name: "Xác nhận chuyển" });
    expect(confirm).toBeDisabled();
    expect(resourcesMock.transferFarmPartner).not.toHaveBeenCalled();

    const reasonInput = within(dialog).getByLabelText("Lý do chuyển");
    await user.type(reasonInput, "Điều chỉnh đơn vị quản lý theo thỏa thuận.");
    expect(reasonInput).toHaveValue("Điều chỉnh đơn vị quản lý theo thỏa thuận.");
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await waitFor(() => expect(resourcesMock.transferFarmPartner).toHaveBeenCalledWith(15, {
      newPartnerId: 2,
      reason: "Điều chỉnh đơn vị quản lý theo thỏa thuận.",
    }));
  });

  it("shows a backend business rejection and keeps the dialog open", async () => {
    resourcesMock.transferFarmPartner.mockRejectedValue(
      new Error("Không thể chuyển trang trại đã có sản phẩm, mùa vụ hoặc chứng nhận liên kết."),
    );
    const user = userEvent.setup();
    renderWithProviders(<FarmPartnerTransfer farm={farm()} />);
    const { dialog } = await openDialog(user);
    await waitFor(() => expect(resourcesMock.partners).toHaveBeenCalled());
    await selectDestinationPartner(user, dialog);
    await user.type(within(dialog).getByLabelText("Lý do chuyển"), "Điều chỉnh hợp đồng.");
    await user.click(within(dialog).getByRole("button", { name: "Xác nhận chuyển" }));

    expect(await screen.findByText("Không thể chuyển trang trại đã có sản phẩm, mùa vụ hoặc chứng nhận liên kết.")).toBeInTheDocument();
    expect(transferDialog()).toBeInTheDocument();
  });

  it("updates the displayed cooperative after a successful transfer", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FarmPartnerTransfer farm={farm()} />);
    const { dialog } = await openDialog(user);
    await waitFor(() => expect(resourcesMock.partners).toHaveBeenCalled());
    await selectDestinationPartner(user, dialog);
    await user.type(within(dialog).getByLabelText("Lý do chuyển"), "Điều chỉnh hợp đồng.");
    await user.click(within(dialog).getByRole("button", { name: "Xác nhận chuyển" }));

    await waitFor(() => expect(document.querySelector(".ant-modal-mask")?.className).toContain("ant-fade-leave"));
    const managementCard = screen.getByText("Quản lý HTX").closest(".agri-card") as HTMLElement;
    expect(within(managementCard).getByText("HTX-002 — HTX 2")).toBeInTheDocument();
    expect(within(managementCard).queryByText("HTX-001 — HTX 1")).not.toBeInTheDocument();
  });

  it("prevents duplicate submissions while a transfer request is pending", async () => {
    let resolveTransfer: ((value: Farm) => void) | undefined;
    resourcesMock.transferFarmPartner.mockImplementation(() => new Promise<Farm>((resolve) => {
      resolveTransfer = resolve;
    }));
    const user = userEvent.setup();
    renderWithProviders(<FarmPartnerTransfer farm={farm()} />);
    const { dialog } = await openDialog(user);
    await waitFor(() => expect(resourcesMock.partners).toHaveBeenCalled());
    await selectDestinationPartner(user, dialog);
    await user.type(within(dialog).getByLabelText("Lý do chuyển"), "Điều chỉnh hợp đồng.");

    const confirm = within(dialog).getByRole("button", { name: "Xác nhận chuyển" });
    await user.click(confirm);
    await waitFor(() => expect(resourcesMock.transferFarmPartner).toHaveBeenCalledTimes(1));
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(resourcesMock.transferFarmPartner).toHaveBeenCalledTimes(1);

    resolveTransfer?.({ ...farm(), partnerId: 2, partner: { id: 2, code: "HTX-002", name: "HTX 2" } });
    await waitFor(() => expect(document.querySelector(".ant-modal-mask")?.className).toContain("ant-fade-leave"));
  });
});
