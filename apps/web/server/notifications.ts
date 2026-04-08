import { notifications } from "@locker/database";
import type { Database } from "@locker/database";

type NotificationType =
  | "workspace_invite"
  | "share_link"
  | "announcement";

export async function createNotification({
  db,
  userId,
  type,
  title,
  body,
  actionUrl,
  metadata,
}: {
  db: Database;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  const [notification] = await db
    .insert(notifications)
    .values({ userId, type, title, body, actionUrl, metadata })
    .returning();

  return notification;
}
