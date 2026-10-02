import { ForceSystemTheme, GuestGuard } from "@web-app-starter/auth-ui";
import { PublicPageBrandTokens } from "@/components/auth/public-page-brand-tokens";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <GuestGuard>
      <ForceSystemTheme />
      <PublicPageBrandTokens />
      {children}
    </GuestGuard>
  );
}
