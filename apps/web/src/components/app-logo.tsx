type AppLogoProps = {
  className?: string;
  size?: number;
};

export function AppLogo({ className, size = 28 }: AppLogoProps) {
  return (
    <img
      src="/icon.svg"
      alt=""
      width={size}
      height={size}
      className={className}
    />
  );
}
