type AppLogoProps = {
  className?: string;
  size?: number;
};

export function AppLogo({ className, size = 28 }: AppLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect width="32" height="32" rx="8" fill="url(#logo-gradient)" />
      <path
        d="M7 8.5h7v7H7v-7zm11 0h7v7h-7v-7zM7 19.5h7v7H7v-7zm11 0h7v4.2a2.8 2.8 0 01-2.8 2.8H18v-7z"
        fill="white"
        opacity="0.95"
      />
      <defs>
        <linearGradient id="logo-gradient" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f97316" />
          <stop offset="1" stopColor="#fb923c" />
        </linearGradient>
      </defs>
    </svg>
  );
}
