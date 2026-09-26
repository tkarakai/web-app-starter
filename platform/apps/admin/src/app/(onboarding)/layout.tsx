import { ForceSystemTheme } from "@web-app-starter/auth-ui";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ForceSystemTheme />
      {children}
    </>
  );
}
