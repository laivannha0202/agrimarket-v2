/**
 * Đăng ký tài khoản.
 *
 * One account system for the app and the Customer Web: this screen posts to the
 * same `POST /auth/register` the website uses, and the resulting account signs
 * in on either client. The backend hardcodes the CUSTOMER role — the request
 * DTO has no role field and the global validation pipe rejects unknown
 * properties, so a forged `role: "ADMIN"` is a 400 rather than a privilege
 * escalation.
 *
 * No session is issued by design: registration returns to the login screen, so
 * both clients have exactly one way to obtain a token.
 *
 * VALIDATION: every rule here mirrors the backend DTO (see `lib/validation.ts`),
 * so the customer is told the exact field that is wrong BEFORE a request is
 * sent — a one-character name is caught here with its own message instead of
 * being rejected by the server as a generic "dữ liệu chưa hợp lệ". If the
 * server still rejects (a race on a duplicate e-mail, say), the backend message
 * is mapped back onto the matching field rather than shown as one banner.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { GhostButton, PrimaryButton } from "../src/components/ui";
import { ApiError, errorMessage, isNetworkError } from "../src/lib/api-client";
import { resources } from "../src/lib/resources";
import { colors, radius, spacing, TOUCH } from "../src/lib/theme";
import {
  firstInvalidField,
  mapRegisterFieldErrors,
  validateRegisterForm,
  type FieldErrors,
  type RegisterField,
} from "../src/lib/validation";

export default function RegisterScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);

  // One ref per field, so submit can focus the first invalid one and each
  // "Next" can advance to the next box. A network error must never clear what
  // the customer already typed, so the values live in state, not the inputs.
  const fullNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  // Focusing a ref is an event-handler action, never something done during
  // render, so it lives in a named callback rather than an inline JSX arrow.
  // Each useRef value is stable, so the callback never needs to change.
  const focusField = useCallback((field: RegisterField) => {
    switch (field) {
      case "fullName":
        fullNameRef.current?.focus();
        break;
      case "email":
        emailRef.current?.focus();
        break;
      case "phone":
        phoneRef.current?.focus();
        break;
      case "password":
        passwordRef.current?.focus();
        break;
      case "confirmPassword":
        confirmRef.current?.focus();
        break;
    }
  }, [fullNameRef, emailRef, phoneRef, passwordRef, confirmRef]);

  const submit = async () => {
    if (busy) return;
    setFormError(null);

    const errors = validateRegisterForm({ fullName, email, phone, password, confirmPassword });
    setFieldErrors(errors);
    const firstBad = firstInvalidField(errors);
    if (firstBad) {
      focusField(firstBad);
      return;
    }

    setBusy(true);
    try {
      const created = await resources.register({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        password,
      });
      setCreatedEmail(created.email);
    } catch (err) {
      if (isNetworkError(err)) {
        // Offline / wrong LAN address: keep every field so the customer can
        // retry without retyping. This is NOT a validation problem, so it is a
        // single message, never a per-field one.
        setFieldErrors({});
        setFormError(errorMessage(err, "Không đăng ký được. Vui lòng kiểm tra kết nối và thử lại."));
      } else if (err instanceof ApiError) {
        // The client validated already, so a 400/409 here is almost always a
        // race or a server-only rule. Map the backend message onto its field;
        // only fall back to a form-level banner when nothing maps.
        const { fields, formError: mapped } = mapRegisterFieldErrors(err.body?.message);
        setFieldErrors(fields);
        setFormError(
          mapped ??
            (Object.keys(fields).length === 0
              ? errorMessage(err, "Không đăng ký được tài khoản. Vui lòng thử lại.")
              : null),
        );
        const firstMapped = firstInvalidField(fields);
        if (firstMapped) focusField(firstMapped);
      } else {
        setFieldErrors({});
        setFormError(errorMessage(err, "Không đăng ký được tài khoản. Vui lòng thử lại."));
      }
    } finally {
      setBusy(false);
    }
  };

  if (createdEmail) {
    return (
      <View style={styles.donePage}>
        <Ionicons name="checkmark-circle" size={54} color={colors.primary} />
        <Text style={styles.doneTitle}>Đã tạo tài khoản</Text>
        <Text style={styles.doneText}>
          Tài khoản {createdEmail} đã được tạo. Vui lòng đăng nhập bằng mật khẩu bạn vừa đặt.
        </Text>
        <PrimaryButton
          label="Đăng nhập ngay"
          onPress={() =>
            router.replace({
              pathname: "/login",
              params: { email: createdEmail, redirect: "/(tabs)/account" },
            })
          }
          style={styles.doneCta}
        />
        <GhostButton label="Về trang chủ" onPress={() => router.replace("/(tabs)")} style={styles.doneCta} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.heading}>Tạo tài khoản</Text>
        <Text style={styles.subheading}>Dùng chung cho ứng dụng và website AgriMarket.</Text>

        <Field
          label="Họ và tên"
          icon="person-outline"
          inputRef={fullNameRef}
          value={fullName}
          onChange={(v) => {
            setFullName(v);
            if (fieldErrors.fullName) setFieldErrors((e) => ({ ...e, fullName: undefined }));
          }}
          placeholder="Nguyễn Văn A"
          autoCapitalize="words"
          accessibilityLabel="Họ và tên"
          error={fieldErrors.fullName}
          returnKeyType="next"
          onSubmitEditing={() => focusField("email")}
        />

        <Field
          label="Email"
          icon="mail-outline"
          inputRef={emailRef}
          value={email}
          onChange={(v) => {
            setEmail(v);
            if (fieldErrors.email) setFieldErrors((e) => ({ ...e, email: undefined }));
          }}
          placeholder="khachhang@agrimarket.vn"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          accessibilityLabel="Email"
          error={fieldErrors.email}
          returnKeyType="next"
          onSubmitEditing={() => focusField("phone")}
        />

        <Field
          label="Số điện thoại"
          icon="call-outline"
          inputRef={phoneRef}
          value={phone}
          onChange={(v) => {
            setPhone(v);
            if (fieldErrors.phone) setFieldErrors((e) => ({ ...e, phone: undefined }));
          }}
          placeholder="0912345678"
          keyboardType="phone-pad"
          accessibilityLabel="Số điện thoại"
          error={fieldErrors.phone}
          returnKeyType="next"
          onSubmitEditing={() => focusField("password")}
        />

        <Field
          label="Mật khẩu"
          icon="lock-closed-outline"
          inputRef={passwordRef}
          value={password}
          onChange={(v) => {
            setPassword(v);
            if (fieldErrors.password) setFieldErrors((e) => ({ ...e, password: undefined }));
          }}
          placeholder="Tối thiểu 10 ký tự"
          secureTextEntry={!showPassword}
          accessibilityLabel="Mật khẩu"
          error={fieldErrors.password}
          returnKeyType="next"
          onSubmitEditing={() => focusField("confirmPassword")}
          trailing={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
        />

        <Field
          label="Nhập lại mật khẩu"
          icon="lock-closed-outline"
          inputRef={confirmRef}
          value={confirmPassword}
          onChange={(v) => {
            setConfirmPassword(v);
            if (fieldErrors.confirmPassword) setFieldErrors((e) => ({ ...e, confirmPassword: undefined }));
          }}
          placeholder="Nhập lại mật khẩu"
          secureTextEntry={!showPassword}
          accessibilityLabel="Nhập lại mật khẩu"
          error={fieldErrors.confirmPassword}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          trailing={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
        />

        {formError ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle" size={15} color={colors.danger} />
            <Text style={styles.error}>{formError}</Text>
          </View>
        ) : null}

        <PrimaryButton
          label="Đăng ký"
          onPress={() => void submit()}
          disabled={busy}
          loading={busy}
          style={styles.submit}
        />

        <Pressable
          onPress={() => router.replace("/login")}
          style={({ pressed }) => [styles.footer, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.footerText}>Đã có tài khoản? Đăng nhập</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}


/* -------------------------------------------------------------- sub-views -- */

interface FieldProps {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  inputRef: React.RefObject<TextInput | null>;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  error?: string;
  autoCapitalize?: "none" | "words";
  autoCorrect?: boolean;
  keyboardType?: "default" | "email-address" | "phone-pad";
  secureTextEntry?: boolean;
  returnKeyType?: "next" | "go";
  onSubmitEditing?: () => void;
  trailing?: React.ReactNode;
}

/**
 * One labelled input with its error line directly beneath it. Extracted so all
 * five fields share the exact same spacing, error placement and focus order —
 * a per-field message is the whole point of this screen, so it must never be
 * inconsistent between rows.
 */
function Field({
  label,
  icon,
  inputRef,
  value,
  onChange,
  placeholder,
  accessibilityLabel,
  error,
  autoCapitalize,
  autoCorrect,
  keyboardType,
  secureTextEntry,
  returnKeyType,
  onSubmitEditing,
  trailing,
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputRow, error && styles.inputRowError]}>
        <Ionicons name={icon} size={18} color={colors.muted} />
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedSoft}
          style={styles.input}
          accessibilityLabel={accessibilityLabel}
          returnKeyType={returnKeyType}
          blurOnSubmit={returnKeyType === "next" ? false : undefined}
          onSubmitEditing={onSubmitEditing}
        />
        {trailing}
      </View>
      {error ? (
        <View style={styles.fieldErrorRow}>
          <Ionicons name="alert-circle" size={13} color={colors.danger} />
          <Text style={styles.fieldError}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Show / hide the password. Never echoes the value, only toggles visibility. */
function PasswordToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
    >
      <Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={18} color={colors.mutedSoft} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, paddingTop: spacing.lg, flexGrow: 1 },
  pressed: { opacity: 0.85 },

  heading: { fontSize: 22, fontWeight: "700", color: colors.textStrong },
  subheading: { fontSize: 13, color: colors.muted, marginTop: 2, marginBottom: spacing.lg },

  field: { marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 6 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH,
    backgroundColor: colors.surface,
  },
  inputRowError: { borderColor: colors.danger },
  input: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 8 },
  fieldErrorRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  fieldError: { flex: 1, fontSize: 12.5, color: colors.danger, lineHeight: 17 },

  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  error: { flex: 1, fontSize: 13, color: colors.danger, lineHeight: 18 },
  submit: { marginTop: spacing.md },

  footer: { alignItems: "center", paddingVertical: spacing.lg, minHeight: TOUCH, justifyContent: "center" },
  footerText: { fontSize: 13, fontWeight: "700", color: colors.primary },

  donePage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    backgroundColor: colors.page,
    gap: spacing.sm,
  },
  doneTitle: { fontSize: 19, fontWeight: "700", color: colors.textStrong },
  doneText: { fontSize: 13.5, color: colors.muted, textAlign: "center", lineHeight: 19 },
  doneCta: { alignSelf: "stretch", marginTop: spacing.sm },
});

