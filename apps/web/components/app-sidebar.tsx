'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  FolderOpen,
  Share2,
  Upload,
  LogOut,
  Settings,
  Users,
  Key,
  BarChart3,
  Puzzle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ChevronsUpDown,
} from 'lucide-react';
import { Logo } from '@/assets/logo';
import { signOut } from '@/lib/auth/client';
import { trpc } from '@/lib/trpc/client';
import { StorageUsage } from './storage-usage';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

function NavItem({
  href,
  icon: Icon,
  label,
  isActive,
  collapsed,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive: boolean;
  collapsed: boolean;
}) {
  const link = (
    <Link
      href={href}
      className={cn(
        'group/nav relative flex h-8 items-center gap-2 rounded-lg p-2 text-sm transition-colors',
        isActive
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        collapsed ? 'w-8 justify-center' : 'w-full',
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

function NavSection({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-0.5">
      <div
        className={cn(
          'overflow-hidden transition-all duration-300',
          collapsed ? 'h-0' : 'h-6',
        )}
      >
        <div className="flex h-6 items-center px-2 text-xs font-medium text-muted-foreground">
          {label}
        </div>
      </div>
      {children}
    </div>
  );
}

export function AppSidebar({
  user,
}: {
  user: { name?: string | null; email: string; image?: string | null };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  const slugMatch = pathname.match(/\/w\/([^/]+)/);
  const slug = slugMatch?.[1] ?? '';
  const prefix = `/w/${slug}`;

  const { data: workspacesList } = trpc.workspaces.list.useQuery();
  const currentWorkspace = workspacesList?.find((w) => w.slug === slug) ?? null;

  const navItems = [
    { href: prefix, label: 'My Files', icon: FolderOpen, key: 'files' },
    {
      href: `${prefix}/shared-links`,
      label: 'Share Links',
      icon: Share2,
      key: 'shares',
    },
    {
      href: `${prefix}/upload-links`,
      label: 'Upload Links',
      icon: Upload,
      key: 'uploads',
    },
    {
      href: `${prefix}/tracked-links`,
      label: 'Tracked Links',
      icon: BarChart3,
      key: 'tracked',
    },
    {
      href: `${prefix}/plugins`,
      label: 'Plugins',
      icon: Puzzle,
      key: 'plugins',
    },
  ];

  const settingsItems = [
    {
      href: `${prefix}/settings`,
      label: 'Settings',
      icon: Settings,
      key: 'settings',
    },
    {
      href: `${prefix}/settings/members`,
      label: 'Members',
      icon: Users,
      key: 'members',
    },
    {
      href: `${prefix}/settings/api-keys`,
      label: 'API Keys',
      icon: Key,
      key: 'api-keys',
    },
  ];

  const toggleButton = (
    <button
      onClick={() => setCollapsed(!collapsed)}
      className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      <div className="relative grid size-5 place-items-center">
        <PanelLeftClose
          className={cn(
            'absolute size-4 transition-all',
            collapsed ? 'scale-0' : 'scale-100',
          )}
        />
        <PanelLeftOpen
          className={cn(
            'absolute size-4 transition-all',
            collapsed ? 'scale-100' : 'scale-0',
          )}
        />
      </div>
    </button>
  );

  return (
    <div
      className={cn(
        'flex h-full shrink-0 flex-col justify-between overflow-hidden p-2 transition-all duration-300 ease-in-out',
        collapsed ? 'w-[52px]' : 'w-[240px]',
      )}
    >
      {/* Top section */}
      <div className="flex flex-1 flex-col gap-2 overflow-hidden">
        {/* Header */}
        <div
          className={cn(
            'flex h-12 items-center gap-2 transition-all',
            collapsed ? 'justify-center' : 'px-1',
          )}
        >
          {!collapsed && (
            <div className="flex flex-1 items-center gap-2 min-w-0">
              {currentWorkspace ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className="flex items-center gap-2 min-w-0 rounded-lg p-1 -ml-1 hover:bg-accent transition-colors outline-none">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-semibold">
                      {currentWorkspace.name[0]?.toUpperCase() ?? 'W'}
                    </div>
                    <span className="truncate text-sm font-semibold">
                      {currentWorkspace.name}
                    </span>
                    <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" sideOffset={4} className="w-56">
                    {workspacesList?.map((ws) => (
                      <DropdownMenuItem
                        key={ws.id}
                        onSelect={() => router.push(`/w/${ws.slug}`)}
                        className={ws.id === currentWorkspace.id ? 'bg-accent' : ''}
                      >
                        <div className="flex size-6 items-center justify-center rounded bg-primary text-primary-foreground font-semibold text-xs shrink-0">
                          {ws.name[0]?.toUpperCase() ?? 'W'}
                        </div>
                        <span className="truncate">{ws.name}</span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => router.push('/onboarding')}>
                      <Plus className="size-4" />
                      Create workspace
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Link href="/" className="flex items-center gap-2">
                  <Logo className="size-6 shrink-0 text-foreground" />
                  <span className="text-sm font-semibold">OpenStore</span>
                </Link>
              )}
            </div>
          )}
          {toggleButton}
        </div>

        {/* Nav sections */}
        <div className="flex flex-col gap-3">
          <NavSection label="Files" collapsed={collapsed}>
            {navItems.map((item) => {
              const isActive =
                item.key === 'files'
                  ? pathname === prefix ||
                    pathname.startsWith(`${prefix}/folder`)
                  : pathname.startsWith(item.href);
              return (
                <NavItem
                  key={item.key}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  isActive={isActive}
                  collapsed={collapsed}
                />
              );
            })}
          </NavSection>

          <NavSection label="Workspace" collapsed={collapsed}>
            {settingsItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <NavItem
                  key={item.key}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  isActive={isActive}
                  collapsed={collapsed}
                />
              );
            })}
          </NavSection>
        </div>
      </div>

      {/* Bottom section */}
      <div className="flex flex-col gap-1">
        {/* Storage usage card */}
        {!collapsed && (
          <div className="rounded-lg ring-1 ring-border shadow-sm p-2.5 mb-1">
            <StorageUsage />
          </div>
        )}

        {/* Sign out */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={async () => {
                  await signOut();
                  router.push('/login');
                }}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <LogOut className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              Sign out
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={async () => {
              await signOut();
              router.push('/login');
            }}
            className="flex h-8 w-full items-center gap-2 rounded-lg p-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <LogOut className="size-4 shrink-0" />
            <span className="truncate">Sign out</span>
          </button>
        )}
      </div>
    </div>
  );
}
