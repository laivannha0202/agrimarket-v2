"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Layout,
  Menu,
  Breadcrumb,
  Button,
  Dropdown,
  Avatar,
  Tag,
  Drawer,
  Grid,
  type MenuProps,
} from "antd";
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
  AuditOutlined,
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
      { key: "/shipments", label: "Vận đơn", icon: <InboxOutlined /> },
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
      { key: "/quarantine", label: "Hàng cách ly", icon: <SafetyCertificateOutlined /> },
      { key: "/lots", label: "Lô & QR", icon: <QrcodeOutlined /> },
      { key: "/certificates", label: "Chứng nhận", icon: <FileTextOutlined /> },
    ],
  },
  {
    label: "Kho hàng",
    items: [
      { key: "/warehouses", label: "Kho hàng", icon: <InboxOutlined /> },
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
    label: "Người dùng",
    items: [
      { key: "/customers", label: "Người dùng", icon: <UserOutlined /> },
      { key: "/reviews", label: "Đánh giá", icon: <StarOutlined /> },
    ],
  },
  {
    label: "Tài chính",
    items: [
      { key: "/commission", label: "Hoa hồng", icon: <DollarOutlined /> },
      { key: "/settlements", label: "Đối soát & Chi trả", icon: <DollarOutlined /> },
      { key: "/reconciliation", label: "Đối chiếu dòng tiền", icon: <AuditOutlined /> },
      { key: "/refunds", label: "Hoàn tiền", icon: <RollbackOutlined /> },
    ],
  },
  {
    label: "Báo cáo",
    items: [
      { key: "/reports", label: "Báo cáo", icon: <BarChartOutlined /> },
      { key: "/audit", label: "Nhật ký kiểm toán", icon: <FileTextOutlined /> },
    ],
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
  // A phone has no room for an 80px icon rail next to a 390px viewport: the
  // content column was left with ~200px and every key/value card wrapped its
  // labels mid-word. Below `md` the menu moves into an off-canvas drawer.
  const screens = Grid.useBreakpoint();
  const isPhone = screens.md === false;
  const [navOpen, setNavOpen] = useState(false);

  const menuItems: MenuProps["items"] = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        type: "group" as const,
        label: collapsed && !isPhone ? undefined : group.label,
        children: group.items.map((item) => ({
          key: item.key,
          icon: item.icon,
          // Closing the phone drawer on the link itself avoids a state update
          // inside an effect keyed on `pathname` (react-hooks/set-state-in-effect).
          label: (
            <Link href={item.key} onClick={() => setNavOpen(false)}>
              {item.label}
            </Link>
          ),
        })),
      })),
    [collapsed, isPhone],
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

  const nav = (
    <>
      <div className="agri-brand">
        <Image
          src="/design/brand/leaf_mark_512.png"
          alt=""
          width={28}
          height={28}
          className="agri-brand-logo"
          priority
        />
        {(!collapsed || isPhone) && <span>AgriMarket Admin</span>}
      </div>
      <Menu
        mode="inline"
        selectedKeys={[selectedKey(pathname)]}
        items={menuItems}
        style={{ borderInlineEnd: "none", paddingTop: 8, paddingBottom: 24 }}
      />
    </>
  );

  return (
    <Layout className="agri-shell">
      {isPhone ? (
        <Drawer
          open={navOpen}
          onClose={() => setNavOpen(false)}
          placement="left"
          size={248}
          closable={false}
          styles={{ body: { padding: 0 } }}
        >
          {nav}
        </Drawer>
      ) : (
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
          {nav}
        </Sider>
      )}
      {/*
        A flex item defaults to `min-width: auto`, so a wide child (the five
        order-detail tabs) used to push this column past the viewport and the
        whole page scrolled sideways on a phone. `agri-main` pins it to the
        space left by the sider.
      */}
      <Layout className="agri-main">
        <Header className="agri-header">
          <Button
            type="text"
            aria-label={
              isPhone ? "Mở menu" : collapsed ? "Mở rộng menu" : "Thu gọn menu"
            }
            icon={collapsed || isPhone ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => (isPhone ? setNavOpen(true) : setCollapsed((c) => !c))}
          />
          {/*
            The role tag + full name need ~317px; together with the collapse
            button that is wider than a 390px phone, which pushed the whole
            page sideways. On phones only the avatar remains (the name is in
            the dropdown menu and the page title).
          */}
          <div className="agri-header-user">
            {user && (
              <Tag color="green" className="agri-header-role" style={{ marginInlineEnd: 0 }}>
                Quản trị viên
              </Tag>
            )}
            <Dropdown menu={{ items: userMenu }} placement="bottomRight" trigger={["click"]}>
              <Button type="text" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar size={28} icon={<UserOutlined />} />
                <span className="agri-header-name">{user?.fullName ?? "Quản trị viên"}</span>
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
