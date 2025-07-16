import { useState, useCallback, useRef } from "react";
import type { Node, Edge } from "@xyflow/react";

interface HistoryState {
  nodes: Node[];
  edges: Edge[];
}

interface UseWorkflowHistoryProps {
  maxHistorySize?: number;
  onHistoryChange?: (canUndo: boolean, hasUnsavedChanges: boolean) => void;
}

export function useWorkflowHistory({
  maxHistorySize = 50,
  onHistoryChange,
}: UseWorkflowHistoryProps = {}) {
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [lastSavedState, setLastSavedState] = useState<HistoryState | null>(
    null,
  );
  const isUpdatingFromHistory = useRef(false);

  // Check if current state differs from last saved state
  const hasUnsavedChanges = useCallback(
    (currentNodes: Node[], currentEdges: Edge[]) => {
      if (!lastSavedState)
        return currentNodes.length > 0 || currentEdges.length > 0;

      const nodesChanged =
        currentNodes.length !== lastSavedState.nodes.length ||
        !currentNodes.every((node, i) => {
          const savedNode = lastSavedState.nodes[i];
          return (
            savedNode &&
            node.id === savedNode.id &&
            node.position.x === savedNode.position.x &&
            node.position.y === savedNode.position.y &&
            JSON.stringify(node.data) === JSON.stringify(savedNode.data)
          );
        });

      const edgesChanged =
        currentEdges.length !== lastSavedState.edges.length ||
        !currentEdges.every((edge, i) => {
          const savedEdge = lastSavedState.edges[i];
          return (
            savedEdge &&
            edge.id === savedEdge.id &&
            edge.source === savedEdge.source &&
            edge.target === savedEdge.target
          );
        });

      return nodesChanged || edgesChanged;
    },
    [lastSavedState],
  );

  // Add new state to history
  const addToHistory = useCallback(
    (nodes: Node[], edges: Edge[]) => {
      if (isUpdatingFromHistory.current) {
        isUpdatingFromHistory.current = false;
        return;
      }

      setHistory((prev) => {
        // If we're not at the end of history, remove all states after current index
        const newHistory =
          currentHistoryIndex >= 0
            ? prev.slice(0, currentHistoryIndex + 1)
            : [];

        // Add new state
        newHistory.push({ nodes: [...nodes], edges: [...edges] });

        // Limit history size
        if (newHistory.length > maxHistorySize) {
          newHistory.shift();
        }

        return newHistory;
      });

      setCurrentHistoryIndex((prev) => {
        const newIndex = Math.min(prev + 1, maxHistorySize - 1);
        return newIndex;
      });

      // Notify about changes
      if (onHistoryChange) {
        const unsaved = hasUnsavedChanges(nodes, edges);
        onHistoryChange(true, unsaved);
      }
    },
    [currentHistoryIndex, maxHistorySize, onHistoryChange, hasUnsavedChanges],
  );

  // Undo to previous state
  const undo = useCallback(() => {
    if (currentHistoryIndex > 0) {
      isUpdatingFromHistory.current = true;
      const newIndex = currentHistoryIndex - 1;
      setCurrentHistoryIndex(newIndex);
      return history[newIndex];
    }
    return null;
  }, [currentHistoryIndex, history]);

  // Undo all changes to last saved state
  const undoAllChanges = useCallback(() => {
    if (lastSavedState) {
      isUpdatingFromHistory.current = true;
      setHistory([lastSavedState]);
      setCurrentHistoryIndex(0);
      return lastSavedState;
    }
    return null;
  }, [lastSavedState]);

  // Mark current state as saved
  const markAsSaved = useCallback(
    (nodes: Node[], edges: Edge[]) => {
      const savedState = { nodes: [...nodes], edges: [...edges] };
      setLastSavedState(savedState);

      // Clear history and start fresh from saved state
      setHistory([savedState]);
      setCurrentHistoryIndex(0);

      if (onHistoryChange) {
        onHistoryChange(false, false);
      }
    },
    [onHistoryChange],
  );

  // Initialize with saved state
  const initializeWithSavedState = useCallback(
    (nodes: Node[], edges: Edge[]) => {
      const initialState = { nodes: [...nodes], edges: [...edges] };
      setLastSavedState(initialState);
      setHistory([initialState]);
      setCurrentHistoryIndex(0);
    },
    [],
  );

  return {
    history,
    currentHistoryIndex,
    lastSavedState,
    canUndo: currentHistoryIndex > 0,
    canUndoToSave: !!lastSavedState && currentHistoryIndex > 0,
    hasUnsavedChanges,
    addToHistory,
    undo,
    undoAllChanges,
    markAsSaved,
    initializeWithSavedState,
    isUpdatingFromHistory: isUpdatingFromHistory.current,
  };
}
