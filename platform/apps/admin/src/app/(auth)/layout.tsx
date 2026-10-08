import { ForceSystemTheme } from "@web-app-starter/auth-ui";
import { AdminGuestGuard } from "@/components/auth/admin-guest-guard";
import { PublicPageBrandTokens } from "@/components/auth/public-page-brand-tokens";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminGuestGuard>
      <ForceSystemTheme />
      <PublicPageBrandTokens />
      {children}
    </AdminGuestGuard>
  );
}
