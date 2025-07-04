import axios, { AxiosError } from "axios";

/**
 * Execute an HTTP request
 * @param method HTTP method (GET, POST, etc)
 * @param url URL to call
 * @param headers Array of header objects with key/value pairs
 * @param body Body content for POST/PUT requests
 */
export async function executeHttpRequest(
  method: string = "GET",
  url: string = "",
  headers: Array<{ key: string; value: string }> = [],
  body: any = null,
): Promise<{ data: any; error?: string }> {
  if (!url) {
    return { data: null, error: "No URL provided for HTTP request" };
  }

  try {
    // Convert header array to object
    const headerObj: Record<string, string> = {};
    headers.forEach((header) => {
      if (header.key && header.value) {
        headerObj[header.key] = header.value;
      }
    });

    // Set up request configuration
    const config: any = {
      method: method || "GET",
      url,
      headers: headerObj,
      timeout: 30000, // 30-second timeout
    };

    // Add body for POST/PUT/PATCH
    if (
      ["POST", "PUT", "PATCH"].includes(config.method.toUpperCase()) &&
      body
    ) {
      try {
        // Determine if body is JSON or form data
        const contentType =
          headerObj["Content-Type"] || headerObj["content-type"];

        if (contentType?.includes("application/x-www-form-urlencoded")) {
          config.data = new URLSearchParams(body).toString();
        } else if (contentType?.includes("multipart/form-data")) {
          // Handle form data
          const formData = new FormData();
          Object.entries(body).forEach(([key, value]) => {
            formData.append(key, value as string);
          });
          config.data = formData;
        } else {
          // Default to JSON
          config.data = typeof body === "string" ? body : JSON.stringify(body);
        }
      } catch (bodyError) {
        console.error("Error processing request body:", bodyError);
        config.data = body; // Use body as-is if parsing fails
      }
    }

    console.log(`Executing HTTP ${config.method} request to ${url}`);
    const response = await axios(config);

    return {
      data: {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: response.data,
      },
    };
  } catch (err) {
    const error = err as AxiosError;
    console.error("HTTP request execution error:", error);

    // Return structured error response
    return {
      data: {
        status: error.response?.status || 0,
        statusText: error.response?.statusText || "Error",
        headers: error.response?.headers || {},
        body: error.response?.data || null,
      },
      error: error.message || "HTTP request failed",
    };
  }
}
