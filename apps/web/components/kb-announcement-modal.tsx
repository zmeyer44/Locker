"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Sparkles,
  FileText,
  MessageSquare,
  ArrowRight,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { useWorkspace } from "@/lib/workspace-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog as DialogPrimitive } from "radix-ui";

const STORAGE_KEY = "openstore:kb-announcement-dismissed";

export function KBAnnouncementModal() {
  const [open, setOpen] = useState(false);
  const workspace = useWorkspace();
  const router = useRouter();

  const { data: installedPlugins, isLoading } =
    trpc.plugins.installed.useQuery();

  useEffect(() => {
    if (isLoading) return;

    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed) return;

    const hasKBPlugin = installedPlugins?.some(
      (p) => p.pluginSlug === "knowledge-base",
    );
    if (hasKBPlugin) return;

    // Small delay so the dashboard renders first
    const timer = setTimeout(() => setOpen(true), 800);
    return () => clearTimeout(timer);
  }, [installedPlugins, isLoading]);

  function handleDismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  }

  function handleGetStarted() {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
    router.push(`/w/${workspace.slug}/plugins`);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && handleDismiss()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 sm:max-w-lg",
            "rounded-3xl shadow-2xl outline-none overflow-hidden",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
        >
          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-1.5 text-white/70 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white"
          >
            <X className="size-4" />
          </button>

          {/* Hero section with gradient */}
          <div className="relative bg-gradient-to-br from-primary via-primary/90 to-indigo-600 px-8 pt-10 pb-8 text-white">
            {/* Background decoration */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -top-20 -right-20 size-64 rounded-full bg-white/5 blur-2xl" />
              <div className="absolute -bottom-10 -left-10 size-40 rounded-full bg-white/5 blur-xl" />
              {/* Grid pattern */}
              <svg className="absolute inset-0 h-full w-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <pattern id="kb-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                    <path d="M 32 0 L 0 0 0 32" fill="none" stroke="white" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#kb-grid)" />
              </svg>
            </div>

            <div className="relative">
              {/* Badge */}
              <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium tracking-wide backdrop-blur-sm">
                <Sparkles className="size-3" />
                New Feature
              </div>

              <h2 className="text-2xl font-semibold tracking-tight">
                Knowledge Base
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/80">
                Turn your documents into a living, interlinked wiki — powered
                by AI. Tag your files, ingest them, and chat with your
                knowledge.
              </p>
            </div>
          </div>

          {/* Feature list */}
          <div className="bg-popover px-8 py-6">
            <div className="space-y-4">
              <FeatureRow
                icon={FileText}
                title="Auto-generated wiki pages"
                description="AI reads your documents and builds structured, interlinked markdown pages"
              />
              <FeatureRow
                icon={MessageSquare}
                title="Chat with your knowledge"
                description="Ask questions and get answers grounded in your documents"
              />
              <FeatureRow
                icon={BookOpen}
                title="Compounds over time"
                description="Each new document enriches existing pages — your wiki grows smarter"
              />
            </div>

            {/* Actions */}
            <div className="mt-6 flex items-center gap-3">
              <Button
                onClick={handleGetStarted}
                className="flex-1 gap-2"
              >
                Get Started
                <ArrowRight className="size-3.5" />
              </Button>
              <Button variant="ghost" onClick={handleDismiss}>
                Maybe later
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FeatureRow({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
