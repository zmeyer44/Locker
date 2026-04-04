"use client";

import { useState, useEffect, useRef, use, useCallback } from "react";
import { Download, Lock, AlertCircle, Folder, Mail } from "lucide-react";
import { Logo } from "@/assets/logo";
import { trpc } from "@/lib/trpc/client";
import { formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileIcon } from "@/components/file-icon";
import { toast } from "sonner";

function generateVisitorId(): string {
  const stored = localStorage.getItem("_os_vid");
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem("_os_vid", id);
  return id;
}

export default function TrackedLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [enteredPassword, setEnteredPassword] = useState<string | undefined>();
  const [enteredEmail, setEnteredEmail] = useState<string | undefined>();
  const [tracked, setTracked] = useState(false);
  const eventIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  const { data, isLoading } = trpc.trackedLinks.access.useQuery({
    token,
    password: enteredPassword,
    email: enteredEmail,
  });

  const getDownloadUrl = trpc.trackedLinks.getDownloadUrl.useMutation();

  // Send tracking beacon when access succeeds
  const sendTrackingBeacon = useCallback(async () => {
    if (tracked) return;
    if (!data || !("item" in data) || !data.item) return;

    setTracked(true);
    startTimeRef.current = Date.now();

    try {
      const visitorId = generateVisitorId();
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          visitorId,
          email: enteredEmail,
          eventType: "view",
          pageUrl: window.location.href,
          referrer: document.referrer || null,
        }),
      });
      const result = await res.json();
      if (result.ok && typeof result.eventId === "string") {
        eventIdRef.current = result.eventId;
      }
    } catch {
      // Tracking failure shouldn't break the page
    }
  }, [tracked, data, token, enteredEmail]);

  useEffect(() => {
    sendTrackingBeacon();
  }, [sendTrackingBeacon]);

  // Send duration beacon on page unload
  useEffect(() => {
    const handleUnload = () => {
      if (!tracked || !eventIdRef.current) return;
      const duration = Math.round((Date.now() - startTimeRef.current) / 1000);
      navigator.sendBeacon(
        "/api/track",
        JSON.stringify({
          token,
          eventId: eventIdRef.current,
          durationSeconds: duration,
        }),
      );
    };

    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [token, tracked]);

  const handleDownload = async (fileId?: string) => {
    try {
      // Track download event
      const visitorId = generateVisitorId();
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          visitorId,
          email: enteredEmail,
          eventType: "download",
          pageUrl: window.location.href,
        }),
      });

      const result = await getDownloadUrl.mutateAsync({
        token,
        fileId,
        password: enteredPassword,
        email: enteredEmail,
      });
      const a = document.createElement("a");
      a.href = result.url;
      a.download = result.filename;
      a.click();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="skeleton h-8 w-32 rounded-sm" />
      </div>
    );
  }

  // Handle password/email gates
  if (data && ("requiresPassword" in data || "requiresEmail" in data)) {
    const needsPassword =
      "requiresPassword" in data && data.requiresPassword && !enteredPassword;
    const needsEmail =
      "requiresEmail" in data && data.requiresEmail && !enteredEmail;

    if (needsPassword || needsEmail) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="w-full max-w-sm rounded-lg border bg-card p-6">
            <div className="flex items-center gap-2 mb-6">
              <Logo className="size-5 text-primary" />
              <span className="title text-base">Locker</span>
            </div>

            {needsPassword && (
              <>
                <Lock className="h-8 w-8 text-muted-foreground/50 mb-3" />
                <h1 className="title text-lg mb-1">Password required</h1>
                <p className="text-sm text-muted-foreground mb-4">
                  This link is password protected
                </p>
              </>
            )}

            {!needsPassword && needsEmail && (
              <>
                <Mail className="h-8 w-8 text-muted-foreground/50 mb-3" />
                <h1 className="title text-lg mb-1">Email required</h1>
                <p className="text-sm text-muted-foreground mb-4">
                  Enter your email to access this content
                </p>
              </>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (needsPassword) setEnteredPassword(password);
                if (needsEmail) setEnteredEmail(email);
              }}
              className="space-y-3"
            >
              {needsPassword && (
                <Input
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              )}
              {needsEmail && (
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus={!needsPassword}
                />
              )}
              <Button type="submit" className="w-full">
                Access
              </Button>
            </form>
          </div>
        </div>
      );
    }
  }

  if (data && "error" in data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm rounded-lg border bg-card p-6 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <h1 className="title text-lg mb-1">Unable to access</h1>
          <p className="text-sm text-muted-foreground">{data.error}</p>
        </div>
      </div>
    );
  }

  if (!data || !("item" in data) || !data.item) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm rounded-lg border bg-card p-6 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
          <h1 className="title text-lg mb-1">Not found</h1>
          <p className="text-sm text-muted-foreground">
            This link does not exist
          </p>
        </div>
      </div>
    );
  }

  const { item, access } = data;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2 mb-6">
          <Logo className="size-5 text-primary" />
          <span className="title text-base">Locker</span>
          <span className="text-xs font-medium text-muted-foreground px-1.5 py-0.5 bg-primary/5 text-primary rounded-sm ml-auto">
            Shared
          </span>
        </div>

        {item.type === "file" ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-background rounded-sm border">
              <FileIcon
                name={item.name}
                mimeType={item.mimeType}
                className="h-6 w-6"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {item.name}
                </p>
                <p className="text-xs font-mono text-muted-foreground">
                  {formatBytes(item.size ?? 0)}
                </p>
              </div>
            </div>

            {access === "download" && (
              <Button className="w-full" onClick={() => handleDownload()}>
                <Download className="size-3.5" />
                Download
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Folder className="size-5 text-primary" />
              <h2 className="title text-base">{item.name}</h2>
            </div>

            <div className="border rounded-sm divide-y">
              {item.files?.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-2.5 px-3 py-2"
                >
                  <FileIcon
                    name={file.name}
                    mimeType={file.mimeType}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="text-sm text-foreground truncate flex-1">
                    {file.name}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                  {access === "download" && (
                    <button
                      onClick={() => handleDownload(file.id)}
                      className="text-primary hover:text-primary/80 cursor-pointer"
                    >
                      <Download className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {(!item.files || item.files.length === 0) && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  This folder is empty
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
