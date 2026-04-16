"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Loader2,
  RotateCcw,
  Shuffle,
  Sun,
  Moon,
  Bell,
  Users,
  Activity,
  DollarSign,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  FileText,
  FolderOpen,
  Share2,
  Upload,
} from "lucide-react";
import { useTheme } from "next-themes";
import { trpc } from "@/lib/trpc/client";
import { useWorkspace } from "@/lib/workspace-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  Area,
  AreaChart,
  Pie,
  PieChart,
  Cell,
} from "recharts";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  BASE_COLORS,
  ACCENT_COLORS,
  RADII,
  FONTS,
  HEADING_FONT_OPTIONS,
  MENU_COLORS,
  MENU_ACCENTS,
  THEME_PRESETS,
  DEFAULT_THEME_CONFIG,
  buildThemeCssVars,
  getFont,
  getGoogleFontUrls,
  getRandomThemeConfig,
  type WorkspaceThemeConfig,
} from "@/lib/theme-presets";

// ── Color select item with swatch ───────────────────────────────────────────

function ColorSelectItem({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color: string;
}) {
  return (
    <SelectItem value={value}>
      <span className="flex items-center gap-2">
        <span
          className="size-3 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        {label}
      </span>
    </SelectItem>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function AppearancePage() {
  const workspace = useWorkspace();
  const { data } = trpc.workspaces.get.useQuery({ slug: workspace.slug });
  const { setTheme, resolvedTheme } = useTheme();
  const utils = trpc.useUtils();

  const savedConfig: WorkspaceThemeConfig = {
    ...DEFAULT_THEME_CONFIG,
    ...data?.themeConfig,
  };

  const [baseColor, setBaseColor] = useState(savedConfig.baseColor);
  const [accentColor, setAccentColor] = useState(savedConfig.accentColor);
  const [radius, setRadius] = useState(savedConfig.radius);
  const [chartColor, setChartColor] = useState(savedConfig.chartColor);
  const [bodyFont, setBodyFont] = useState(savedConfig.bodyFont);
  const [headingFont, setHeadingFont] = useState(savedConfig.headingFont);
  const [menuColor, setMenuColor] = useState(savedConfig.menuColor);
  const [menuAccent, setMenuAccent] = useState(savedConfig.menuAccent);

  useEffect(() => {
    if (data?.themeConfig) {
      const c = { ...DEFAULT_THEME_CONFIG, ...data.themeConfig };
      setBaseColor(c.baseColor);
      setAccentColor(c.accentColor);
      setRadius(c.radius);
      setChartColor(c.chartColor);
      setBodyFont(c.bodyFont);
      setHeadingFont(c.headingFont);
      setMenuColor(c.menuColor);
      setMenuAccent(c.menuAccent);
    }
  }, [data?.themeConfig]);

  const currentConfig: WorkspaceThemeConfig = useMemo(
    () => ({ baseColor, accentColor, radius, chartColor, bodyFont, headingFont, menuColor, menuAccent }),
    [baseColor, accentColor, radius, chartColor, bodyFont, headingFont, menuColor, menuAccent],
  );

  const hasChanges =
    baseColor !== savedConfig.baseColor ||
    accentColor !== savedConfig.accentColor ||
    radius !== savedConfig.radius ||
    chartColor !== savedConfig.chartColor ||
    bodyFont !== savedConfig.bodyFont ||
    headingFont !== savedConfig.headingFont ||
    menuColor !== savedConfig.menuColor ||
    menuAccent !== savedConfig.menuAccent;

  // Load Google Fonts for live preview
  useEffect(() => {
    const urls = getGoogleFontUrls(currentConfig);
    const links: HTMLLinkElement[] = [];
    for (const url of urls) {
      const existing = document.querySelector(`link[href="${url}"]`);
      if (existing) continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.dataset.previewFont = "true";
      document.head.appendChild(link);
      links.push(link);
    }
    return () => {
      for (const link of links) link.remove();
    };
  }, [currentConfig.bodyFont, currentConfig.headingFont]);

  // Live-preview: apply CSS vars and font overrides
  useEffect(() => {
    const root = document.documentElement;
    const isDark = root.classList.contains("dark");
    const { light, dark } = buildThemeCssVars(currentConfig);
    const vars = isDark ? dark : light;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(`--${key}`, value);
    }
    // Font overrides
    const body = getFont(currentConfig.bodyFont);
    if (body && body.name !== "geist") {
      root.style.setProperty("--font-sans", body.family);
    } else {
      root.style.removeProperty("--font-sans");
    }
    if (currentConfig.headingFont !== "inherit") {
      const heading = getFont(currentConfig.headingFont);
      if (heading) {
        root.style.setProperty("--font-heading", heading.family);
      }
    } else {
      root.style.removeProperty("--font-heading");
    }
    // Cleanup: remove preview vars so they don't leak when navigating away
    return () => {
      for (const key of Object.keys(vars)) {
        root.style.removeProperty(`--${key}`);
      }
      root.style.removeProperty("--font-sans");
      root.style.removeProperty("--font-heading");
    };
  }, [currentConfig, resolvedTheme]);

  const update = trpc.workspaces.update.useMutation({
    onSuccess: () => {
      utils.workspaces.get.invalidate();
      toast.success("Theme saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSave = () => {
    // Values come from our constant arrays so the cast is safe
    update.mutate({ themeConfig: currentConfig as Parameters<typeof update.mutate>[0]["themeConfig"] });
  };

  const applyConfig = useCallback((config: WorkspaceThemeConfig) => {
    setBaseColor(config.baseColor);
    setAccentColor(config.accentColor);
    setRadius(config.radius);
    setChartColor(config.chartColor);
    setBodyFont(config.bodyFont);
    setHeadingFont(config.headingFont);
    setMenuColor(config.menuColor);
    setMenuAccent(config.menuAccent);
  }, []);

  const handleReset = () => {
    applyConfig(savedConfig);
  };

  const handleShuffle = () => {
    applyConfig(getRandomThemeConfig());
  };

  const handlePreset = (presetName: string) => {
    const preset = THEME_PRESETS.find((p) => p.name === presetName);
    if (preset) applyConfig(preset.config);
  };

  const currentBase = BASE_COLORS.find((c) => c.name === baseColor);
  const currentAccent = ACCENT_COLORS.find((c) => c.name === accentColor);
  const currentRadius = RADII.find((r) => r.name === radius);
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";

  return (
    <div className="flex h-full">
      {/* ── Dark sidebar ──────────────────────────────────────────────── */}
      <div className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-3">
          <span className="text-sm font-semibold">Appearance</span>
          <button
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
            className="rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            title="Toggle dark mode"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </button>
        </div>

        {/* Scrollable controls */}
        <div className="flex-1 overflow-y-auto py-2">
          {/* Base Color */}
          <div className="px-3 pb-2">
            <span className="mb-1 block text-xs text-sidebar-foreground/60">
              Base Color
            </span>
            <Select
              value={baseColor}
              onValueChange={(val) => isAdmin && setBaseColor(val)}
              disabled={!isAdmin}
            >
              <SelectTrigger className="h-8 border-sidebar-border bg-sidebar-accent text-xs text-sidebar-foreground focus:ring-sidebar-ring">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BASE_COLORS.map((color) => (
                  <ColorSelectItem
                    key={color.name}
                    value={color.name}
                    label={color.title}
                    color={color.cssVars.light.foreground}
                  />
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="my-1 border-t border-sidebar-border" />

          {/* Accent Color */}
          <div className="px-3 pb-2">
            <span className="mb-1 block text-xs text-sidebar-foreground/60">
              Accent Color
            </span>
            <Select
              value={accentColor}
              onValueChange={(val) => isAdmin && setAccentColor(val)}
              disabled={!isAdmin}
            >
              <SelectTrigger className="h-8 border-sidebar-border bg-sidebar-accent text-xs text-sidebar-foreground focus:ring-sidebar-ring">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCENT_COLORS.map((color) => (
                  <ColorSelectItem
                    key={color.name}
                    value={color.name}
                    label={color.title}
                    color={color.cssVars.light.primary}
                  />
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="my-1 border-t border-sidebar-border" />

          {/* Radius */}
          <div className="px-3 pb-2">
            <span className="mb-1 block text-xs text-sidebar-foreground/60">Radius</span>
            <Select
              value={radius}
              onValueChange={(val) => isAdmin && setRadius(val)}
              disabled={!isAdmin}
            >
              <SelectTrigger className="h-8 border-sidebar-border bg-sidebar-accent text-xs text-sidebar-foreground focus:ring-sidebar-ring">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RADII.map((r) => (
                  <SelectItem key={r.name} value={r.name}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="my-1 border-t border-sidebar-border" />

          {/* Chart Color */}
          <div className="px-3 pb-2">
            <span className="mb-1 block text-xs text-sidebar-foreground/60">
              Chart Color
            </span>
            <Select
              value={chartColor}
              onValueChange={(val) => isAdmin && setChartColor(val)}
              disabled={!isAdmin}
            >
              <SelectTrigger className="h-8 border-sidebar-border bg-sidebar-accent text-xs text-sidebar-foreground focus:ring-sidebar-ring">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCENT_COLORS.map((color) => (
                  <ColorSelectItem
                    key={color.name}
                    value={color.name}
                    label={color.title}
                    color={color.cssVars.light.primary}
                  />
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="my-1 border-t border-sidebar-border" />

          {/* Heading Font */}
          <div className="px-3 pb-2">
            <span className="mb-1 block text-xs text-sidebar-foreground/60">Heading</span>
            <Select
              value={headingFont}
              onValueChange={(val) => isAdmin && setHeadingFont(val)}
              disabled={!isAdmin}
            >
              <SelectTrigger className="h-8 border-sidebar-border bg-sidebar-accent text-xs text-sidebar-foreground focus:ring-sidebar-ring">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HEADING_FONT_OPTIONS.map((f) => (
                  <SelectItem key={f.name} value={f.name}>
                    {f.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Body Font */}
          <div className="px-3 pb-2">
            <span className="mb-1 block text-xs text-sidebar-foreground/60">Font</span>
            <Select
              value={bodyFont}
              onValueChange={(val) => isAdmin && setBodyFont(val)}
              disabled={!isAdmin}
            >
              <SelectTrigger className="h-8 border-sidebar-border bg-sidebar-accent text-xs text-sidebar-foreground focus:ring-sidebar-ring">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONTS.map((f) => (
                  <SelectItem key={f.name} value={f.name}>
                    {f.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="my-1 border-t border-sidebar-border" />

          {/* Menu Color */}
          <div className="px-3 pb-2">
            <span className="mb-1 block text-xs text-sidebar-foreground/60">Menu</span>
            <Select
              value={menuColor}
              onValueChange={(val) => {
                if (!isAdmin) return;
                setMenuColor(val);
                // Bold accent is not compatible with translucent
                if (
                  (val === "default-translucent" ||
                    val === "inverted-translucent") &&
                  menuAccent === "bold"
                ) {
                  setMenuAccent("subtle");
                }
              }}
              disabled={!isAdmin}
            >
              <SelectTrigger className="h-8 border-sidebar-border bg-sidebar-accent text-xs text-sidebar-foreground focus:ring-sidebar-ring">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MENU_COLORS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Menu Accent */}
          <div className="px-3 pb-2">
            <span className="mb-1 block text-xs text-sidebar-foreground/60">
              Menu Accent
            </span>
            <Select
              value={menuAccent}
              onValueChange={(val) => isAdmin && setMenuAccent(val)}
              disabled={!isAdmin}
            >
              <SelectTrigger className="h-8 border-sidebar-border bg-sidebar-accent text-xs text-sidebar-foreground focus:ring-sidebar-ring">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MENU_ACCENTS.map((a) => (
                  <SelectItem
                    key={a.value}
                    value={a.value}
                    disabled={
                      a.value === "bold" &&
                      (menuColor === "default-translucent" ||
                        menuColor === "inverted-translucent")
                    }
                  >
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-col gap-2 border-t border-sidebar-border p-3">
          {/* Preset selector */}
          <Select onValueChange={handlePreset}>
            <SelectTrigger className="h-8 border-sidebar-border bg-sidebar-accent text-xs text-sidebar-foreground focus:ring-sidebar-ring">
              <SelectValue placeholder="Open Preset" />
            </SelectTrigger>
            <SelectContent>
              {THEME_PRESETS.map((preset) => (
                <SelectItem key={preset.name} value={preset.name}>
                  {preset.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={handleShuffle}
            disabled={!isAdmin}
            className="w-full border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground"
          >
            <Shuffle className="mr-1.5 size-3.5" />
            Shuffle
          </Button>

          {hasChanges && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="flex-1 border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground"
              >
                <RotateCcw className="mr-1 size-3.5" />
                Reset
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={update.isPending}
                className="flex-1"
              >
                {update.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Preview area ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-background p-6">
        <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-3">
          {/* ── Stat cards ──────────────────────────────────────────── */}
          {[
            { title: "Total Revenue", value: "$45,231", change: "+20.1%", up: true, icon: DollarSign },
            { title: "Active Users", value: "2,350", change: "+180.1%", up: true, icon: Users },
            { title: "Bounce Rate", value: "12.5%", change: "-4.3%", up: false, icon: Activity },
          ].map((s) => (
            <Card key={s.title} size="sm">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium">{s.title}</CardTitle>
                <s.icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="mt-1 flex items-center gap-1 text-xs">
                  {s.up ? (
                    <ArrowUpRight className="size-3 text-chart-1" />
                  ) : (
                    <ArrowDownRight className="size-3 text-destructive" />
                  )}
                  <span className={s.up ? "text-chart-1" : "text-destructive"}>
                    {s.change}
                  </span>
                  <span className="text-muted-foreground">vs last month</span>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* ── Bar chart (uses chart-1..5) ─────────────────────────── */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Monthly Uploads</CardTitle>
              <CardDescription>
                Last 6 months of file activity
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={{
                  uploads: { label: "Uploads", color: "var(--chart-1)" },
                  downloads: { label: "Downloads", color: "var(--chart-2)" },
                }}
                className="h-48 w-full"
              >
                <BarChart
                  data={[
                    { month: "Jan", uploads: 186, downloads: 80 },
                    { month: "Feb", uploads: 305, downloads: 200 },
                    { month: "Mar", uploads: 237, downloads: 120 },
                    { month: "Apr", uploads: 473, downloads: 190 },
                    { month: "May", uploads: 209, downloads: 130 },
                    { month: "Jun", uploads: 384, downloads: 250 },
                  ]}
                >
                  <CartesianGrid vertical={false} className="stroke-border" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} className="text-xs fill-muted-foreground" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="uploads" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="downloads" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* ── Donut chart (uses all 5 chart colors) ───────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Storage by Type</CardTitle>
              <CardDescription>File distribution</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={{
                  documents: { label: "Documents", color: "var(--chart-1)" },
                  images: { label: "Images", color: "var(--chart-2)" },
                  videos: { label: "Videos", color: "var(--chart-3)" },
                  audio: { label: "Audio", color: "var(--chart-4)" },
                  other: { label: "Other", color: "var(--chart-5)" },
                }}
                className="mx-auto h-40 w-full"
              >
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Pie
                    data={[
                      { name: "documents", value: 42 },
                      { name: "images", value: 28 },
                      { name: "videos", value: 15 },
                      { name: "audio", value: 9 },
                      { name: "other", value: 6 },
                    ]}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="85%"
                    strokeWidth={2}
                    stroke="var(--background)"
                  >
                    <Cell fill="var(--chart-1)" />
                    <Cell fill="var(--chart-2)" />
                    <Cell fill="var(--chart-3)" />
                    <Cell fill="var(--chart-4)" />
                    <Cell fill="var(--chart-5)" />
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { label: "Documents", color: "bg-chart-1" },
                  { label: "Images", color: "bg-chart-2" },
                  { label: "Videos", color: "bg-chart-3" },
                  { label: "Audio", color: "bg-chart-4" },
                  { label: "Other", color: "bg-chart-5" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-1.5">
                    <span className={cn("size-2 rounded-full", item.color)} />
                    <span className="text-xs text-muted-foreground">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── Form card ────────────────────────────────────────────── */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Create Project</CardTitle>
              <CardDescription>
                Deploy a new project in one click.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input placeholder="My project" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Framework</label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="next">Next.js</SelectItem>
                      <SelectItem value="remix">Remix</SelectItem>
                      <SelectItem value="astro">Astro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline">Cancel</Button>
              <Button>Deploy</Button>
            </CardFooter>
          </Card>

          {/* ── Notifications ─────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>3 unread</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { title: "Upload complete", desc: "report.pdf", initials: "JD", icon: Upload },
                  { title: "Folder shared", desc: "Q4 Reports", initials: "AK", icon: Share2 },
                  { title: "Storage warning", desc: "80% used", initials: "SY", icon: Activity },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback className="text-xs">
                        {item.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-0.5">
                      <p className="text-sm font-medium leading-none">
                        {item.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="w-full" size="sm">
                <Bell className="mr-1.5 size-3.5" />
                Mark all as read
              </Button>
            </CardFooter>
          </Card>

          {/* ── Area chart (trend line with chart-3) ──────────────────── */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Workspace Activity</CardTitle>
                <CardDescription>Daily active users</CardDescription>
              </div>
              <Badge variant="secondary" className="gap-1">
                <TrendingUp className="size-3" />
                +12%
              </Badge>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={{
                  users: { label: "Users", color: "var(--chart-3)" },
                }}
                className="h-36 w-full"
              >
                <AreaChart
                  data={[
                    { day: "Mon", users: 120 },
                    { day: "Tue", users: 180 },
                    { day: "Wed", users: 150 },
                    { day: "Thu", users: 280 },
                    { day: "Fri", users: 320 },
                    { day: "Sat", users: 190 },
                    { day: "Sun", users: 240 },
                  ]}
                >
                  <CartesianGrid vertical={false} className="stroke-border" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} className="text-xs fill-muted-foreground" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <defs>
                    <linearGradient id="fillUsers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <Area
                    dataKey="users"
                    fill="url(#fillUsers)"
                    stroke="var(--chart-3)"
                    strokeWidth={2}
                    type="monotone"
                  />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* ── Color palette + tokens ────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Color Tokens</CardTitle>
              <CardDescription>Theme palette</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { label: "Primary", cls: "bg-primary", fg: "bg-primary-foreground", fgLabel: "Foreground" },
                  { label: "Secondary", cls: "bg-secondary", fg: "bg-secondary-foreground", fgLabel: "Foreground" },
                  { label: "Muted", cls: "bg-muted", fg: "bg-muted-foreground", fgLabel: "Foreground" },
                  { label: "Accent", cls: "bg-accent", fg: "bg-accent-foreground", fgLabel: "Foreground" },
                  { label: "Destructive", cls: "bg-destructive" },
                ].map((swatch) => (
                  <div key={swatch.label} className="flex items-center gap-2">
                    <div className={cn("h-6 flex-1 rounded-md border", swatch.cls)} />
                    {swatch.fg && (
                      <div className={cn("h-6 w-6 rounded-md border", swatch.fg)} />
                    )}
                    <span className="w-20 text-right text-xs text-muted-foreground">
                      {swatch.label}
                    </span>
                  </div>
                ))}
                <Separator />
                <div className="flex gap-1.5">
                  {["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"].map(
                    (cls, i) => (
                      <div
                        key={cls}
                        className={cn("h-6 flex-1 rounded-md", cls)}
                        title={`Chart ${i + 1}`}
                      />
                    ),
                  )}
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Chart colors 1 – 5
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ── Buttons & badges showcase ──────────────────────────────── */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Components</CardTitle>
              <CardDescription>Buttons, badges, and inputs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Buttons
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm">Primary</Button>
                  <Button size="sm" variant="secondary">Secondary</Button>
                  <Button size="sm" variant="outline">Outline</Button>
                  <Button size="sm" variant="ghost">Ghost</Button>
                  <Button size="sm" variant="destructive">Destructive</Button>
                  <Button size="sm" variant="link">Link</Button>
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Badges
                </span>
                <div className="flex flex-wrap gap-2">
                  <Badge>Default</Badge>
                  <Badge variant="secondary">Secondary</Badge>
                  <Badge variant="outline">Outline</Badge>
                  <Badge variant="destructive">Destructive</Badge>
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Progress
                </span>
                <Progress value={68} className="h-2" />
              </div>
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Tabs
                </span>
                <Tabs defaultValue="files">
                  <TabsList>
                    <TabsTrigger value="files">Files</TabsTrigger>
                    <TabsTrigger value="shared">Shared</TabsTrigger>
                    <TabsTrigger value="activity">Activity</TabsTrigger>
                  </TabsList>
                  <TabsContent value="files">
                    <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                      1,284 files across 42 folders
                    </div>
                  </TabsContent>
                  <TabsContent value="shared">
                    <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                      18 active share links
                    </div>
                  </TabsContent>
                  <TabsContent value="activity">
                    <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                      573 events this week
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </CardContent>
          </Card>

          {/* ── Recent activity ────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest events</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { icon: Upload, label: "report.pdf uploaded", time: "2m", color: "text-chart-1" },
                  { icon: FolderOpen, label: "Q4 Reports created", time: "1h", color: "text-chart-2" },
                  { icon: Share2, label: "budget.xlsx shared", time: "3h", color: "text-chart-3" },
                  { icon: Users, label: "jane@acme.co joined", time: "5h", color: "text-chart-4" },
                  { icon: FileText, label: "notes.md edited", time: "8h", color: "text-chart-5" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <div className={cn("rounded-md bg-muted p-1.5", item.color)}>
                      <item.icon className="size-3.5" />
                    </div>
                    <span className="flex-1 truncate">{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.time}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
