"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { trpc } from "@/lib/trpc/client";
import dynamic from "next/dynamic";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ModalProvider } from "@/components/modal/provider";

const GoogleAnalytics = dynamic(
  () =>
    import("@/lib/analytics/google-analytics").then(
      (mod) => mod.GoogleAnalytics,
    ),
  { ssr: false },
);

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function getWorkspaceSlug(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/w\/([^/]+)/);
  return match?.[1] ?? null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 30,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
          headers() {
            const slug = getWorkspaceSlug();
            return slug ? { "x-workspace-slug": slug } : {};
          },
        }),
      ],
    }),
  );

  return (
    <NuqsAdapter>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <ModalProvider>
              <TooltipProvider delayDuration={150}>
                {children}
                <Toaster position="bottom-right" />
              </TooltipProvider>
            </ModalProvider>
            <GoogleAnalytics />
          </QueryClientProvider>
        </trpc.Provider>
      </ThemeProvider>
    </NuqsAdapter>
  );
}
