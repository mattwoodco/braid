import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Agent } from "../data/mock";
import type { AgentState, AgentStatus } from "../state/derive";

type Props = {
  agents: Agent[];
  states: Map<string, AgentState>;
  selectedAgentKey: string;
  onSelect: (key: string) => void;
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: "var(--muted)",
  active: "var(--flow-edge)",
  done: "var(--success-text)",
};

type AgentNodeData = {
  agent: Agent;
  state: AgentState | undefined;
  selected: boolean;
  variant: "director" | "sub";
};

const NODE_WIDTH_DIRECTOR = 320;
const NODE_WIDTH_SUB = 240;
const NODE_HEIGHT = 96;
const ROW_GAP = 140;
const COL_GAP = 32;

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const { agent, state, selected, variant } = data;
  const status = state?.status ?? "idle";
  const isActive = status === "active";
  return (
    <div
      className={isActive ? "braid-node--shimmer" : undefined}
      style={{
        textAlign: "left",
        padding: variant === "director" ? "14px 18px" : "12px 14px",
        width: variant === "director" ? NODE_WIDTH_DIRECTOR : NODE_WIDTH_SUB,
        background: selected ? "var(--node-card-selected)" : "var(--node-card)",
        color: "var(--node-text)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: selected ? "0 0 0 2px var(--accent)" : "var(--paper-shadow)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: STATUS_COLOR[status],
            flex: "0 0 auto",
          }}
        />
        <span style={{ fontSize: variant === "director" ? 14 : 13, fontWeight: 500 }}>
          {agent.name}
        </span>
        {variant === "director" ? (
          <span
            style={{
              fontSize: 10,
              color: "var(--accent)",
              border: "1px solid var(--border)",
              padding: "1px 6px",
              borderRadius: 4,
              marginLeft: "auto",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            director
          </span>
        ) : null}
      </span>
      <span style={{ fontSize: 11, color: "var(--node-footer-muted)" }}>{agent.model}</span>
      <span
        style={{
          fontSize: 12,
          color: "var(--muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          minHeight: variant === "director" ? 30 : 18,
        }}
      >
        {state?.lastMessage ?? <em style={{ opacity: 0.6 }}>no activity yet</em>}
      </span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

function GraphInner({ agents, states, selectedAgentKey, onSelect }: Props) {
  const rf = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    const director = agents.find((a) => a.isDirector) ?? agents[0];
    const subs = agents.filter((a) => !a.isDirector);

    const totalSubsWidth =
      subs.length * NODE_WIDTH_SUB + Math.max(0, subs.length - 1) * COL_GAP;
    const subsStartX = -totalSubsWidth / 2;

    const directorNode: Node<AgentNodeData> = {
      id: director.key,
      type: "agent",
      position: { x: -NODE_WIDTH_DIRECTOR / 2, y: 0 },
      data: {
        agent: director,
        state: states.get(director.key),
        selected: selectedAgentKey === director.key,
        variant: "director",
      },
      draggable: false,
    };

    const subNodes: Node<AgentNodeData>[] = subs.map((a, i) => ({
      id: a.key,
      type: "agent",
      position: {
        x: subsStartX + i * (NODE_WIDTH_SUB + COL_GAP),
        y: NODE_HEIGHT + ROW_GAP,
      },
      data: {
        agent: a,
        state: states.get(a.key),
        selected: selectedAgentKey === a.key,
        variant: "sub",
      },
      draggable: false,
    }));

    const flowEdges: Edge[] = subs.map((a) => {
      const isActive = states.get(a.key)?.status === "active";
      return {
        id: `${director.key}->${a.key}`,
        source: director.key,
        target: a.key,
        type: "smoothstep",
        animated: isActive,
      };
    });

    return { nodes: [directorNode, ...subNodes], edges: flowEdges };
  }, [agents, states, selectedAgentKey]);

  return (
    <ReactFlow
      className="braid-flow-canvas"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => onSelect(n.id)}
      onInit={(inst) => inst.fitView({ padding: 0.2, duration: 0 })}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      panOnDrag
      zoomOnScroll
      proOptions={{ hideAttribution: true }}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      onNodesChange={() => {
        // refit on node count change (flow switch) is handled via key prop above; no-op here
        rf.getNodes();
      }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function AgentGraph(props: Props) {
  // Key by flow signature so fitView re-runs when agents change.
  const flowKey = props.agents.map((a) => a.key).join(",");
  return (
    <ReactFlowProvider key={flowKey}>
      <GraphInner {...props} />
    </ReactFlowProvider>
  );
}
