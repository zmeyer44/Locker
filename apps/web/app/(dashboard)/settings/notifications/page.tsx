"use client";

import {
  Bell,
  BellOff,
  CheckCheck,
  Loader2,
  Mail,
  Megaphone,
  Share2,
  Users,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { cn, getRelativeTime } from "@/lib/utils";

const TYPE_CONFIG: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  workspace_invite: { icon: Users, color: "text-blue-500" },
  share_link: { icon: Share2, color: "text-emerald-500" },
  announcement: { icon: Megaphone, color: "text-amber-500" },
};

function getTypeConfig(type: string) {
  return TYPE_CONFIG[type] ?? { icon: Mail, color: "text-muted-foreground" };
}

function groupByDate<T extends { id: string; createdAt: Date }>(
  items: T[],
) {
  const groups: { label: string; items: T[] }[] = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  let currentLabel = "";
  let currentItems: T[] = [];

  for (const item of items) {
    const d = new Date(item.createdAt);
    let label: string;

    if (d >= today) {
      label = "Today";
    } else if (d >= yesterday) {
      label = "Yesterday";
    } else if (d >= weekAgo) {
      label = "This week";
    } else {
      label = d.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
    }

    if (label !== currentLabel) {
      if (currentItems.length > 0) {
        groups.push({ label: currentLabel, items: currentItems });
      }
      currentLabel = label;
      currentItems = [];
    }
    currentItems.push(item);
  }

  if (currentItems.length > 0) {
    groups.push({ label: currentLabel, items: currentItems });
  }

  return groups;
}

export default function NotificationsPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.notifications.list.useQuery();
  const { data: unreadCount } = trpc.notifications.unreadCount.useQuery();

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const notifications = data?.items ?? [];
  const groups = groupByDate(notifications);
  const hasUnread = (unreadCount ?? 0) > 0;

  return (
    <div>
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
        <div className="flex flex-1 items-center gap-2 px-4">
          <Bell className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Notifications</span>
          {hasUnread && (
            <span className="flex h-5 items-center rounded-full bg-primary/10 px-2 text-xs font-medium text-primary">
              {unreadCount} unread
            </span>
          )}
        </div>
        {hasUnread && (
          <div className="px-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              {markAllRead.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <CheckCheck className="size-3.5" />
              )}
              Mark all read
            </Button>
          </div>
        )}
      </header>

      <div className="mx-auto max-w-2xl p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : notifications.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.label}>
                <h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">
                  {group.label}
                </h3>
                <div className="space-y-1">
                  {group.items.map((n) => (
                    <NotificationRow
                      key={n.id}
                      notification={n}
                      onMarkRead={() => markRead.mutate({ id: n.id })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationRow({
  notification,
  onMarkRead,
}: {
  notification: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    actionUrl: string | null;
    read: boolean;
    createdAt: Date;
  };
  onMarkRead: () => void;
}) {
  const config = getTypeConfig(notification.type);
  const Icon = config.icon;

  const content = (
    <div
      className={cn(
        "group relative flex items-start gap-3 rounded-lg p-3 transition-colors",
        notification.read
          ? "opacity-60 hover:opacity-100"
          : "bg-accent/50 hover:bg-accent",
      )}
    >
      {/* Unread indicator */}
      {!notification.read && (
        <span className="absolute left-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" />
      )}

      {/* Type icon */}
      <div
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted",
          config.color,
        )}
      >
        <Icon className="size-4" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{notification.title}</p>
        {notification.body && (
          <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">
            {notification.body}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {getRelativeTime(notification.createdAt.toString())}
        </p>
      </div>

      {/* Mark read button */}
      {!notification.read && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMarkRead();
          }}
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-background hover:text-foreground group-hover:opacity-100"
          aria-label="Mark as read"
        >
          <CheckCheck className="size-3.5" />
        </button>
      )}
    </div>
  );

  if (notification.actionUrl) {
    return (
      <a
        href={notification.actionUrl}
        onClick={() => {
          if (!notification.read) onMarkRead();
        }}
      >
        {content}
      </a>
    );
  }

  return content;
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
        <BellOff className="size-5 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-sm font-medium">No notifications</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        You&apos;re all caught up. We&apos;ll let you know when something needs
        your attention.
      </p>
    </div>
  );
}
