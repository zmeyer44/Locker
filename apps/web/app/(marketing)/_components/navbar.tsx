"use client";

import Link from "next/link";
import { Logo } from "@/assets/logo";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { MenuIcon, XIcon } from "lucide-react";
import { useSession } from "@/lib/auth/client";

const navItems = [
  { label: "Features", href: "#features" },
  { label: "Storage", href: "#storage" },
  { label: "FAQ", href: "#faq" },
];

export function Navbar() {
  const { data: session } = useSession();
  const [hasScrolled, setHasScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let ticking = false;
    const updateScrollState = () => {
      setHasScrolled(window.scrollY > 50);
      ticking = false;
    };
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(updateScrollState);
        ticking = true;
      }
    };

    // Check initial scroll position (e.g. back/forward navigation on mobile)
    updateScrollState();

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 z-50">
      <div className="px-4 md:px-5 lg:px-14">
        <div className="mx-auto w-full max-w-7xl">
          <div className="relative flex w-full pt-4 md:pt-5">
            <nav
              className={cn(
                "flex w-full flex-1 items-center justify-between border rounded-xl  transition-all duration-300",
                hasScrolled
                  ? "mx-auto max-w-4xl border-border/50 bg-background/80 p-1 pl-5 shadow-sm"
                  : "border-transparent bg-transparent shadow-none",
              )}
            >
              {/* Left */}
              <div className="flex items-center gap-8">
                <Link href="/" className="flex items-center gap-2.5">
                  <Logo
                    className={cn(
                      "size-7 transition-colors",
                      hasScrolled ? "text-primary" : "text-primary-foreground",
                    )}
                  />
                  <span
                    className={cn(
                      "text-lg font-semibold tracking-tight transition-colors",
                      hasScrolled
                        ? "text-foreground"
                        : "text-primary-foreground",
                    )}
                  >
                    Locker
                  </span>
                </Link>

                <div className="hidden items-center gap-1 lg:flex">
                  {navItems.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        hasScrolled
                          ? "text-muted-foreground hover:text-foreground"
                          : "text-primary-foreground/70 hover:text-primary-foreground",
                      )}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>

              {/* Right */}
              <div className="flex items-center gap-2">
                {session ? (
                  <Link href="/home">
                    <Button size="sm" className="rounded-lg">
                      Dashboard
                    </Button>
                  </Link>
                ) : (
                  <>
                    <Link href="/login" className="hidden sm:block">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "rounded-lg",
                          !hasScrolled &&
                            "text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground",
                        )}
                      >
                        Sign in
                      </Button>
                    </Link>
                    <Link href="/register">
                      <Button size="sm" className="rounded-lg">
                        Get Started
                      </Button>
                    </Link>
                  </>
                )}
                <button
                  type="button"
                  className={cn(
                    "ml-1 rounded-lg p-2 lg:hidden",
                    hasScrolled
                      ? "text-foreground hover:bg-muted"
                      : "text-primary-foreground hover:bg-white/10",
                  )}
                  onClick={() => setMobileOpen(!mobileOpen)}
                >
                  {mobileOpen ? (
                    <XIcon className="size-5" />
                  ) : (
                    <MenuIcon className="size-5" />
                  )}
                </button>
              </div>
            </nav>
          </div>

          {/* Mobile menu */}
          {mobileOpen && (
            <div className="mt-2 rounded-xl border border-border/50 bg-background/95 p-4 shadow-lg backdrop-blur-xl lg:hidden">
              {navItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
              {session ? (
                <Link
                  href="/home"
                  className="mt-2 block rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
                  onClick={() => setMobileOpen(false)}
                >
                  Dashboard
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="mt-2 block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted sm:hidden"
                  onClick={() => setMobileOpen(false)}
                >
                  Sign in
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
