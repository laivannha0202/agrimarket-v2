"use client";

/**
 * Province + commune picker for the 2025 two-level address model.
 *
 * WHY THIS COMPONENT EXISTS
 *
 * The 104 Hưng Yên xã/phường are Government reference data that must exist in
 * exactly one place. They live in the backend catalogue and reach this form
 * through `GET /locations/provinces` and `GET /locations/provinces/:code/wards`
 * — the picker never embeds its own list, and it never lets a customer type a
 * commune name, because a typed name cannot be validated against a code.
 *
 * The list is fetched ONCE per province (104 rows) and filtered locally while
 * the customer types, so the search box does not issue a request per keystroke.
 * The filter is accent-insensitive: "pho hien" finds "Phường Phố Hiến".
 *
 * The value that leaves this component is always the official CODE pair
 * (`provinceCode` + `wardCode`); the display name is resolved by the backend
 * and stored as `wardName`, so a forged commune name cannot travel with a code.
 */

import { Select, SimpleGrid, Text } from "@mantine/core";
import type { OptionsFilter } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { wardMatches } from "@/lib/address";

export interface WardPickerProps {
  provinceCode: string;
  wardCode: string;
  onProvinceChange: (provinceCode: string) => void;
  onWardChange: (wardCode: string) => void;
  provinceError?: string;
  wardError?: string;
  disabled?: boolean;
}

export function WardPicker({
  provinceCode,
  wardCode,
  onProvinceChange,
  onWardChange,
  provinceError,
  wardError,
  disabled,
}: WardPickerProps) {
  const provincesQuery = useQuery({
    queryKey: queryKeys.locations.provinces(),
    queryFn: resources.listProvinces,
    // Reference data: it changes only when the Government publishes a new
    // resolution, so it is kept for the whole session.
    staleTime: 60 * 60_000,
  });

  const wardsQuery = useQuery({
    queryKey: queryKeys.locations.wards(provinceCode),
    queryFn: () => resources.listWards(provinceCode),
    enabled: provinceCode.length > 0,
    staleTime: 60 * 60_000,
  });

  const provinces = useMemo(() => provincesQuery.data ?? [], [provincesQuery.data]);
  const wards = useMemo(() => wardsQuery.data?.data ?? [], [wardsQuery.data]);

  const provinceOptions = useMemo(
    () => provinces.map((p) => ({ value: p.code, label: p.fullName })),
    [provinces],
  );

  const wardOptions = useMemo(
    () => wards.map((w) => ({ value: w.code, label: w.fullName })),
    [wards],
  );

  /**
   * Mantine's default filter is accent-sensitive, so it would hide "Phố Hiến"
   * while the customer types "pho hien". The custom filter folds both sides the
   * same way, and matches the code too so "11953" works.
   *
   * The parsed-option list can contain groups; this data is always a flat list,
   * but a group is passed through rather than being dropped.
   */
  const filterWards: OptionsFilter<string> = ({ options, search }) =>
    options.filter((option) => {
      if ("group" in option) return true;
      const ward = wards.find((w) => w.code === option.value);
      return ward ? wardMatches(ward, search) : true;
    });

  /**
   * Changing the province clears the commune: the previous code belongs to a
   * different catalogue and would otherwise be submitted as a mismatched pair
   * (which the backend would reject — the picker just does not create it).
   */
  useEffect(() => {
    if (!provinceCode) return;
    if (wardCode && wards.length > 0 && !wards.some((w) => w.code === wardCode)) {
      onWardChange("");
    }
    // `onWardChange` is stable (a setter or a form callback) and intentionally
    // not a dependency: including it would re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provinceCode, wardCode, wards]);

  const onlyProvince = provinces.length === 1 ? provinces[0] : null;

  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
      <Select
        label="Tỉnh / Thành phố"
        placeholder={provincesQuery.isLoading ? "Đang tải…" : "Chọn tỉnh/thành phố"}
        data={provinceOptions}
        value={provinceCode || null}
        onChange={(value) => onProvinceChange(value ?? "")}
        searchable
        nothingFoundMessage="Không tìm thấy tỉnh/thành phố"
        error={provinceError ?? (provincesQuery.isError ? "Chưa tải được danh sách tỉnh/thành phố" : null)}
        disabled={disabled}
        required
        // The storefront currently delivers inside one province; the field is
        // still a real select (not a disabled text box) so a second province
        // needs no code change.
        description={onlyProvince ? `Hiện giao hàng trong ${onlyProvince.fullName}` : undefined}
      />
      <Select
        label="Xã / Phường"
        placeholder={
          !provinceCode
            ? "Chọn tỉnh/thành phố trước"
            : wardsQuery.isLoading
              ? "Đang tải…"
              : "Chọn xã/phường"
        }
        data={wardOptions}
        value={wardCode || null}
        onChange={(value) => onWardChange(value ?? "")}
        searchable
        filter={filterWards}
        nothingFoundMessage="Không tìm thấy xã/phường. Thử gõ không dấu, ví dụ: pho hien"
        error={wardError ?? (wardsQuery.isError ? "Chưa tải được danh sách xã/phường" : null)}
        disabled={disabled || !provinceCode || wardsQuery.isLoading}
        required
        description={
          wardsQuery.data && provinceCode
            ? `${wardsQuery.data.meta.total} xã/phường theo danh mục 2025`
            : undefined
        }
      />
      {wardsQuery.isError ? (
        <Text size="xs" c="var(--agri-muted)">
          Danh mục xã/phường chưa tải được. Vui lòng kiểm tra kết nối và thử lại.
        </Text>
      ) : null}
    </SimpleGrid>
  );
}
