import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProviders } from "../src/providers";
import { ApiConfigNotice } from "../src/components/ApiConfigNotice";
import { OfflineBanner } from "../src/components/OfflineBanner";
import { setUnauthorizedHandler } from "../src/lib/api-client";

setUnauthorizedHandler(null);

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProviders>
        <StatusBar style="dark" />
        <OfflineBanner />
        <ApiConfigNotice />
        <Stack screenOptions={{ headerTintColor: "#0b7a39" }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ title: "Đăng nhập" }} />
          <Stack.Screen name="register" options={{ title: "Đăng ký tài khoản" }} />
          <Stack.Screen name="forgot-password" options={{ title: "Quên mật khẩu" }} />
          <Stack.Screen name="reset-password" options={{ title: "Đặt lại mật khẩu" }} />
          <Stack.Screen name="change-password" options={{ title: "Đổi mật khẩu" }} />
          <Stack.Screen name="profile-edit" options={{ title: "Sửa thông tin" }} />
          <Stack.Screen name="product/[id]" options={{ title: "Sản phẩm" }} />
          <Stack.Screen name="farms" options={{ title: "Trang trại" }} />
          <Stack.Screen name="farm/[id]" options={{ title: "Trang trại" }} />
          <Stack.Screen name="checkout" options={{ title: "Đặt hàng" }} />
          <Stack.Screen name="orders" options={{ title: "Đơn hàng" }} />
          <Stack.Screen name="order/[id]" options={{ title: "Chi tiết đơn" }} />
          <Stack.Screen name="addresses" options={{ title: "Sổ địa chỉ" }} />
          <Stack.Screen name="address-edit" options={{ title: "Địa chỉ giao hàng" }} />
          <Stack.Screen name="trace/[code]" options={{ title: "Truy xuất" }} />
          <Stack.Screen name="scan" options={{ title: "Quét mã QR" }} />
          <Stack.Screen name="returns" options={{ title: "Trả hàng" }} />
          <Stack.Screen name="returns-new" options={{ title: "Tạo yêu cầu trả hàng" }} />
          <Stack.Screen name="return/[id]" options={{ title: "Chi tiết trả hàng" }} />
          <Stack.Screen name="complaints" options={{ title: "Khiếu nại" }} />
          <Stack.Screen name="complaints-new" options={{ title: "Gửi khiếu nại" }} />
          <Stack.Screen name="complaint/[id]" options={{ title: "Chi tiết khiếu nại" }} />
          <Stack.Screen name="my-reviews" options={{ title: "Đánh giá của tôi" }} />
          <Stack.Screen name="my-reviews-new" options={{ title: "Viết đánh giá" }} />
          <Stack.Screen name="vouchers" options={{ title: "Mã giảm giá" }} />
        </Stack>
      </AppProviders>
    </SafeAreaProvider>
  );
}
