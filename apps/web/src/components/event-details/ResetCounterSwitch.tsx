"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

interface ResetCounterSwitchProps {
  eventId: number;
  initialValue: boolean;
  langParam: string;
}

export function ResetCounterSwitch({
  eventId,
  initialValue,
  langParam,
}: ResetCounterSwitchProps) {
  const [isChecked, setIsChecked] = useState(initialValue);
  const router = useRouter();

  // tRPC mutation for saving reset counter setting
  const updateEventMutation = trpc.events.update.useMutation({
    onSuccess: () => {
      toast({
        title: "Setting Saved",
        description: `Reset counter on activate has been ${isChecked ? "enabled" : "disabled"}.`,
        duration: 3000,
      });

      // Force a refresh of the event details page
      router.refresh();

      // Navigate back to the event detail page
      router.push(`/${langParam}/dashboard/events/${eventId}`);
    },
    onError: (error) => {
      console.error("Error saving reset counter setting:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save setting",
        variant: "destructive",
        duration: 5000,
      });
    },
  });

  const handleSwitchChange = (newValue: boolean) => {
    setIsChecked(newValue);
  };

  const saveResetCounterSetting = async () => {
    try {
      console.log(
        `Saving reset counter setting for event ${eventId}: ${isChecked}`,
      );

      await updateEventMutation.mutateAsync({
        id: eventId,
        resetCounterOnActive: isChecked,
      });
    } catch {
      // Error handled by mutation onError
    }
  };

  return (
    <div className="bg-accent/50 mb-6 rounded-lg p-4">
      <h3 className="mb-2 text-lg font-semibold">Reset Counter Setting</h3>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Label htmlFor="reset-counter-switch" className="font-medium">
            Reset counter when activated
          </Label>
          <p className="text-muted-foreground mt-1 text-sm">
            When enabled, the execution counter will be reset to zero whenever
            this event is activated
          </p>
        </div>
        <Switch
          id="reset-counter-switch"
          checked={isChecked}
          onCheckedChange={handleSwitchChange}
        />
      </div>
      <Button
        onClick={saveResetCounterSetting}
        className="w-full"
        disabled={updateEventMutation.isPending}
      >
        {updateEventMutation.isPending ? "Saving..." : "Save Setting"}
      </Button>
    </div>
  );
}
