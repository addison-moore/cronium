import type { Edge } from "@xyflow/react";
import { ConnectionType } from "@/shared/schema";
import {
  connectionStyles,
  getConnectionClasses,
  setEdgeConnectionType,
} from "../connection-edge-style";

describe("connectionStyles", () => {
  it.each([
    { type: ConnectionType.ALWAYS, label: "Always" },
    { type: ConnectionType.ON_SUCCESS, label: "On Success" },
    { type: ConnectionType.ON_FAILURE, label: "On Failure" },
    { type: ConnectionType.ON_CONDITION, label: "On Condition" },
  ])("labels $type as '$label'", ({ type, label }) => {
    expect(connectionStyles[type].label).toBe(label);
    expect(connectionStyles[type].color).toMatch(/^var\(--.+\)$/);
  });
});

describe("getConnectionClasses", () => {
  it.each([
    { type: ConnectionType.ALWAYS, className: "border-foreground" },
    { type: ConnectionType.ON_SUCCESS, className: "border-success" },
    { type: ConnectionType.ON_FAILURE, className: "border-destructive" },
    { type: ConnectionType.ON_CONDITION, className: "border-primary" },
  ])("maps $type to $className", ({ type, className }) => {
    expect(getConnectionClasses(type)).toBe(className);
  });
});

describe("setEdgeConnectionType", () => {
  const edges: Edge[] = [
    {
      id: "e1",
      source: "a",
      target: "b",
      data: { connectionType: ConnectionType.ALWAYS, note: "keep" },
    },
    {
      id: "e2",
      source: "b",
      target: "c",
      data: { connectionType: ConnectionType.ON_SUCCESS },
    },
  ];

  it("replaces the connection type only on the matching edge", () => {
    const result = setEdgeConnectionType(
      edges,
      "e1",
      ConnectionType.ON_FAILURE,
    );
    expect(result[0]!.data).toEqual({
      connectionType: ConnectionType.ON_FAILURE,
      note: "keep",
    });
    expect(result[1]!.data).toEqual({
      connectionType: ConnectionType.ON_SUCCESS,
    });
  });

  it("returns non-matching edges by reference and does not mutate the input", () => {
    const result = setEdgeConnectionType(
      edges,
      "e1",
      ConnectionType.ON_FAILURE,
    );
    expect(result[1]).toBe(edges[1]);
    expect(result[0]).not.toBe(edges[0]);
    expect(edges[0]!.data!.connectionType).toBe(ConnectionType.ALWAYS);
  });

  it("is a no-op when the edge id is not present", () => {
    const result = setEdgeConnectionType(
      edges,
      "missing",
      ConnectionType.ALWAYS,
    );
    expect(result).toEqual(edges);
  });
});
