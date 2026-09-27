import { ForceSystemTheme, GuestGuard } from "@web-app-starter/auth-ui";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <GuestGuard>
      <ForceSystemTheme />
      {children}
    </GuestGuard>
  );
}
