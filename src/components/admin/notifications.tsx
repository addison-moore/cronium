"use client";

import { useTranslations } from "next-intl";
import { CheckCircle, AlertTriangle } from "lucide-react";

export function SuccessNotification({ message }: { message: string }) {
  const tCommon = useTranslations("Common");
  return (
    <div className="bg-green-50 border border-green-200 rounded-md p-4 flex items-start">
      <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
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
    <div className="bg-red-50 border border-red-200 rounded-md p-4 flex items-start">
      <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 mr-3 flex-shrink-0" />
      <div>
        <h3 className="text-sm font-medium text-red-800">{tCommon("Error")}</h3>
        <p className="mt-1 text-sm text-red-700">{message}</p>
      </div>
    </div>
  );
}
