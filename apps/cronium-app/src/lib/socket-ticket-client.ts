import type { SocketTicketAudience } from "@/lib/socket-ticket";

interface SocketTicketResponse {
  ticket?: unknown;
}

export async function requestSocketTicket(
  audience: SocketTicketAudience,
): Promise<string> {
  const response = await fetch("/api/socket-ticket", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audience }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to authenticate the live connection");
  }

  const body = (await response.json()) as SocketTicketResponse;
  if (typeof body.ticket !== "string" || !body.ticket) {
    throw new Error("The live connection ticket response was invalid");
  }

  return body.ticket;
}

export function createSocketAuthProvider(
  audience: SocketTicketAudience,
): (callback: (auth: { ticket: string }) => void) => void {
  return (callback) => {
    void requestSocketTicket(audience)
      .then((ticket) => callback({ ticket }))
      .catch((error) => {
        console.error("Socket ticket request failed:", error);
        callback({ ticket: "" });
      });
  };
}
