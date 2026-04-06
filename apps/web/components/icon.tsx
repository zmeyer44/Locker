"use client";

import { LayoutGridIcon, type LucideIcon } from "lucide-react";

export type Icon =
  | LucideIcon
  | React.ComponentType<React.SVGProps<SVGSVGElement>>;
export type IconType = Icon;
