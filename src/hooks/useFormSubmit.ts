'use client';

import { useState } from 'react';
import { toast } from '@/components/ui/use-toast';

interface UseFormSubmitOptions<T> {
  endpoint: string;
  method?: 'POST' | 'PUT';
  onSuccess?: (data: any) => void;
  onError?: (error: any) => void;
  successMessage?: string;
  errorMessage?: string;
}

/**
 * A custom hook for handling form submissions with standardized error handling and loading states.
 */
export function useFormSubmit<T>({
  endpoint,
  method = 'POST',
  onSuccess,
  onError,
  successMessage = 'Successfully saved',
  errorMessage = 'An error occurred',
}: UseFormSubmitOptions<T>) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitForm = async (data: T) => {
    try {
      setIsSubmitting(true);
      setError(null);

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorMessage);
      }

      const responseData = await response.json();
      
      toast({
        title: 'Success',
        description: successMessage,
        variant: 'success',
      });

      if (onSuccess) {
        onSuccess(responseData);
      }
      
      return responseData;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : errorMessage;
      setError(errorMsg);
      
      // Call the onError handler if provided
      if (onError) {
        onError(err);
      } else {
        // Default error toast if no custom handler
        toast({
          title: 'Error',
          description: errorMsg,
          variant: 'destructive',
        });
      }
      
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    submitForm,
    isSubmitting,
    error,
  };
}