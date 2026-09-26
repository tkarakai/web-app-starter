"use client";

import type { ComponentProps, ReactElement } from "react";
import { useTranslations } from "next-intl";
import {
  PasskeyUnsupportedAlert as BasePasskeyUnsupportedAlert,
  PasswordInput as BasePasswordInput,
  OtpInput as BaseOtpInput,
} from "@web-app-starter/design-system";

// Design-system primitives take their labels as props; these fill them from the
// platform's message namespaces for the current locale.

export function PasswordInput(props: ComponentProps<typeof BasePasswordInput>): ReactElement {
  const t = useTranslations("common");
  return <BasePasswordInput showPasswordLabel={t("showPassword")} hidePasswordLabel={t("hidePassword")} {...props} />;
}

export function OtpInput(props: ComponentProps<typeof BaseOtpInput>): ReactElement {
  const t = useTranslations("common");
  return <BaseOtpInput digitLabel={(index, length) => t("otpDigit", { index, length })} {...props} />;
}

export function PasskeyUnsupportedAlert(props: ComponentProps<typeof BasePasskeyUnsupportedAlert>): ReactElement {
  const t = useTranslations("dashboard.passkeys");
  return <BasePasskeyUnsupportedAlert title={t("unsupportedTitle")} description={t("unsupportedDescription")} {...props} />;
}
