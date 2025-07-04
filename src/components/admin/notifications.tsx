"use client";

import { useTranslations } from "next-intl";
import { CheckCircle, AlertTriangle } from "lucide-react";

export function SuccessNotification({ message }: { message: string }) {
  const tCommon = useTranslations("Common");
  return (
    <div className="flex items-start rounded-md border border-green-200 bg-green-50 p-4">
      <CheckCircle className="mt-0.5 mr-3 h-5 w-5 flex-shrink-0 text-green-500" />
      <div>
        <h3 className="text-sm font-medium text-green-800">
          {tCommon("Success")}
        </h3>
        <p className="mt-1 text-sm text-green-700">{message}</p>
      </div>
    </div>
  );
}

export function ErrorNotification({ message }: { message: string }) {
  const tCommon = useTranslations("Common");
  return (
    <div className="flex items-start rounded-md border border-red-200 bg-red-50 p-4">
      <AlertTriangle className="mt-0.5 mr-3 h-5 w-5 flex-shrink-0 text-red-500" />
      <div>
        <h3 className="text-sm font-medium text-red-800">{tCommon("Error")}</h3>
        <p className="mt-1 text-sm text-red-700">{message}</p>
      </div>
    </div>
  );
}
