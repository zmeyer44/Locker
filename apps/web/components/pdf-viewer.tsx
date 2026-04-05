"use client";

import type React from "react";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize,
  Minus,
  Plus,
  RotateCcw,
  PanelLeft,
  Expand,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface PDFViewerProps {
  url: string;
  className?: string;
  onLoadSuccess?: (numPages: number) => void;
  onLoadError?: (error: Error) => void;
  onPageChange?: (page: number) => void;
  initialPage?: number;
  showThumbnails?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.1;
const THUMBNAIL_WIDTH = 120;
const PAGE_GAP = 16;

/* ------------------------------------------------------------------ */
/*  Icon button helper                                                 */
/* ------------------------------------------------------------------ */

function ToolbarButton({
  icon,
  tooltip,
  onClick,
  disabled,
  active,
}: {
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClick}
          disabled={disabled}
          className={cn(active && "bg-muted text-foreground")}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/*  PDF Page                                                           */
/* ------------------------------------------------------------------ */

const PDFPage = memo(function PDFPage({
  page,
  pageNumber,
  scale,
  containerWidth,
  isVisible,
}: {
  page: pdfjs.PDFPageProxy;
  pageNumber: number;
  scale: number;
  containerWidth: number;
  isVisible: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<pdfjs.RenderTask | null>(null);
  const isRenderingRef = useRef(false);
  const [hasRendered, setHasRendered] = useState(false);

  const viewport = useMemo(() => {
    const baseViewport = page.getViewport({ scale: 1 });
    if (containerWidth <= 48) {
      return page.getViewport({ scale });
    }
    const fitScale = (containerWidth - 48) / baseViewport.width;
    return page.getViewport({ scale: scale * Math.min(fitScale, 1) });
  }, [page, scale, containerWidth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isVisible || isRenderingRef.current) return;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    const context = canvas.getContext("2d");
    if (!context) return;

    const outputScale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    context.scale(outputScale, outputScale);
    isRenderingRef.current = true;

    const renderTask = page.render({ canvas, viewport });
    renderTaskRef.current = renderTask;

    renderTask.promise
      .then(() => {
        isRenderingRef.current = false;
        setHasRendered(true);
      })
      .catch((error) => {
        if (error.name !== "RenderingCancelledException") {
          isRenderingRef.current = false;
        }
      });

    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
        isRenderingRef.current = false;
      }
    };
  }, [page, viewport, isVisible]);

  return (
    <div
      className="pdf-page relative flex items-center justify-center"
      data-page={pageNumber}
      style={{ minHeight: viewport.height, minWidth: viewport.width }}
    >
      <div className="relative rounded-sm overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)]">
        <canvas
          ref={canvasRef}
          className={cn(
            "block bg-white transition-opacity duration-200",
            hasRendered ? "opacity-100" : "opacity-0",
          )}
        />
        {!hasRendered && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-white"
            style={{ width: viewport.width, height: viewport.height }}
          >
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Loading page {pageNumber}...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Page number pill */}
      <div
        className={cn(
          "absolute bottom-3 left-1/2 -translate-x-1/2",
          "px-2 py-0.5 rounded-full",
          "bg-foreground/80 text-background text-xs font-medium tabular-nums",
          "opacity-0 transition-opacity duration-200",
          "group-hover/pages:opacity-100",
        )}
      >
        {pageNumber}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Thumbnail                                                          */
/* ------------------------------------------------------------------ */

const PDFThumbnail = memo(function PDFThumbnail({
  page,
  pageNumber,
  isActive,
  onClick,
}: {
  page: pdfjs.PDFPageProxy;
  pageNumber: number;
  isActive: boolean;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasRendered, setHasRendered] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const viewport = page.getViewport({ scale: 1 });
    const scale = THUMBNAIL_WIDTH / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    const outputScale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(scaledViewport.width * outputScale);
    canvas.height = Math.floor(scaledViewport.height * outputScale);
    canvas.style.width = `${scaledViewport.width}px`;
    canvas.style.height = `${scaledViewport.height}px`;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.scale(outputScale, outputScale);

    page
      .render({ canvas, viewport: scaledViewport })
      .promise.then(() => setHasRendered(true))
      .catch(() => {});
  }, [page]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center gap-1.5 p-1.5 rounded-lg transition-all duration-150",
        "hover:bg-muted/60",
        isActive && "bg-muted",
      )}
    >
      <div
        className={cn(
          "relative rounded overflow-hidden transition-all duration-150",
          "ring-2 ring-offset-2 ring-offset-background",
          isActive
            ? "ring-primary shadow-md"
            : "ring-transparent hover:ring-muted-foreground/20",
        )}
      >
        <canvas
          ref={canvasRef}
          className={cn(
            "block bg-white transition-opacity duration-200",
            hasRendered ? "opacity-100" : "opacity-0",
          )}
        />
        {!hasRendered && (
          <Skeleton
            className="absolute inset-0"
            style={{
              width: THUMBNAIL_WIDTH,
              height: THUMBNAIL_WIDTH * Math.SQRT2,
            }}
          />
        )}
      </div>
      <span
        className={cn(
          "text-xs tabular-nums transition-colors",
          isActive ? "text-foreground font-medium" : "text-muted-foreground",
        )}
      >
        {pageNumber}
      </span>
    </button>
  );
});

/* ------------------------------------------------------------------ */
/*  Toolbar                                                            */
/* ------------------------------------------------------------------ */

function PDFToolbar({
  currentPage,
  totalPages,
  scale,
  showThumbnails,
  onPageChange,
  onScaleChange,
  onToggleThumbnails,
  onFitWidth,
  onFitPage,
  isLoading,
}: {
  currentPage: number;
  totalPages: number;
  scale: number;
  showThumbnails: boolean;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  onToggleThumbnails: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  isLoading: boolean;
}) {
  const [pageInput, setPageInput] = useState(currentPage.toString());

  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  const handlePageInputSubmit = (
    e: React.FormEvent | React.FocusEvent<HTMLInputElement>,
  ) => {
    e.preventDefault();
    const page = Number.parseInt(pageInput, 10);
    if (!Number.isNaN(page) && page >= 1 && page <= totalPages) {
      onPageChange(page);
    } else {
      setPageInput(currentPage.toString());
    }
  };

  const zoomPercentage = Math.round(scale * 100);

  return (
    <div
      className={cn(
        "flex items-center justify-between px-3 py-1.5",
        "border-b bg-background/95 backdrop-blur-sm",
        "supports-[backdrop-filter]:bg-background/80",
        "shrink-0 z-10",
      )}
    >
      {/* Left — Thumbnail toggle */}
      <div className="flex items-center">
        <ToolbarButton
          icon={<PanelLeft className="size-4" />}
          tooltip={showThumbnails ? "Hide pages" : "Show pages"}
          onClick={onToggleThumbnails}
          active={showThumbnails}
        />
      </div>

      {/* Center — Page navigation */}
      <div className="flex items-center gap-1">
        <ToolbarButton
          icon={<ChevronLeft className="size-4" />}
          tooltip="Previous page"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1 || isLoading}
        />

        <form
          onSubmit={handlePageInputSubmit}
          className="flex items-center gap-1.5"
        >
          <input
            type="text"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={handlePageInputSubmit}
            className={cn(
              "w-10 h-7 text-center text-sm tabular-nums rounded-md",
              "border border-border bg-background",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
              "transition-shadow",
            )}
            disabled={isLoading}
          />
          <span className="text-sm text-muted-foreground">/</span>
          <span className="text-sm tabular-nums text-muted-foreground min-w-[2ch]">
            {totalPages}
          </span>
        </form>

        <ToolbarButton
          icon={<ChevronRight className="size-4" />}
          tooltip="Next page"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages || isLoading}
        />
      </div>

      {/* Right — Zoom controls */}
      <div className="flex items-center gap-1">
        <ToolbarButton
          icon={<Minus className="size-4" />}
          tooltip="Zoom out"
          onClick={() => onScaleChange(Math.max(MIN_SCALE, scale - SCALE_STEP))}
          disabled={scale <= MIN_SCALE || isLoading}
        />

        <div
          className={cn(
            "flex items-center justify-center",
            "min-w-[52px] h-7 px-2",
            "text-sm tabular-nums text-muted-foreground",
            "rounded-md bg-muted/50",
          )}
        >
          {zoomPercentage}%
        </div>

        <ToolbarButton
          icon={<Plus className="size-4" />}
          tooltip="Zoom in"
          onClick={() => onScaleChange(Math.min(MAX_SCALE, scale + SCALE_STEP))}
          disabled={scale >= MAX_SCALE || isLoading}
        />

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton
          icon={<Maximize className="size-4" />}
          tooltip="Fit to width"
          onClick={onFitWidth}
          disabled={isLoading}
        />

        <ToolbarButton
          icon={<Expand className="size-4" />}
          tooltip="Fit to page"
          onClick={onFitPage}
          disabled={isLoading}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main viewer                                                        */
/* ------------------------------------------------------------------ */

export function PDFViewer({
  url,
  className,
  onLoadSuccess,
  onLoadError,
  onPageChange: onPageChangeProp,
  initialPage = 1,
  showThumbnails: initialShowThumbnails = true,
}: PDFViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<pdfjs.PDFPageProxy[]>([]);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [scale, setScale] = useState(1);
  const [showThumbnails, setShowThumbnails] = useState(initialShowThumbnails);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1]));

  /* ---- Load PDF ---- */
  useEffect(() => {
    let cancelled = false;

    async function loadPDF() {
      setIsLoading(true);
      setError(null);

      try {
        const loadingTask = pdfjs.getDocument({ url, withCredentials: false });
        const doc = await loadingTask.promise;
        if (cancelled) {
          doc.destroy();
          return;
        }

        const pagePromises: Promise<pdfjs.PDFPageProxy>[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          pagePromises.push(doc.getPage(i));
        }

        const loadedPages = await Promise.all(pagePromises);
        if (cancelled) return;

        setPages(loadedPages);
        setIsLoading(false);
        onLoadSuccess?.(doc.numPages);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load PDF";
        setError(msg);
        setIsLoading(false);
        onLoadError?.(err instanceof Error ? err : new Error(msg));
      }
    }

    loadPDF();
    return () => {
      cancelled = true;
    };
  }, [url, onLoadSuccess, onLoadError]);

  /* ---- Observe container width ---- */
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  /* ---- Observe visible pages ---- */
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || pages.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const next = new Set(visiblePages);

        for (const entry of entries) {
          const pageNum = Number.parseInt(
            (entry.target as HTMLElement).dataset.page || "0",
            10,
          );
          if (entry.isIntersecting) {
            next.add(pageNum);
          }
        }

        setVisiblePages(next);

        const visibleEntries = entries.filter((e) => e.isIntersecting);
        if (visibleEntries.length > 0) {
          const mostVisible = visibleEntries.reduce((prev, curr) =>
            curr.intersectionRatio > prev.intersectionRatio ? curr : prev,
          );
          const pageNum = Number.parseInt(
            (mostVisible.target as HTMLElement).dataset.page || "0",
            10,
          );
          if (pageNum > 0 && pageNum !== currentPage) {
            setCurrentPage(pageNum);
            onPageChangeProp?.(pageNum);
          }
        }
      },
      {
        root: scrollContainer,
        rootMargin: "50px 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    const pageElements =
      scrollContainer.querySelectorAll<HTMLElement>(".pdf-page");
    for (const el of pageElements) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [pages, currentPage, onPageChangeProp, visiblePages]);

  /* ---- Scroll to page ---- */
  const scrollToPage = useCallback((pageNumber: number) => {
    const el = scrollContainerRef.current?.querySelector(
      `[data-page="${pageNumber}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  /* ---- Page change handler ---- */
  const handlePageChange = useCallback(
    (page: number) => {
      if (page >= 1 && page <= pages.length) {
        setCurrentPage(page);
        scrollToPage(page);
        onPageChangeProp?.(page);
      }
    },
    [pages.length, scrollToPage, onPageChangeProp],
  );

  /* ---- Auto-scale on load ---- */
  useEffect(() => {
    if (pages.length === 0 || !containerWidth) return;
    const firstPage = pages[0];
    if (!firstPage) return;
    const viewport = firstPage.getViewport({ scale: 1 });
    const fitScale = (containerWidth - 48) / viewport.width;
    if (fitScale < 1) setScale(fitScale);
  }, [pages, containerWidth]);

  /* ---- Zoom handlers ---- */
  const handleScaleChange = useCallback((s: number) => {
    setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)));
  }, []);

  const handleFitWidth = useCallback(() => {
    if (pages.length === 0 || !containerWidth) return;
    const firstPage = pages[0];
    if (!firstPage) return;
    const vp = firstPage.getViewport({ scale: 1 });
    setScale((containerWidth - 48) / vp.width);
  }, [pages, containerWidth]);

  const handleFitPage = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || pages.length === 0) return;
    const firstPage = pages[0];
    if (!firstPage) return;

    const vp = firstPage.getViewport({ scale: 1 });
    const containerHeight = container.clientHeight - PAGE_GAP * 2;
    const widthScale = (containerWidth - 48) / vp.width;
    const heightScale = containerHeight / vp.height;
    setScale(Math.min(widthScale, heightScale));
  }, [pages, containerWidth]);

  /* ---- Keyboard navigation ---- */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (isLoading) return;
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowUp":
          if (e.ctrlKey || e.metaKey) handlePageChange(1);
          else handlePageChange(currentPage - 1);
          e.preventDefault();
          break;
        case "ArrowRight":
        case "ArrowDown":
          if (e.ctrlKey || e.metaKey) handlePageChange(pages.length);
          else handlePageChange(currentPage + 1);
          e.preventDefault();
          break;
        case "Home":
          handlePageChange(1);
          e.preventDefault();
          break;
        case "End":
          handlePageChange(pages.length);
          e.preventDefault();
          break;
        case "+":
        case "=":
          if (e.ctrlKey || e.metaKey) {
            handleScaleChange(scale + SCALE_STEP);
            e.preventDefault();
          }
          break;
        case "-":
          if (e.ctrlKey || e.metaKey) {
            handleScaleChange(scale - SCALE_STEP);
            e.preventDefault();
          }
          break;
        case "0":
          if (e.ctrlKey || e.metaKey) {
            setScale(1);
            e.preventDefault();
          }
          break;
      }
    },
    [
      isLoading,
      currentPage,
      pages.length,
      scale,
      handlePageChange,
      handleScaleChange,
    ],
  );

  /* ---- Loading state ---- */
  if (isLoading && pages.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col h-full rounded-lg overflow-hidden",
          "bg-muted/30 border",
          className,
        )}
      >
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-background">
          <Skeleton className="h-7 w-7 rounded-md" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded-md" />
            <Skeleton className="h-7 w-20 rounded-md" />
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded-md" />
            <Skeleton className="h-7 w-14 rounded-md" />
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading document...</p>
          </div>
        </div>
      </div>
    );
  }

  /* ---- Error state ---- */
  if (error) {
    return (
      <div
        className={cn(
          "flex flex-col h-full rounded-lg overflow-hidden",
          "bg-muted/30 border",
          className,
        )}
      >
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3 text-center max-w-sm">
            <div className="p-3 rounded-full bg-destructive/10">
              <RotateCcw className="size-6 text-destructive" />
            </div>
            <div>
              <p className="font-medium">Failed to load document</p>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col h-full rounded-lg overflow-hidden",
        "bg-muted/30 border",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="document"
      aria-label="PDF Document Viewer"
    >
      {/* Toolbar */}
      <PDFToolbar
        currentPage={currentPage}
        totalPages={pages.length}
        scale={scale}
        showThumbnails={showThumbnails}
        onPageChange={handlePageChange}
        onScaleChange={handleScaleChange}
        onToggleThumbnails={() => setShowThumbnails(!showThumbnails)}
        onFitWidth={handleFitWidth}
        onFitPage={handleFitPage}
        isLoading={isLoading}
      />

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {/* Thumbnail sidebar */}
        {showThumbnails && (
          <div
            className={cn(
              "w-40 border-r bg-background/50",
              "flex flex-col overflow-hidden",
              "transition-all duration-200",
            )}
          >
            <div className="p-2 border-b">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Pages
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {pages.map((page, i) => (
                <PDFThumbnail
                  key={i + 1}
                  page={page}
                  pageNumber={i + 1}
                  isActive={currentPage === i + 1}
                  onClick={() => handlePageChange(i + 1)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Pages */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto relative bg-muted/50"
        >
          <div className="group/pages flex flex-col items-center gap-4 py-4 min-h-full">
            {pages.map((page, i) => {
              const pageNumber = i + 1;
              return (
                <PDFPage
                  key={pageNumber}
                  page={page}
                  pageNumber={pageNumber}
                  scale={scale}
                  containerWidth={containerWidth}
                  isVisible={
                    visiblePages.has(pageNumber) ||
                    Math.abs(currentPage - pageNumber) <= 2
                  }
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
