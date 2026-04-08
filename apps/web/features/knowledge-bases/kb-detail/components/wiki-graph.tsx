"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

interface GraphNode extends SimulationNodeDatum {
  id: string;
  label: string;
}

interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

const NODE_RADIUS = 6;
const HIT_RADIUS = 20;
const LABEL_FONT = "12px Inter, system-ui, sans-serif";
const ARROW_SIZE = 6;

export function WikiGraph({
  knowledgeBaseId,
  onSelectPage,
}: {
  knowledgeBaseId: string;
  onSelectPage: (path: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(
    null,
  );
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const connectionCountRef = useRef<Map<string, number>>(new Map());
  const hoveredRef = useRef<GraphNode | null>(null);
  const dragRef = useRef<{
    node: GraphNode;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState<string | null>(null);

  const { data, isLoading } = trpc.knowledgeBases.wikiGraph.useQuery({
    knowledgeBaseId,
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const { x: tx, y: ty, k } = transformRef.current;

    // Read theme colors from CSS variables
    const styles = getComputedStyle(canvas);
    const fgColor = styles.getPropertyValue("--foreground").trim() || "0 0% 15%";
    const mutedFgColor =
      styles.getPropertyValue("--muted-foreground").trim() || "0 0% 40%";
    const primaryColor =
      styles.getPropertyValue("--primary").trim() || "220 60% 50%";

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(tx + w / 2, ty + h / 2);
    ctx.scale(k, k);

    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const hoveredId = hoveredRef.current?.id ?? null;

    // Build set of connected node IDs for hovered node
    const connectedIds = new Set<string>();
    if (hoveredId) {
      for (const edge of edges) {
        const sId = typeof edge.source === "string" ? edge.source : (edge.source as GraphNode).id;
        const tId = typeof edge.target === "string" ? edge.target : (edge.target as GraphNode).id;
        if (sId === hoveredId) connectedIds.add(tId);
        if (tId === hoveredId) connectedIds.add(sId);
      }
    }

    // Draw edges
    for (const edge of edges) {
      const source = edge.source as GraphNode;
      const target = edge.target as GraphNode;
      if (
        source.x == null ||
        source.y == null ||
        target.x == null ||
        target.y == null
      )
        continue;

      const isConnected =
        hoveredId !== null &&
        (source.id === hoveredId || target.id === hoveredId);
      const isDimmed = hoveredId !== null && !isConnected;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;

      // Shorten line to stop at node edge
      const sx = source.x + ux * NODE_RADIUS;
      const sy = source.y + uy * NODE_RADIUS;
      const ex = target.x - ux * (NODE_RADIUS + ARROW_SIZE);
      const ey = target.y - uy * (NODE_RADIUS + ARROW_SIZE);

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = isConnected
        ? `hsl(${primaryColor} / 0.8)`
        : isDimmed
          ? "rgba(140,140,160,0.12)"
          : "rgba(140,140,160,0.35)";
      ctx.lineWidth = (isConnected ? 2 : 1.2) / k;
      ctx.stroke();

      // Arrowhead
      const ax = target.x - ux * NODE_RADIUS;
      const ay = target.y - uy * NODE_RADIUS;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(
        ax - ux * ARROW_SIZE + uy * (ARROW_SIZE / 2.5),
        ay - uy * ARROW_SIZE - ux * (ARROW_SIZE / 2.5),
      );
      ctx.lineTo(
        ax - ux * ARROW_SIZE - uy * (ARROW_SIZE / 2.5),
        ay - uy * ARROW_SIZE + ux * (ARROW_SIZE / 2.5),
      );
      ctx.closePath();
      ctx.fillStyle = isConnected
        ? `hsl(${primaryColor} / 0.8)`
        : isDimmed
          ? "rgba(140,140,160,0.2)"
          : "rgba(140,140,160,0.5)";
      ctx.fill();
    }

    // Draw nodes
    for (const node of nodes) {
      if (node.x == null || node.y == null) continue;
      const isHovered = hoveredId === node.id;
      const isNeighbor = connectedIds.has(node.id);
      const isDimmed = hoveredId !== null && !isHovered && !isNeighbor;

      const connections = connectionCountRef.current.get(node.id) ?? 0;
      const r = NODE_RADIUS + Math.min(connections, 8) * 0.8;

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isDimmed
        ? `hsl(${primaryColor} / 0.25)`
        : isHovered
          ? `hsl(${primaryColor})`
          : `hsl(${primaryColor} / 0.8)`;
      ctx.fill();

      if (isHovered || isNeighbor) {
        ctx.strokeStyle = `hsl(${primaryColor} / ${isHovered ? "0.5" : "0.35"})`;
        ctx.lineWidth = 2 / k;
        ctx.stroke();
      }

      // Label
      ctx.font = LABEL_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isDimmed
        ? `hsl(${mutedFgColor} / 0.3)`
        : isHovered || isNeighbor
          ? `hsl(${fgColor})`
          : `hsl(${mutedFgColor})`;
      ctx.fillText(node.label, node.x, node.y + r + 4);
    }

    ctx.restore();
  }, []);

  // Resize canvas to fit container
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    draw();
  }, [draw]);

  // Initialize simulation when data arrives
  useEffect(() => {
    if (!data || data.nodes.length === 0) return;

    const nodes: GraphNode[] = data.nodes.map((n) => ({ ...n }));
    const edges: GraphEdge[] = data.edges.map((e) => ({ ...e }));
    nodesRef.current = nodes;
    edgesRef.current = edges;

    // Precompute connection counts per node
    const counts = new Map<string, number>();
    for (const edge of data.edges) {
      counts.set(edge.source as string, (counts.get(edge.source as string) ?? 0) + 1);
      counts.set(edge.target as string, (counts.get(edge.target as string) ?? 0) + 1);
    }
    connectionCountRef.current = counts;

    // Scale forces based on graph density for better layout
    const density = nodes.length > 0 ? edges.length / nodes.length : 0;
    const linkDist = density > 2 ? 160 : 120;
    const chargeStr = density > 2 ? -500 : -300;
    const collideRadius = density > 2 ? 55 : 40;

    const sim = forceSimulation(nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphEdge>(edges)
          .id((d) => d.id)
          .distance(linkDist),
      )
      .force("charge", forceManyBody().strength(chargeStr))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide(collideRadius))
      .on("tick", draw);

    simRef.current = sim;

    resize();

    return () => {
      sim.stop();
    };
  }, [data, draw, resize]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [resize]);

  // Hit-test helper
  const hitTest = useCallback(
    (clientX: number, clientY: number): GraphNode | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const { x: tx, y: ty, k } = transformRef.current;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      // Convert screen coords to graph coords
      const gx = ((clientX - rect.left) - tx - w / 2) / k;
      const gy = ((clientY - rect.top) - ty - h / 2) / k;

      for (const node of nodesRef.current) {
        if (node.x == null || node.y == null) continue;
        const dx = gx - node.x;
        const dy = gy - node.y;
        if (dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS) return node;
      }
      return null;
    },
    [],
  );

  // Mouse events
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragRef.current) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const { x: tx, y: ty, k } = transformRef.current;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;

        const gx = ((e.clientX - rect.left) - tx - w / 2) / k;
        const gy = ((e.clientY - rect.top) - ty - h / 2) / k;

        dragRef.current.node.fx = gx;
        dragRef.current.node.fy = gy;
        simRef.current?.alpha(0.3).restart();
        return;
      }

      const node = hitTest(e.clientX, e.clientY);
      hoveredRef.current = node;
      setHovered(node?.id ?? null);
      draw();
    },
    [hitTest, draw],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const node = hitTest(e.clientX, e.clientY);
      if (node) {
        dragRef.current = { node, offsetX: 0, offsetY: 0 };
        node.fx = node.x;
        node.fy = node.y;
        simRef.current?.alphaTarget(0.3).restart();
      }
    },
    [hitTest],
  );

  const handleMouseUp = useCallback(() => {
    if (dragRef.current) {
      const node = dragRef.current.node;
      dragRef.current = null;
      node.fx = null;
      node.fy = null;
      simRef.current?.alphaTarget(0);
    }
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragRef.current) return;
      const node = hitTest(e.clientX, e.clientY);
      if (node) onSelectPage(node.id);
    },
    [hitTest, onSelectPage],
  );

  // Zoom with scroll
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;
      const scaleFactor = e.deltaY > 0 ? 0.92 : 1.08;
      const newK = Math.max(0.2, Math.min(5, t.k * scaleFactor));
      transformRef.current = { ...t, k: newK };
      draw();
    },
    [draw],
  );

  // Pan
  const panRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    // Only start pan if no node is under cursor
    const node = hitTest(e.clientX, e.clientY);
    if (node) return;
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      tx: transformRef.current.x,
      ty: transformRef.current.y,
    };
  }, [hitTest]);

  const handlePanMove = useCallback(
    (e: React.MouseEvent) => {
      if (!panRef.current || dragRef.current) return;
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      transformRef.current = {
        ...transformRef.current,
        x: panRef.current.tx + dx,
        y: panRef.current.ty + dy,
      };
      draw();
    },
    [draw],
  );

  const handlePanEnd = useCallback(() => {
    panRef.current = null;
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No wiki pages yet. Ingest some source documents to create pages.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ cursor: hovered ? "pointer" : "grab" }}
        onMouseDown={(e) => {
          handleMouseDown(e);
          handlePanStart(e);
        }}
        onMouseMove={(e) => {
          handleMouseMove(e);
          handlePanMove(e);
        }}
        onMouseUp={() => {
          handleMouseUp();
          handlePanEnd();
        }}
        onMouseLeave={() => {
          handleMouseUp();
          handlePanEnd();
        }}
        onClick={handleClick}
        onWheel={handleWheel}
      />
      <div className="absolute bottom-3 right-3 text-[10px] text-muted-foreground bg-background/80 px-2 py-1 rounded border">
        {data.nodes.length} pages &middot; {data.edges.length} links
      </div>
    </div>
  );
}
