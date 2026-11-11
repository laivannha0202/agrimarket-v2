import { useEffect } from "react";
import { App, Button, Form, type FormInstance } from "antd";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FarmFormFields } from "@/components/farm/FarmFormFields";
import { useAction } from "@/hooks/useAction";
import { renderWithProviders } from "./utils";
import type { Partner } from "@/types/api";

const resourcesMock = vi.hoisted(() => ({
  createFarm: vi.fn(),
}));
const fetchMock = vi.fn<typeof fetch>();

vi.mock("@/lib/api/resources", () => ({ resources: resourcesMock }));

function partner(
  id: number,
  status: Partner["status"],
  verificationStatus: Partner["verificationStatus"],
): Partner {
  return {
    id,
    code: `PARTNER-${String(id).padStart(4, "0")}`,
    type: "COOPERATIVE",
    name: `HTX ${id}`,
    representativeName: null,
    phone: "0900000000",
    email: null,
    address: null,
    taxCode: "PRIVATE-TAX-CODE",
    registrationDocumentUrl: null,
    verificationStatus,
    bankAccountName: "PRIVATE BANK NAME",
    bankAccountNumber: "PRIVATE BANK NUMBER",
    bankName: "PRIVATE BANK",
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function publicPartner(value: Partner) {
  return {
    id: value.id,
    code: value.code,
    name: value.name,
    representativeName: null,
    phone: "0900000000",
    email: null,
    address: null,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function publicPage(data: Partner[], pageNumber = 1, totalPages = 1): Response {
  return new Response(
    JSON.stringify({
      data: data.map(publicPartner),
      meta: { page: pageNumber, limit: 100, total: data.length, totalPages },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

let activeForm: FormInstance | undefined;

function FarmFormHarness({ status = "ACTIVE" }: { status?: string }) {
  const [form] = Form.useForm();
  useEffect(() => {
    activeForm = form;
    return () => {
      if (activeForm === form) activeForm = undefined;
    };
  }, [form]);
  useEffect(() => {
    if (status !== "ACTIVE") form.setFieldValue("status", status);
  }, [form, status]);
  return (
    <Form form={form} layout="vertical" initialValues={{ name: "Trang trại thử", address: "Hưng Yên", partnerId: 1 }}>
      <FarmFormFields />
    </Form>
  );
}

function FarmSaveHarness() {
  const [form] = Form.useForm();
  const save = useAction(() => resourcesMock.createFarm(), {});
  useEffect(() => {
    activeForm = form;
    return () => {
      if (activeForm === form) activeForm = undefined;
    };
  }, [form]);
  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ partnerId: 1, name: "Trang trại thử", address: "Hưng Yên" }}
      onFinish={() => save.mutate()}
    >
      <FarmFormFields />
      <Button htmlType="submit">Lưu hồ sơ</Button>
    </Form>
  );
}

function partnerSelector(): HTMLElement {
  const item = screen.getByText("Đối tác").closest(".ant-form-item");
  if (!item) throw new Error("Không tìm thấy trường Đối tác.");
  return within(item as HTMLElement).getByRole("combobox");
}

describe("Farm creation partner selector", () => {
  beforeEach(() => {
    activeForm = undefined;
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const pageNumber = Number(url.searchParams.get("page") ?? 1);
      let rows = [
        partner(1, "ACTIVE", "VERIFIED"),
        partner(2, "INACTIVE", "PENDING"),
        partner(3, "ACTIVE", "PENDING"),
      ];
      if (url.searchParams.has("status")) {
        rows = rows.filter((row) => row.status === url.searchParams.get("status"));
      }
      if (url.searchParams.has("verificationStatus")) {
        rows = rows.filter(
          (row) => row.verificationStatus === url.searchParams.get("verificationStatus"),
        );
      }
      const totalPages = Math.ceil(rows.length / 100);
      return publicPage(rows.slice((pageNumber - 1) * 100, pageNumber * 100), pageNumber, totalPages);
    });
    resourcesMock.createFarm.mockReset();
  });

  it("loads every partner page and only offers VERIFIED + ACTIVE partners for ACTIVE farms", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      const pageNumber = Number(url.searchParams.get("page") ?? 1);
      return publicPage(
        pageNumber === 1
          ? [partner(1, "ACTIVE", "VERIFIED")]
          : [partner(101, "ACTIVE", "VERIFIED")],
        pageNumber,
        2,
      );
    });

    renderWithProviders(<FarmFormHarness />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await userEvent.click(partnerSelector());

    expect(await screen.findAllByText("PARTNER-0001 — HTX 1")).not.toHaveLength(0);
    expect(await screen.findByText("PARTNER-0101 — HTX 101")).toBeInTheDocument();
    expect(screen.queryByText("PARTNER-0002 — HTX 2")).not.toBeInTheDocument();
    expect(screen.queryByText("PRIVATE-TAX-CODE")).not.toBeInTheDocument();
    expect(screen.queryByText("PRIVATE BANK NUMBER")).not.toBeInTheDocument();
    const requestedUrls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(requestedUrls.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
    for (const url of requestedUrls) {
      expect(url.searchParams.get("status")).toBe("ACTIVE");
      expect(url.searchParams.get("verificationStatus")).toBe("VERIFIED");
    }
    expect(
      fetchMock.mock.calls.every(([, init]) => !new Headers(init?.headers).has("Authorization")),
    ).toBe(true);
  });

  it("allows pending and inactive partners for INACTIVE draft farms", async () => {
    renderWithProviders(<FarmFormHarness status="INACTIVE" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await userEvent.click(partnerSelector());

    expect(await screen.findByText("PARTNER-0002 — HTX 2")).toBeInTheDocument();
    expect(await screen.findByText("PARTNER-0003 — HTX 3")).toBeInTheDocument();
    const url = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((requestedUrl) => !requestedUrl.searchParams.has("status"));
    expect(url).toBeDefined();
    if (!url) throw new Error("Không tìm thấy request tải danh sách đối tác nháp.");
    expect(url.searchParams.has("verificationStatus")).toBe(false);
    expect(url.searchParams.has("status")).toBe(false);
  });

  it("keeps the selected partner and farm fields when switching to ACTIVE, then requires an explicit reselection", async () => {
    renderWithProviders(<FarmFormHarness status="INACTIVE" />);
    await screen.findByText("PARTNER-0001 — HTX 1");
    act(() => {
      activeForm?.setFieldValue("partnerId", 2);
      activeForm?.setFieldValue("status", "ACTIVE");
    });

    expect(await screen.findByText("Đối tác đang chọn không còn đủ điều kiện hoạt động.")).toBeInTheDocument();
    expect(activeForm?.getFieldValue("partnerId")).toBe(2);
    expect(activeForm?.getFieldValue("name")).toBe("Trang trại thử");
    expect((screen.getByLabelText("Đối tác") as HTMLInputElement).value).toBe("PARTNER-0002 — HTX 2");
    await act(async () => {
      await expect(activeForm?.validateFields()).rejects.toThrow();
    });
    const activeQuery = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((url) => url.searchParams.get("verificationStatus") === "VERIFIED");
    expect(activeQuery?.searchParams.get("status")).toBe("ACTIVE");

    await userEvent.click(screen.getByRole("button", { name: "Chọn lại đối tác" }));
    expect(activeForm?.getFieldValue("partnerId")).toBeUndefined();
  });

  it("shows a clear empty state when no partner is available", async () => {
    fetchMock.mockImplementation(async () => publicPage([]));
    renderWithProviders(<FarmFormHarness />);

    expect(await screen.findByText("Chưa có đối tác đủ điều kiện.")).toBeInTheDocument();
    expect(screen.getByText(/Chuyển trạng thái trang trại về Ngừng hoạt động/)).toBeInTheDocument();
  });

  it("shows the backend business message when saving is rejected", async () => {
    resourcesMock.createFarm.mockRejectedValue(
      new Error("Đối tác phải được xác minh (VERIFIED) và đang hoạt động kinh doanh (ACTIVE)."),
    );
    renderWithProviders(
      <App>
        <FarmSaveHarness />
      </App>,
    );

    await screen.findByText("PARTNER-0001 — HTX 1");
    await userEvent.click(screen.getByRole("button", { name: "Lưu hồ sơ" }));
    expect(
      await screen.findByText("Đối tác phải được xác minh (VERIFIED) và đang hoạt động kinh doanh (ACTIVE)."),
    ).toBeInTheDocument();
    expect(resourcesMock.createFarm).toHaveBeenCalledTimes(1);
  });
});
