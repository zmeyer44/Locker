import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Locker — Open-source file storage platform";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PRIMARY = "#4F46E5";

export default async function Image() {
  const geistDir = join(require.resolve("geist/package.json"), "../dist/fonts");
  const [geistRegular, geistMedium, geistMonoBold] = await Promise.all([
    readFile(join(geistDir, "geist-sans/Geist-Regular.ttf")),
    readFile(join(geistDir, "geist-sans/Geist-Medium.ttf")),
    readFile(join(geistDir, "geist-mono/GeistMono-Bold.ttf")),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#FAFAFA",
        padding: "48px 56px",
        fontFamily: "Geist",
      }}
    >
      {/* Top bar — logo + badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={56}
          height={56}
          viewBox="0 0 250 250"
        >
          <path
            d="m235.6 116-39.27-66.5c-10.16-17.57-23.48-26.1-45.67-26.1h-65.69c-14.93 0-27.69 0.72-37.09 10.12-10.17 10.16-11.61 21.68-4.2 35.92l6.72 11.83 31.53 53.8c12.89 22.23 22.43 33.56 47.74 33.56h74.25c11.83 0 22.12-0.71 28.13-5.93 11.83-10.28 13.82-28.27 3.55-46.7zm-31.82 19.03c-4.31 1.82-15.48 1.45-35.14 1.45-10.02 0-21.61-0.18-31.02-0.33-15.51-0.25-20.89-4.49-28.55-17.7l-26.06-45.71c-6.83-12.54-6.87-19.05 5.48-19.27 7.56-0.57 18.66-0.28 27.43-0.32h27.33c15.04 0 22.52 3.58 32.1 19.09l24.47 40.51c7.63 12.58 9.02 20.18 3.96 22.28z"
            fill={PRIMARY}
          />
          <path
            d="m222.2 186.9-9.88 17.54c-7.73 12.57-19.57 20.3-34.93 20.3h-82.77c-17.35 0-31.6-8.38-40.3-22.66l-40.51-63.76c-10.27-16.17-10.27-32.77-1.39-46.02l8.91-17.85c-2.85 9.4 0 18.8 7.38 31.34l40.51 65.34c9.55 16.21 18.61 25.83 40.67 25.83h74.98c16.17 0 27.73-0.42 37.33-10.06z"
            fill={PRIMARY}
          />
        </svg>
        {/* Open source badge */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#999999",
            fontFamily: "Geist Mono",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            border: "1px solid #E5E5E5",
            padding: "5px 12px",
          }}
        >
          Open Source
        </span>
      </div>

      {/* Main content */}
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          gap: 48,
          marginTop: -48,
        }}
      >
        {/* Left — headline + description */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            gap: 20,
          }}
        >
          <div
            style={{
              fontSize: 48,
              fontWeight: 500,
              lineHeight: 1.05,
              color: "#141414",
              fontFamily: "Geist",
              letterSpacing: "-0.035em",
            }}
          >
            Your Files, Your Cloud
          </div>
          <div
            style={{
              fontSize: 16,
              color: "#737373",
              lineHeight: 1.5,
              fontFamily: "Geist",
            }}
          >
            The open-source file storage platform you can self-host. Upload,
            organize, and share files — fully under your control.
          </div>
        </div>

        {/* Right — file cards */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 380,
            flexShrink: 0,
            gap: 0,
          }}
        >
          {/* File cards grid */}
          <div style={{ display: "flex", gap: 0, border: "1px solid #E5E5E5" }}>
            {fileCard("Documents", "128", "files", "2.4 GB")}
            {fileCard("Images", "847", "files", "12.1 GB")}
          </div>
          <div
            style={{
              display: "flex",
              gap: 0,
              borderLeft: "1px solid #E5E5E5",
              borderRight: "1px solid #E5E5E5",
              borderBottom: "1px solid #E5E5E5",
            }}
          >
            {fileCard("Projects", "24", "folders", "8.7 GB")}
            {fileCard("Shared", "16", "links", "Active")}
          </div>
          {/* Storage bar */}
          {storageBar(23.2, 50)}
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: "#999999",
            fontFamily: "Geist Mono",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          locker
        </span>
        <div style={{ display: "flex", gap: 16 }}>
          {["FILES", "SHARING", "UPLOADS", "TERMINAL"].map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#999999",
                fontFamily: "Geist Mono",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Geist",
          data: geistRegular,
          style: "normal" as const,
          weight: 400 as const,
        },
        {
          name: "Geist",
          data: geistMedium,
          style: "normal" as const,
          weight: 500 as const,
        },
        {
          name: "Geist Mono",
          data: geistMonoBold,
          style: "normal" as const,
          weight: 700 as const,
        },
      ],
    },
  );
}

function storageBar(used: number, total: number) {
  const pct = (used / total) * 100;
  const barWidth = 380;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#FFFFFF",
        border: "1px solid #E5E5E5",
        borderTop: "none",
        padding: "14px 16px",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: "#999999",
            fontFamily: "Geist Mono",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Storage
        </span>
        <span
          style={{
            fontSize: 9,
            color: "#999999",
            fontFamily: "Geist Mono",
            letterSpacing: "0.04em",
          }}
        >
          {used} GB / {total} GB
        </span>
      </div>
      <div
        style={{
          display: "flex",
          width: barWidth - 32,
          height: 6,
          backgroundColor: "#F0F0F0",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            backgroundColor: PRIMARY,
          }}
        />
      </div>
    </div>
  );
}

function fileCard(label: string, count: string, unit: string, size: string) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: "14px 16px",
        backgroundColor: "#FFFFFF",
        borderRight: "1px solid #E5E5E5",
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: "#999999",
          fontFamily: "Geist Mono",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
        <span
          style={{
            fontSize: 26,
            fontWeight: 500,
            color: "#141414",
            fontFamily: "Geist",
            lineHeight: 1,
            letterSpacing: "-0.02em",
          }}
        >
          {count}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "#999999",
            fontFamily: "Geist Mono",
          }}
        >
          {unit}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginTop: 2,
        }}
      >
        <div
          style={{
            width: 5,
            height: 5,
            backgroundColor: PRIMARY,
          }}
        />
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: PRIMARY,
            fontFamily: "Geist Mono",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {size}
        </span>
      </div>
    </div>
  );
}
