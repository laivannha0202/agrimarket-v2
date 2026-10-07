"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layout, Menu, Breadcrumb, Button, Dropdown, Avatar, Tag, type MenuProps } from "antd";
import {
  DashboardOutlined,
  ShoppingCartOutlined,
  RollbackOutlined,
  AppstoreOutlined,
  TagsOutlined,
  ShopOutlined,
  EnvironmentOutlined,
  SafetyCertificateOutlined,
  QrcodeOutlined,
  InboxOutlined,
  UserOutlined,
  DollarOutlined,
  BarChartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  StarOutlined,
  PercentageOutlined,
  FileTextOutlined,
  GiftOutlined,
} from "@ant-design/icons";
import { useAuth } from "@/lib/auth/auth-provider";

const { Header, Sider, Content } = Layout;

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Tổng quan",
    items: [{ key: "/dashboard", label: "Tổng quan", icon: <DashboardOutlined /> }],
  },
  {
    label: "Bán hàng",
    items: [
      { key: "/orders", label: "Đơn hàng", icon: <ShoppingCartOutlined /> },
      { key: "/returns-complaints", label: "Trả hàng & Khiếu nại", icon: <RollbackOutlined /> },
    ],
  },
  {
    label: "Sản phẩm",
    items: [
      { key: "/products", label: "Sản phẩm", icon: <AppstoreOutlined /> },
      { key: "/categories", label: "Danh mục", icon: <TagsOutlined /> },
    ],
  },
  {
    label: "Nguồn cung",
    items: [
      { key: "/partners", label: "Đối tác bán hàng", icon: <ShopOutlined /> },
      { key: "/farms", label: "Trang trại", icon: <EnvironmentOutlined /> },
    ],
  },
  {
    label: "Chất lượng & Truy xuất",
    items: [
      { key: "/quality-control", label: "Kiểm định chất lượng", icon: <SafetyCertificateOutlined /> },
      { key: "/lots", label: "Lô & QR", icon: <QrcodeOutlined /> },
      { key: "/certificates", label: "Chứng nhận", icon: <FileTextOutlined /> },
    ],
  },
  {
    label: "Kho hàng",
    items: [
      { key: "/inventory", label: "Tồn kho", icon: <InboxOutlined /> },
      { key: "/warehouse-documents", label: "Phiếu kho", icon: <FileTextOutlined /> },
    ],
  },
  {
    label: "Khuyến mãi",
    items: [
      { key: "/vouchers", label: "Voucher", icon: <GiftOutlined /> },
      { key: "/product-discounts", label: "Giảm giá sản phẩm", icon: <PercentageOutlined /> },
      { key: "/flash-sales", label: "Flash Sale", icon: <TagsOutlined /> },
    ],
  },
  {
    label: "Khách hàng",
    items: [
      { key: "/customers", label: "Khách hàng", icon: <UserOutlined /> },
      { key: "/reviews", label: "Đánh giá", icon: <StarOutlined /> },
    ],
  },
  {
    label: "Tài chính",
    items: [
      { key: "/commission", label: "Hoa hồng", icon: <DollarOutlined /> },
      { key: "/settlements", label: "Đối soát & Chi trả", icon: <DollarOutlined /> },
    ],
  },
  {
    label: "Báo cáo",
    items: [{ key: "/reports", label: "Báo cáo", icon: <BarChartOutlined /> }],
  },
];

function selectedKey(pathname: string): string {
  const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.key));
  // Longest matching prefix wins so /products/new highlights /products.
  const match = all
    .filter((k) => pathname === k || pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ?? pathname;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const menuItems: MenuProps["items"] = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        type: "group" as const,
        label: collapsed ? undefined : group.label,
        children: group.items.map((item) => ({
          key: item.key,
          icon: item.icon,
          label: <Link href={item.key}>{item.label}</Link>,
        })),
      })),
    [collapsed],
  );

  const breadcrumbItems = useMemo(() => {
    const key = selectedKey(pathname);
    const group = NAV_GROUPS.find((g) => g.items.some((i) => i.key === key));
    const item = group?.items.find((i) => i.key === key);
    const items: { title: React.ReactNode }[] = [
      { title: <Link href="/dashboard">Tổng quan</Link> },
    ];
    if (item && item.key !== "/dashboard") {
      items.push({ title: <Link href={item.key}>{item.label}</Link> });
    }
    return items;
  }, [pathname]);

  const userMenu: MenuProps["items"] = [
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "Đăng xuất",
      onClick: logout,
    },
  ];

  return (
    <Layout className="agri-shell">
      <Sider
        className="agri-sider"
        theme="light"
        width={232}
        collapsible
        collapsed={collapsed}
        trigger={null}
        breakpoint="lg"
        onBreakpoint={(broken) => setCollapsed(broken)}
      >
        <div className="agri-brand">
          <span className="agri-brand-mark" aria-hidden>
            🌿
          </span>
          {!collapsed && <span>AgriMarket Admin</span>}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey(pathname)]}
          items={menuItems}
          style={{ borderInlineEnd: "none", paddingTop: 8, paddingBottom: 24 }}
        />
      </Sider>
      <Layout>
        <Header className="agri-header">
          <Button
            type="text"
            aria-label={collapsed ? "Mở rộng menu" : "Thu gọn menu"}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((c) => !c)}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {user && <Tag color="green" style={{ marginInlineEnd: 0 }}>Quản trị viên</Tag>}
            <Dropdown menu={{ items: userMenu }} placement="bottomRight" trigger={["click"]}>
              <Button type="text" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar size={28} icon={<UserOutlined />} />
                <span>{user?.fullName ?? "Quản trị viên"}</span>
              </Button>
            </Dropdown>
          </div>
        </Header>
        <Content className="agri-content">
          <Breadcrumb className="agri-breadcrumb" items={breadcrumbItems} />
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
