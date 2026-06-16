import { checkAvailability, createBooking, cancelBooking } from "../db/reservations";

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Check if a specific date and time slot is available for booking.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          time: { type: "string", description: "Time in HH:MM format (24-hour)" },
        },
        required: ["date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking",
      description: "Create a new reservation.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM" },
          partySize: { type: "number" },
        },
        required: ["userId", "date", "time", "partySize"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_booking",
      description: "Cancel an existing reservation by ID.",
      parameters: {
        type: "object",
        properties: {
          bookingId: { type: "string" },
        },
        required: ["bookingId"],
      },
    },
  },
];

export async function dispatchToolCall(name: string, args: Record<string, any>, clientId: string = "dummy-client-id"): Promise<string> {
  try {
    switch (name) {
      case "check_availability": {
        const isAvail = await checkAvailability(args.date, args.time);
        return JSON.stringify({ available: isAvail });
      }
      case "create_booking": {
        const booking = await createBooking({
          userId: args.userId,
          clientId: clientId,
          date: args.date,
          time: args.time,
          partySize: args.partySize,
        });
        return JSON.stringify({ success: true, booking });
      }
      case "cancel_booking": {
        const success = await cancelBooking(args.bookingId);
        return JSON.stringify({ success });
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message || "Tool execution failed" });
  }
}
