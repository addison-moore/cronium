"use client";
import { CheckCircle, AlertTriangle } from "lucide-react";

export function SuccessNotification({ message }: { message: string }) {
  return (
    <div className="border-success/40 bg-success/10 flex items-start rounded-md border p-4">
      <CheckCircle className="text-success mt-0.5 mr-3 h-5 w-5 flex-shrink-0" />
      <div>
        <h3 className="text-success-text text-sm font-medium">Success</h3>
        <p className="text-success-text mt-1 text-sm">{message}</p>
      </div>
    </div>
  );
}

export function ErrorNotification({ message }: { message: string }) {
  return (
    <div className="border-destructive/40 bg-destructive/10 flex items-start rounded-md border p-4">
      <AlertTriangle className="text-destructive mt-0.5 mr-3 h-5 w-5 flex-shrink-0" />
      <div>
        <h3 className="text-destructive-text text-sm font-medium">Error</h3>
        <p className="text-destructive-text mt-1 text-sm">{message}</p>
      </div>
    </div>
  );
}
