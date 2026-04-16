"use client";

import { useEffect, useMemo } from "react";
import { useTheme } from "next-themes";
import type { WorkspaceThemeConfig } from "@/lib/theme-presets";
import {
  buildThemeCssVars,
  getFont,
  getGoogleFontUrls,
  DEFAULT_THEME_CONFIG,
} from "@/lib/theme-presets";

export function WorkspaceThemeStyle({
  themeConfig,
}: {
  themeConfig: Partial<WorkspaceThemeConfig> | null;
}) {
  const { resolvedTheme } = useTheme();

  const config = useMemo<WorkspaceThemeConfig>(
    () => ({ ...DEFAULT_THEME_CONFIG, ...themeConfig }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(themeConfig)],
  );

  const { light, dark } = useMemo(() => buildThemeCssVars(config), [config]);

  // Load Google Fonts
  useEffect(() => {
    const urls = getGoogleFontUrls(config);
    const links: HTMLLinkElement[] = [];

    for (const url of urls) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.dataset.workspaceFont = "true";
      document.head.appendChild(link);
      links.push(link);
    }

    return () => {
      for (const link of links) link.remove();
    };
  }, [config]);

  // Apply CSS variables and font overrides
  useEffect(() => {
    const root = document.documentElement;
    const vars = root.classList.contains("dark") ? dark : light;

    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(`--${key}`, value);
    }

    // Apply font overrides
    const bodyFont = getFont(config.bodyFont);
    if (bodyFont && bodyFont.name !== "geist") {
      root.style.setProperty("--font-sans", bodyFont.family);
    }

    if (config.headingFont !== "inherit") {
      const headingFont = getFont(config.headingFont);
      if (headingFont) {
        root.style.setProperty("--font-heading", headingFont.family);
      }
    }

    return () => {
      for (const key of Object.keys(vars)) {
        root.style.removeProperty(`--${key}`);
      }
      root.style.removeProperty("--font-sans");
      root.style.removeProperty("--font-heading");
    };
  }, [config, resolvedTheme, light, dark]);

  return null;
}
