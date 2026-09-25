"use client";

import type { ComponentProps, ReactElement } from "react";
import { useTranslations } from "next-intl";
import {
  Breadcrumb as BaseBreadcrumb,
  CopyableField as BaseCopyableField,
  DialogContent as BaseDialogContent,
  PasskeyUnsupportedAlert as BasePasskeyUnsupportedAlert,
  PasswordInput as BasePasswordInput,
  OtpInput as BaseOtpInput,
  StyledQrCode as BaseStyledQrCode,
  TimezoneSelector as BaseTimezoneSelector,
  CURATED_TIMEZONES,
  Sidebar as BaseSidebar,
  SidebarRail as BaseSidebarRail,
  SidebarTrigger as BaseSidebarTrigger,
} from "@repo/design-system";

// Shared primitives accept labels; the app supplies its current locale.
export function PasswordInput(props: ComponentProps<typeof BasePasswordInput>): ReactElement {
  const t = useTranslations("common");
  return <BasePasswordInput showPasswordLabel={t("showPassword")} hidePasswordLabel={t("hidePassword")} {...props} />;
}

export function CopyableField(props: ComponentProps<typeof BaseCopyableField>): ReactElement {
  const t = useTranslations("common");
  return <BaseCopyableField copyLabel={t("copy")} copiedLabel={t("copied")} {...props} />;
}

export function DialogContent(props: ComponentProps<typeof BaseDialogContent>): ReactElement {
  const t = useTranslations("common");
  return <BaseDialogContent closeLabel={t("close")} {...props} />;
}

export function PasskeyUnsupportedAlert(props: ComponentProps<typeof BasePasskeyUnsupportedAlert>): ReactElement {
  const t = useTranslations("dashboard.passkeys");
  return <BasePasskeyUnsupportedAlert title={t("unsupportedTitle")} description={t("unsupportedDescription")} {...props} />;
}

export function Sidebar(props: ComponentProps<typeof BaseSidebar>): ReactElement {
  const t = useTranslations("common");
  return <BaseSidebar labels={{ title: t("navigation"), description: t("navigation"), close: t("close") }} {...props} />;
}

export function SidebarRail(props: ComponentProps<typeof BaseSidebarRail>): ReactElement {
  const t = useTranslations("common");
  return <BaseSidebarRail aria-label={t("resizeSidebar")} title={t("resizeSidebar")} {...props} />;
}

export function SidebarTrigger(props: ComponentProps<typeof BaseSidebarTrigger>): ReactElement {
  const t = useTranslations("common");
  return <BaseSidebarTrigger aria-label={t("toggleSidebar")} {...props} />;
}

export function Breadcrumb(props: ComponentProps<typeof BaseBreadcrumb>): ReactElement {
  const t = useTranslations("common");
  return <BaseBreadcrumb aria-label={t("breadcrumb")} {...props} />;
}

export function OtpInput(props: ComponentProps<typeof BaseOtpInput>): ReactElement {
  const t = useTranslations("common");
  return <BaseOtpInput digitLabel={(index, length) => t("otpDigit", { index, length })} {...props} />;
}

export function StyledQrCode(props: ComponentProps<typeof BaseStyledQrCode>): ReactElement {
  const t = useTranslations("common");
  return <BaseStyledQrCode aria-label={t("qrCode")} {...props} />;
}

export function TimezoneSelector(props: ComponentProps<typeof BaseTimezoneSelector>): ReactElement {
  const t = useTranslations("timezones");
  const tc = useTranslations("common");
  const groups = CURATED_TIMEZONES.map((group) => ({
    region: t(`regions.${group.region}`),
    zones: group.zones.map((zone) => ({ ...zone, label: t(`zones.${zone.value}`) })),
  }));
  return <BaseTimezoneSelector groups={groups} daylightSavingLabel={tc("daylightSaving")} {...props} />;
}
