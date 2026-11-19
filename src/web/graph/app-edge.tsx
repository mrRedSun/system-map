import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { bezierAt, edgePath, type Side } from './edge-labels';

export interface AppEdgeData extends Record<string, unknown> {
  label?: string;
  /** Where along the edge the label goes (bezier t), chosen by `placeLabels`. */
  labelAt?: number;
}

export type AppFlowEdge = Edge<AppEdgeData, 'app'>;

/** Bezier edge (`edgePath`) whose label sits at a chosen spot, computed from the live path. */
export function AppEdge(props: EdgeProps<AppFlowEdge>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const path = edgePath(
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition as Side,
    targetPosition as Side,
  );
  const at =
    data?.label && data.labelAt !== undefined
      ? bezierAt(
          sourceX,
          sourceY,
          targetX,
          targetY,
          sourcePosition as Side,
          targetPosition as Side,
          data.labelAt,
        )
      : undefined;
  return (
    <>
      <BaseEdge path={path} style={props.style} markerEnd={props.markerEnd} interactionWidth={14} />
      {at && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded border bg-background/95 px-1 text-[11px] leading-4 whitespace-nowrap text-foreground shadow-xs"
            // Above highlighted edges (z-index 20), so lines never strike through the text.
            style={{
              transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`,
              zIndex: 1000,
            }}
          >
            {data!.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
