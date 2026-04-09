"use client";

import { useState, use } from "react";
import {
  Download,
  Lock,
  AlertCircle,
  Folder,
  ChevronRight,
} from "lucide-react";
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
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  const { data, isLoading } = trpc.shares.access.useQuery({
    token,
    password: enteredPassword,
  });

  const browseQuery = trpc.shares.browseFolder.useQuery(
    {
      token,
      folderId: currentFolderId!,
      password: enteredPassword,
    },
    { enabled: !!currentFolderId },
  );

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

  const navigateToFolder = (folderId: string) => {
    setCurrentFolderId(folderId);
  };

  const navigateToRoot = () => {
    setCurrentFolderId(null);
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

  // Determine what to display: browsed subfolder or root
  const isBrowsing = currentFolderId !== null;
  const browseData =
    isBrowsing && browseQuery.data && !("error" in browseQuery.data)
      ? browseQuery.data
      : null;

  const displayFiles = isBrowsing ? browseData?.files : item.files;
  const displaySubfolders = isBrowsing
    ? browseData?.subfolders
    : item.subfolders;
  const breadcrumbs = browseData?.breadcrumbs ?? [];

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
            {/* Breadcrumb navigation */}
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={navigateToRoot}
                className="flex items-center gap-1 text-sm hover:text-primary cursor-pointer"
              >
                <Folder className="size-4 text-primary shrink-0" />
                <span className={isBrowsing ? "text-muted-foreground" : "font-medium text-foreground"}>
                  {item.name}
                </span>
              </button>

              {breadcrumbs.map((crumb) => (
                <div key={crumb.id} className="flex items-center gap-1">
                  <ChevronRight className="size-3 text-muted-foreground shrink-0" />
                  <button
                    onClick={() => navigateToFolder(crumb.id)}
                    className="text-sm text-muted-foreground hover:text-primary cursor-pointer"
                  >
                    {crumb.name}
                  </button>
                </div>
              ))}
            </div>

            {browseQuery.isLoading && isBrowsing ? (
              <div className="border rounded-sm p-6 text-center">
                <div className="skeleton h-4 w-24 mx-auto rounded-sm" />
              </div>
            ) : (
              <div className="border rounded-sm divide-y">
                {/* Subfolders */}
                {displaySubfolders?.map((subfolder) => (
                  <button
                    key={subfolder.id}
                    onClick={() => navigateToFolder(subfolder.id)}
                    className="flex items-center gap-2.5 px-3 py-2 w-full text-left hover:bg-accent/50 cursor-pointer"
                  >
                    <Folder className="size-4 text-primary shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate flex-1">
                      {subfolder.name}
                    </span>
                    <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
                  </button>
                ))}

                {/* Files */}
                {displayFiles?.map((file) => (
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

                {/* Empty state */}
                {(!displayFiles || displayFiles.length === 0) &&
                  (!displaySubfolders || displaySubfolders.length === 0) && (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      This folder is empty
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
