"use client";

import { useState, use } from "react";
import { Download, Lock, AlertCircle, FileText, Folder } from "lucide-react";
import { Logo } from "@/assets/logo";
import { trpc } from "@/lib/trpc/client";
import { formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileIcon } from "@/components/file-icon";
import { toast } from "sonner";

export default function SharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [password, setPassword] = useState("");
  const [enteredPassword, setEnteredPassword] = useState<string | undefined>();

  const { data, isLoading } = trpc.shares.access.useQuery({
    token,
    password: enteredPassword,
  });

  const getDownloadUrl = trpc.shares.getDownloadUrl.useMutation();

  const handleDownload = async (fileId?: string) => {
    try {
      const result = await getDownloadUrl.mutateAsync({
        token,
        fileId,
        password: enteredPassword,
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

  if (data && "requiresPassword" in data && data.requiresPassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 mb-6">
            <Logo className="size-5 text-primary" />
            <span className="title text-base">Locker</span>
          </div>

          <Lock className="h-8 w-8 text-muted-foreground/50 mb-3" />
          <h1 className="title text-lg mb-1">Password required</h1>
          <p className="text-sm text-muted-foreground mb-4">
            This shared link is password protected
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setEnteredPassword(password);
            }}
          >
            <Input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <Button type="submit" className="w-full mt-3">
              Access
            </Button>
          </form>
        </div>
      </div>
    );
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
            This shared link does not exist
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
