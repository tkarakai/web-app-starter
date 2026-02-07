import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #f97316, #fb923c)",
          borderRadius: 8,
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3 4h5v5H3V4zm9 0h5v5h-5V4zM3 12h5v5H3v-5zm9 0h5v3a2 2 0 01-2 2h-3v-5z"
            fill="white"
            opacity="0.95"
          />
        </svg>
      </div>
    ),
    { ...size }
  );
}
