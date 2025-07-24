import { useState, useCallback, useEffect, useRef } from "react";
import { useToast } from "@cronium/ui";

interface UseOptimisticUpdateOptions<T> {
  items: T[];
  keyExtractor: (item: T) => string | number;
  onSuccess?: (updatedItems: T[]) => void;
  onError?: (error: Error, originalItems: T[]) => void;
}

/**
 * A custom hook for implementing optimistic UI updates
 */
export function useOptimisticUpdate<T>({
  items,
  keyExtractor,
  onSuccess,
  onError,
}: UseOptimisticUpdateOptions<T>) {
  // Ensure items is always an array, even if it's undefined or null
  const safeItems = Array.isArray(items) ? items : [];
  const [optimisticItems, setOptimisticItems] = useState<T[]>(safeItems);
  const { toast } = useToast();

  // Use useEffect to safely update optimistic items when items change
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    if (items !== undefined && items.length > 0) {
      setOptimisticItems(safeItems);
    }
  }, [safeItems]);

  const updateItem = useCallback(
    async (
      itemId: string | number,
      updater: (item: T) => T,
      apiCall: () => Promise<T>,
      successMessage?: string,
      errorMessage?: string,
    ) => {
      try {
        // Find the item to update
        const itemIndex = optimisticItems.findIndex(
          (item) => keyExtractor(item) === itemId,
        );

        if (itemIndex === -1) {
          throw new Error("Item not found");
        }

        // Make a copy of the current items
        const originalItems = [...optimisticItems];

        // Apply the optimistic update
        const currentItem = originalItems[itemIndex];
        if (!currentItem) {
          console.error(`Item not found at index ${itemIndex}`);
          return;
        }
        const updatedItem = updater(currentItem);
        const updatedItems = [...originalItems];
        updatedItems[itemIndex] = updatedItem;

        // Update the state immediately for optimistic UI
        setOptimisticItems(updatedItems);

        // Make the API call to persist the changes
        await apiCall();

        // If successful, show success message and call onSuccess
        if (successMessage) {
          toast({
            title: "Success",
            description: successMessage,
          });
        }

        if (onSuccess) {
          onSuccess(updatedItems);
        }

        return true;
      } catch (error) {
        // Revert to the original items on error
        setOptimisticItems(safeItems);

        // Show error message and call onError
        if (errorMessage) {
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          });
        }

        if (onError && error instanceof Error) {
          onError(error, safeItems);
        }

        console.error("Optimistic update failed:", error);
        return false;
      }
    },
    [optimisticItems, safeItems, keyExtractor, toast, onSuccess, onError],
  );

  const deleteItem = useCallback(
    async (
      itemId: string | number,
      apiCall: () => Promise<T>,
      successMessage?: string,
      errorMessage?: string,
    ) => {
      try {
        // Make a copy of the current items
        const originalItems = [...optimisticItems];

        // Filter out the item to delete
        const updatedItems = originalItems.filter(
          (item) => keyExtractor(item) !== itemId,
        );

        // Update the state immediately for optimistic UI
        setOptimisticItems(updatedItems);

        // Make the API call to persist the changes
        await apiCall();

        // If successful, show success message and call onSuccess
        if (successMessage) {
          toast({
            title: "Success",
            description: successMessage,
          });
        }

        if (onSuccess) {
          onSuccess(updatedItems);
        }

        return true;
      } catch (error) {
        // Revert to the original items on error
        setOptimisticItems(safeItems);

        // Show error message and call onError
        if (errorMessage) {
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          });
        }

        if (onError && error instanceof Error) {
          onError(error, safeItems);
        }

        console.error("Optimistic delete failed:", error);
        return false;
      }
    },
    [optimisticItems, safeItems, keyExtractor, toast, onSuccess, onError],
  );

  const addItem = useCallback(
    async (
      newItem: T,
      apiCall: () => Promise<T>,
      successMessage?: string,
      errorMessage?: string,
    ) => {
      try {
        // Make a copy of the current items
        const originalItems = [...optimisticItems];

        // Add the new item
        const updatedItems = [newItem, ...originalItems];

        // Update the state immediately for optimistic UI
        setOptimisticItems(updatedItems);

        // Make the API call to persist the changes
        await apiCall();

        // If successful, show success message and call onSuccess
        if (successMessage) {
          toast({
            title: "Success",
            description: successMessage,
          });
        }

        if (onSuccess) {
          onSuccess(updatedItems);
        }

        return true;
      } catch (error) {
        // Revert to the original items on error
        setOptimisticItems(safeItems);

        // Show error message and call onError
        if (errorMessage) {
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          });
        }

        if (onError && error instanceof Error) {
          onError(error, safeItems);
        }

        console.error("Optimistic add failed:", error);
        return false;
      }
    },
    [optimisticItems, safeItems, toast, onSuccess, onError],
  );

  return {
    items: optimisticItems,
    updateItem,
    deleteItem,
    addItem,
    setItems: setOptimisticItems,
  };
}
