import { ForceSystemTheme } from "@web-app-starter/auth-ui";
import { PublicPageBrandTokens } from "@/components/auth/public-page-brand-tokens";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ForceSystemTheme />
      <PublicPageBrandTokens />
      {children}
    </>
  );
}
