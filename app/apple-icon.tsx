import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #173b34 0%, #1f7a63 100%)",
        }}
      >
        <svg
          width="138"
          height="138"
          viewBox="0 0 512 512"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="214" cy="210" r="116" fill="#ffffff" />
          <circle cx="267" cy="172" r="110" fill="#1b5e4f" />
          <path
            d="M278 336C307 274 359 242 418 242C411 302 378 352 318 370C297 376 277 359 278 336Z"
            fill="#e2f1ea"
          />
          <path
            d="M302 349C329 316 360 291 398 270"
            fill="none"
            stroke="#1a5d4e"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <circle cx="272" cy="330" r="17" fill="#ffffff" />
        </svg>
      </div>
    ),
    size,
  );
}
