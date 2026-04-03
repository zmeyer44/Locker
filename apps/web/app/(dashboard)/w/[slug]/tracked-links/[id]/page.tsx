'use client';

import { useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BarChart3,
  Eye,
  Users,
  Download,
  Clock,
  Globe,
  Monitor,
  Smartphone,
  Tablet,
  Copy,
  Check,
  Settings2,
  MapPin,
  Chrome,
  ExternalLink,
  Mail,
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { formatDate, getRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { FileIcon } from '@/components/file-icon';

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="size-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && (
        <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
      )}
    </div>
  );
}

function BreakdownTable({
  title,
  icon: Icon,
  data,
}: {
  title: string;
  icon: React.ElementType;
  data: { label: string; count: number }[];
}) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const sorted = [...data].sort((a, b) => b.count - a.count);

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
      </div>
      {sorted.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          No data yet
        </div>
      ) : (
        <div className="divide-y">
          {sorted.slice(0, 10).map((item, i) => {
            const pct = total > 0 ? (item.count / total) * 100 : 0;
            return (
              <div key={i} className="relative px-4 py-2.5">
                <div
                  className="absolute inset-y-0 left-0 bg-primary/5"
                  style={{ width: `${pct}%` }}
                />
                <div className="relative flex items-center justify-between gap-3">
                  <span className="text-sm truncate">
                    {item.label || 'Unknown'}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono tabular-nums text-muted-foreground">
                      {item.count}
                    </span>
                    <span className="text-xs font-mono tabular-nums text-muted-foreground w-12 text-right">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ViewsChart({
  data,
}: {
  data: { date: string; views: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-4 py-10 text-center text-xs text-muted-foreground">
        No views yet
      </div>
    );
  }

  const maxViews = Math.max(...data.map((d) => d.views), 1);

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
        <BarChart3 className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Views over time</span>
      </div>
      <div className="p-4">
        <div className="flex items-end gap-1 h-32">
          {data.map((d, i) => {
            const height = (d.views / maxViews) * 100;
            return (
              <div
                key={i}
                className="flex-1 group relative"
                title={`${d.date}: ${d.views} views`}
              >
                <div
                  className="bg-primary/80 rounded-t-sm mx-auto min-h-[2px] transition-colors group-hover:bg-primary"
                  style={{
                    height: `${Math.max(height, 2)}%`,
                    maxWidth: '24px',
                  }}
                />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-popover border rounded px-2 py-1 text-xs font-mono whitespace-nowrap z-10 shadow-md">
                  {d.views} views
                  <br />
                  <span className="text-muted-foreground">{d.date}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-muted-foreground font-mono">
          <span>{data[0]?.date}</span>
          <span>{data[data.length - 1]?.date}</span>
        </div>
      </div>
    </div>
  );
}

const deviceIcon = (type: string) => {
  if (type === 'mobile') return Smartphone;
  if (type === 'tablet') return Tablet;
  return Monitor;
};

export default function TrackedLinkDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = use(params);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [eventsPage, setEventsPage] = useState(0);

  const { data: link } = trpc.trackedLinks.get.useQuery({ id });
  const { data: analytics } = trpc.trackedLinks.analytics.useQuery({
    linkId: id,
    days: 30,
  });
  const { data: eventsData } = trpc.trackedLinks.events.useQuery({
    linkId: id,
    limit: 20,
    offset: eventsPage * 20,
  });

  const handleCopyUrl = async () => {
    if (!link) return;
    const url = `${window.location.origin}/t/${link.token}`;
    await navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  if (!link) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const prefix = `/w/${slug}/tracked-links`;

  return (
    <div>
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
        <div className="flex flex-1 items-center gap-2 px-4">
          <Link
            href={prefix}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ArrowLeft className="size-3.5" />
            Tracked Links
          </Link>
          <Separator orientation="vertical" className="mx-1 h-4" />
          <span className="text-sm font-medium truncate">{link.name}</span>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Link info header */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">{link.name}</h1>
              {link.description && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {link.description}
                </p>
              )}
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                <FileIcon
                  name={link.itemName}
                  isFolder={link.itemType === 'folder'}
                  className="size-3.5"
                />
                <span>{link.itemName}</span>
                <span className="text-border">|</span>
                <span className="capitalize">{link.access} access</span>
                {link.hasPassword && (
                  <>
                    <span className="text-border">|</span>
                    <span>Password protected</span>
                  </>
                )}
                {link.requireEmail && (
                  <>
                    <span className="text-border">|</span>
                    <span>Email required</span>
                  </>
                )}
                {link.expiresAt && (
                  <>
                    <span className="text-border">|</span>
                    <span>
                      Expires {formatDate(link.expiresAt)}
                    </span>
                  </>
                )}
                {link.validFrom && (
                  <>
                    <span className="text-border">|</span>
                    <span>
                      Active from {formatDate(link.validFrom)}
                    </span>
                  </>
                )}
                {link.validUntil && (
                  <>
                    <span className="text-border">|</span>
                    <span>
                      Active until {formatDate(link.validUntil)}
                    </span>
                  </>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleCopyUrl}>
              {copiedUrl ? (
                <Check className="size-3.5 text-green-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
              Copy link
            </Button>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={Eye}
            label="Total Views"
            value={link.viewCount}
          />
          <StatCard
            icon={Users}
            label="Unique Visitors"
            value={analytics?.uniqueVisitors ?? 0}
          />
          <StatCard
            icon={Download}
            label="Downloads"
            value={link.downloadCount}
          />
          <StatCard
            icon={Clock}
            label="Avg. Duration"
            value={
              analytics?.avgDurationSeconds != null
                ? `${analytics.avgDurationSeconds}s`
                : '--'
            }
            sub={
              link.lastAccessedAt
                ? `Last view ${getRelativeTime(link.lastAccessedAt.toString())}`
                : undefined
            }
          />
        </div>

        {/* Views chart */}
        <ViewsChart data={analytics?.viewsByDay ?? []} />

        {/* Breakdowns grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <BreakdownTable
            title="Devices"
            icon={Monitor}
            data={
              analytics?.deviceBreakdown?.map((d) => ({
                label: d.deviceType ?? 'Unknown',
                count: d.count,
              })) ?? []
            }
          />
          <BreakdownTable
            title="Browsers"
            icon={Chrome}
            data={
              analytics?.browserBreakdown?.map((d) => ({
                label: d.browser ?? 'Unknown',
                count: d.count,
              })) ?? []
            }
          />
          <BreakdownTable
            title="Operating Systems"
            icon={Settings2}
            data={
              analytics?.osBreakdown?.map((d) => ({
                label: d.os ?? 'Unknown',
                count: d.count,
              })) ?? []
            }
          />
          <BreakdownTable
            title="Countries"
            icon={Globe}
            data={
              analytics?.countryBreakdown?.map((d) => ({
                label: d.country
                  ? `${d.country}${d.countryCode ? ` (${d.countryCode})` : ''}`
                  : 'Unknown',
                count: d.count,
              })) ?? []
            }
          />
          <BreakdownTable
            title="Cities"
            icon={MapPin}
            data={
              analytics?.cityBreakdown?.map((d) => ({
                label: [d.city, d.region, d.country]
                  .filter(Boolean)
                  .join(', ') || 'Unknown',
                count: d.count,
              })) ?? []
            }
          />
          <BreakdownTable
            title="Referrers"
            icon={ExternalLink}
            data={
              analytics?.referrerBreakdown?.map((d) => ({
                label: d.referrer
                  ? (() => {
                      try {
                        return new URL(d.referrer).hostname;
                      } catch {
                        return d.referrer;
                      }
                    })()
                  : 'Direct',
                count: d.count,
              })) ?? []
            }
          />
        </div>

        {/* Event log */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">Event Log</span>
              {eventsData && (
                <span className="text-xs text-muted-foreground">
                  ({eventsData.total} total)
                </span>
              )}
            </div>
          </div>

          {!eventsData?.events.length ? (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">
              No events recorded yet
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/20">
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">
                        Time
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">
                        Type
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">
                        Location
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">
                        Device
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">
                        Browser / OS
                      </th>
                      {link.requireEmail && (
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">
                          Email
                        </th>
                      )}
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">
                        Referrer
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {eventsData.events.map((event) => {
                      const DeviceIcon = deviceIcon(
                        event.deviceType ?? 'desktop',
                      );
                      return (
                        <tr key={event.id} className="hover:bg-muted/20">
                          <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground whitespace-nowrap">
                            {getRelativeTime(event.timestamp.toString())}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`text-xs font-mono uppercase px-1.5 py-0.5 rounded-sm ${
                                event.eventType === 'download'
                                  ? 'bg-blue-500/10 text-blue-500'
                                  : 'bg-green-500/10 text-green-500'
                              }`}
                            >
                              {event.eventType}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {[event.city, event.region, event.countryCode]
                              .filter(Boolean)
                              .join(', ') || '--'}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <DeviceIcon className="size-3.5" />
                              <span className="capitalize">
                                {event.deviceType ?? '--'}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {event.browser ?? '--'}
                            {event.browserVersion
                              ? ` ${event.browserVersion}`
                              : ''}{' '}
                            / {event.os ?? '--'}
                          </td>
                          {link.requireEmail && (
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                              {event.email ? (
                                <span className="flex items-center gap-1">
                                  <Mail className="size-3" />
                                  {event.email}
                                </span>
                              ) : (
                                '--'
                              )}
                            </td>
                          )}
                          <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[200px]">
                            {event.referrer
                              ? (() => {
                                  try {
                                    return new URL(event.referrer).hostname;
                                  } catch {
                                    return event.referrer;
                                  }
                                })()
                              : 'Direct'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {eventsData.total > 20 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-xs text-muted-foreground">
                    Showing {eventsPage * 20 + 1}-
                    {Math.min((eventsPage + 1) * 20, eventsData.total)} of{' '}
                    {eventsData.total}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={eventsPage === 0}
                      onClick={() => setEventsPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(eventsPage + 1) * 20 >= eventsData.total}
                      onClick={() => setEventsPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
