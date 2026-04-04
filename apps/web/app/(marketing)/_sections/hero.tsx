"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FolderSvg } from "../_components/folder-svg";
import Link from "next/link";
import { GITHUB_URL } from "@/constants/app";
import { ArrowRightIcon } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Mini window chrome — lightweight card with dot header              */
/* ------------------------------------------------------------------ */

function MiniWindow({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-white/[0.08] bg-mkt-dark-secondary",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
        <span className="size-[7px] rounded-full bg-white/10" />
        <span className="size-[7px] rounded-full bg-white/10" />
        <span className="size-[7px] rounded-full bg-white/10" />
        {title && (
          <span className="ml-1.5 font-mono text-[9px] font-medium text-white/30">
            {title}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Floating product elements                                          */
/* ------------------------------------------------------------------ */

const fileRows = [
  {
    icon: "dir",
    name: "Design Assets",
    size: "—",
    modified: "2 hours ago",
  },
  {
    icon: "dir",
    name: "Client Deliverables",
    size: "—",
    modified: "Yesterday",
  },
  {
    icon: "pdf",
    name: "Q1-Report-Final.pdf",
    size: "4.2 MB",
    modified: "Mar 28",
  },
  {
    icon: "img",
    name: "hero-banner.png",
    size: "1.8 MB",
    modified: "Mar 26",
  },
  {
    icon: "doc",
    name: "meeting-notes.md",
    size: "12 KB",
    modified: "Mar 25",
  },
];

function FileIcon({ type }: { type: string }) {
  const colors: Record<string, string> = {
    dir: "text-primary bg-primary/15",
    pdf: "text-red-400 bg-red-400/15",
    img: "text-emerald-400 bg-emerald-400/15",
    doc: "text-blue-400 bg-blue-400/15",
  };
  const labels: Record<string, string> = {
    dir: "D",
    pdf: "P",
    img: "I",
    doc: "M",
  };
  return (
    <span
      className={cn(
        "flex size-[18px] items-center justify-center rounded font-mono text-[8px] font-bold",
        colors[type],
      )}
    >
      {labels[type]}
    </span>
  );
}

function FloatingElements() {
  return (
    <>
      <style>{`
        @keyframes heroFloatIn {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes heroSlideRight {
          from { opacity: 0; transform: translateX(-14px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes heroProgress {
          0%   { width: 0%; }
          60%  { width: 78%; }
          100% { width: 100%; }
        }
        @keyframes heroPulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
        @keyframes heroCheckIn {
          0%   { opacity: 0; transform: scale(0.5); }
          60%  { opacity: 1; transform: scale(1.15); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes heroToast {
          from { opacity: 0; transform: translateY(8px) translateX(8px); }
          to   { opacity: 1; transform: translateY(0) translateX(0); }
        }
        @keyframes heroTagReveal {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        .hero-card {
          opacity: 0;
          animation: heroFloatIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .hero-slide {
          opacity: 0;
          animation: heroSlideRight 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .hero-tag {
          opacity: 0;
          animation: heroTagReveal 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .hero-toast {
          opacity: 0;
          animation: heroToast 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      <div
        className="relative mx-auto h-full w-full max-w-[500px] lg:max-w-none"
        aria-hidden="true"
      >
        {/* ── File Explorer card ── */}
        <div
          className="hero-card absolute left-0 top-[10px] w-[300px]"
          style={{ animationDelay: "0.2s" }}
        >
          <MiniWindow title="Files">
            {/* Breadcrumb */}
            <div className="border-b border-white/[0.06] px-3 py-1.5">
              <div className="flex items-center gap-1 font-mono text-[9px]">
                <span className="text-white/30">workspace</span>
                <span className="text-white/20">/</span>
                <span className="text-white/50">Projects</span>
              </div>
            </div>

            {/* Header row */}
            <div className="grid grid-cols-[1.6fr_0.7fr_0.8fr] gap-2 border-b border-white/[0.06] bg-white/[0.02] px-3 py-1.5">
              {["NAME", "SIZE", "MODIFIED"].map((h) => (
                <div
                  key={h}
                  className="font-mono text-[7px] font-bold uppercase tracking-[0.08em] text-white/25"
                >
                  {h}
                </div>
              ))}
            </div>

            {/* File rows */}
            {fileRows.map((f, i) => (
              <div
                key={f.name}
                className="hero-slide grid grid-cols-[1.6fr_0.7fr_0.8fr] items-center gap-2 border-b border-white/[0.04] px-3 py-1.5 last:border-b-0"
                style={{ animationDelay: `${0.6 + i * 0.12}s` }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileIcon type={f.icon} />
                  <span className="truncate font-mono text-[9px] font-medium text-white/70">
                    {f.name}
                  </span>
                </div>
                <span className="font-mono text-[8px] text-white/30 tabular-nums">
                  {f.size}
                </span>
                <span className="font-mono text-[8px] text-white/30">
                  {f.modified}
                </span>
              </div>
            ))}
          </MiniWindow>
        </div>

        {/* ── Share Link card ── */}
        <div
          className="hero-card absolute left-[318px] top-[14px] w-[185px]"
          style={{ animationDelay: "0.9s" }}
        >
          <MiniWindow title="Share">
            <div className="p-3 space-y-2.5">
              <div className="font-mono text-[8px] font-bold uppercase tracking-[0.08em] text-white/30">
                Share Link
              </div>
              <div className="flex items-center gap-1.5 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1.5">
                <span className="truncate font-mono text-[8px] text-primary/80">
                  lckr.sh/s/a8x2k
                </span>
              </div>

              <div className="space-y-1.5">
                {[
                  { label: "Password", value: "Enabled" },
                  { label: "Expires", value: "7 days" },
                  { label: "Downloads", value: "3 / 10" },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between"
                  >
                    <span className="font-mono text-[8px] text-white/30">
                      {row.label}
                    </span>
                    <span className="font-mono text-[8px] font-medium text-white/60">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </MiniWindow>
        </div>

        {/* ── Upload Progress card ── */}
        <div
          className="hero-card absolute left-[40px] top-[280px] w-[260px]"
          style={{ animationDelay: "1.4s" }}
        >
          <MiniWindow title="Upload">
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[10px] font-medium text-white/70">
                    brand-guidelines-v2.pdf
                  </div>
                  <div className="mt-0.5 font-mono text-[8px] text-white/30">
                    18.4 MB &middot; PDF document
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-[3px] border border-emerald-400/50 px-1.5 py-0.5 font-mono text-[7px] font-bold uppercase tracking-[0.04em] text-emerald-400">
                  <span
                    className="size-[4px] bg-emerald-400"
                    style={{
                      animation: "heroPulse 1.2s ease-in-out 3",
                      animationDelay: "2s",
                    }}
                  />
                  DONE
                </span>
              </div>
              <div className="h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-emerald-400"
                  style={{
                    animation:
                      "heroProgress 2s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                    animationDelay: "1.6s",
                    width: "0%",
                  }}
                />
              </div>
            </div>
          </MiniWindow>
        </div>

        {/* ── Storage Usage toast ── */}
        <div
          className="hero-toast absolute left-[318px] top-[270px] w-[185px] overflow-hidden rounded-lg border border-white/[0.08] bg-mkt-dark-secondary"
          style={{ animationDelay: "2.2s" }}
        >
          <div className="p-3 space-y-2">
            <div className="font-mono text-[8px] font-bold uppercase tracking-[0.08em] text-white/30">
              Storage
            </div>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-[20px] font-bold tracking-tight text-white/90">
                24.6
              </span>
              <span className="font-mono text-[9px] text-white/30">
                / 50 GB
              </span>
            </div>
            <div className="h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: "49%" }}
              />
            </div>
            <div className="flex items-center justify-between font-mono text-[7px] text-white/25">
              <span>S3 &middot; us-east-1</span>
              <span>49% used</span>
            </div>
          </div>
        </div>

        {/* ── Terminal card ── */}
        <div
          className="hero-card absolute left-[20px] top-[400px] w-[340px]"
          style={{ animationDelay: "2.0s" }}
        >
          <MiniWindow title="Terminal">
            <div className="p-3 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[8px] font-bold text-primary">
                  $
                </span>
                <span className="font-mono text-[9px] text-white/60">
                  ls Projects/
                </span>
              </div>
              <div className="font-mono text-[8px] leading-relaxed text-white/35 pl-3">
                Design Assets/&nbsp;&nbsp;Client Deliverables/
                <br />
                Q1-Report-Final.pdf&nbsp;&nbsp;hero-banner.png
                <br />
                meeting-notes.md
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="font-mono text-[8px] font-bold text-primary">
                  $
                </span>
                <span className="font-mono text-[9px] text-white/60">
                  cat meeting-notes.md | head -3
                </span>
              </div>
              <div className="font-mono text-[8px] leading-relaxed text-white/35 pl-3">
                # Team Sync — March 25
                <br />
                - Finalize Q1 deliverables
                <br />- Review storage migration plan
              </div>
            </div>
          </MiniWindow>
        </div>

        {/* ── Provider tags ── */}
        <div className="absolute left-[10px] top-[375px] flex items-center gap-1.5">
          {[
            { prefix: "ENV", label: "s3" },
            { prefix: "RGN", label: "us-east-1" },
            { prefix: "BKT", label: "locker-prod" },
          ].map((t, i) => (
            <div key={t.prefix} className="flex items-center gap-1.5">
              <span
                className="hero-tag inline-flex items-center gap-1 border border-white/[0.08] bg-mkt-dark-secondary px-1.5 py-0.5 font-mono text-[7px]"
                style={{ animationDelay: `${2.6 + i * 0.12}s` }}
              >
                <span className="font-bold text-primary">{t.prefix}</span>
                <span className="text-white/40">{t.label}</span>
              </span>
              {i < 2 && (
                <span
                  className="hero-tag font-mono text-[9px] text-white/15"
                  style={{ animationDelay: `${2.66 + i * 0.12}s` }}
                >
                  &rarr;
                </span>
              )}
            </div>
          ))}
        </div>

        {/* ── Decorative crosses ── */}
        {[
          { pos: "top-[60px] left-[270px]", delay: "0.4s" },
          { pos: "top-[250px] left-[480px]", delay: "1.0s" },
          { pos: "top-[520px] left-[380px]", delay: "1.8s" },
          { pos: "top-[30px] left-[150px]", delay: "0.6s" },
          { pos: "top-[350px] left-[0px]", delay: "2.2s" },
        ].map((d, i) => (
          <span
            key={i}
            className={cn(
              "hero-tag pointer-events-none absolute select-none text-[14px] font-light text-white/[0.08]",
              d.pos,
            )}
            style={{ animationDelay: d.delay }}
          >
            +
          </span>
        ))}

        {/* ── Decorative dots ── */}
        {[
          { pos: "top-[140px] left-[0px]", delay: "0.5s" },
          { pos: "top-[260px] left-[15px]", delay: "1.4s" },
          { pos: "top-[440px] left-[490px]", delay: "2.0s" },
          { pos: "top-[20px] left-[480px]", delay: "0.9s" },
        ].map((d, i) => (
          <div
            key={i}
            className={cn(
              "hero-tag pointer-events-none absolute size-[4px] rounded-full bg-white/[0.08]",
              d.pos,
            )}
            style={{ animationDelay: d.delay }}
          />
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero section                                                       */
/* ------------------------------------------------------------------ */

export function Hero() {
  return (
    <section className="relative flex flex-col overflow-hidden bg-mkt-dark">
      {/* Background grid */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 hidden lg:block"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 30%, var(--mkt-dark) 75%)",
        }}
      />
      {/* Ambient gradient orbs */}
      <div
        className="pointer-events-none absolute left-[8%] top-[12%] h-[500px] w-[500px] rounded-full bg-primary/[0.06] blur-[120px] lg:bg-primary/[0.12]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-[18%] right-[12%] h-[400px] w-[400px] rounded-full bg-violet-500/[0.04] blur-[100px] lg:bg-violet-500/[0.08]"
        aria-hidden="true"
      />

      {/* Two-column hero */}
      <div className="relative mx-auto my-10 grid w-full max-w-[1280px] grid-cols-1 gap-x-4 px-4 lg:my-16 lg:grid-cols-2 lg:gap-x-6 lg:px-9 lg:min-h-[550px] lg:max-h-[725px]">
        {/* Left — text content */}
        <div className="z-10 col-span-full flex flex-col justify-center lg:col-span-1">
          <div className="flex flex-col gap-y-5 lg:gap-y-7">
            {/* Badge */}
            <div className="flex">
              <div
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5",
                  "border border-white/[0.09] bg-white/[0.05]",
                )}
              >
                <div className="size-[6px] rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono text-[11px] font-medium text-white/60">
                  Open Source
                </span>
              </div>
            </div>

            {/* Headline */}
            <h1 className="text-[clamp(2.5rem,5.5vw,4rem)] font-semibold leading-[1] tracking-[-0.04em] text-white">
              Your files, Your cloud,
              <br />
              Your rules.
            </h1>

            {/* Sub-headline */}
            <p className="text-[17px] leading-[1.55] text-white/50 lg:max-w-[420px]">
              The self-hostable alternative to Dropbox and Google Drive. Upload,
              organize, and share files from your own infrastructure.
            </p>

            {/* Body detail */}
            <p className="font-mono text-[13px] leading-[1.65] text-white/30 lg:max-w-[420px]">
              Bring your own storage — local disk, S3, R2, or Vercel Blob. One
              env var to switch. Full type-safe API with tRPC.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/register">
                <Button size="lg" className="rounded-lg">
                  Get Started
                  <ArrowRightIcon className="ml-1 size-4" />
                </Button>
              </Link>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                <Button
                  variant="outline"
                  size="lg"
                  className="rounded-lg border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white"
                >
                  View on GitHub
                </Button>
              </a>
            </div>
          </div>
        </div>

        {/* Right — floating product elements */}
        <div className="pointer-events-none relative z-0 col-span-full mt-8 aspect-[3/2] w-full overflow-hidden lg:pointer-events-auto lg:col-span-1 lg:mt-0 lg:aspect-auto lg:w-[clamp(500px,50vw,700px)] lg:max-w-none">
          <FloatingElements />
        </div>
      </div>

      {/* Folder tab section divider */}
      <div className="relative w-full text-background">
        <div className="absolute bottom-0 left-0 right-0 grid">
          <div className="col-span-full flex flex-col justify-start">
            <div className="mx-auto w-full max-w-5xl">
              <FolderSvg className="ml-0 text-primary" />
            </div>
            <div className="h-4 w-full bg-primary" />
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 grid">
          <div className="col-span-full flex flex-col justify-start">
            <div className="mx-auto w-full max-w-5xl">
              <FolderSvg className="ml-[50px] text-blue-400" />
            </div>
            <div className="h-2 w-full bg-blue-400" />
          </div>
        </div>
        <div className="relative grid">
          <div className="col-span-full mx-auto flex w-full max-w-5xl justify-start">
            <FolderSvg className="ml-[100px] text-background" />
          </div>
        </div>
      </div>
    </section>
  );
}
