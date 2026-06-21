import { checkAvailability, createBooking, cancelBooking, modifyBooking } from "../db/reservations";
import { logSessionEvent, makeEvent } from "../logging/session-logger";

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
      description: "Create a new reservation for a customer.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM" },
          partySize: { type: "number" },
          customerEmail: { type: "string", description: "Customer email address for notifications" },
          customerName: { type: "string", description: "Customer full name" },
          customerPhone: { type: "string", description: "Customer contact phone number" },
        },
        required: ["userId", "date", "time", "partySize", "customerEmail"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modify_booking",
      description: "Modify an existing reservation date, time, party size, or contact details.",
      parameters: {
        type: "object",
        properties: {
          bookingId: { type: "string", description: "The ID of the reservation to modify (e.g. BKG-XXXXXX)" },
          newDate: { type: "string", description: "New date in YYYY-MM-DD format" },
          newTime: { type: "string", description: "New time in HH:MM format" },
          newPartySize: { type: "number", description: "New party size/guests count" },
          customerName: { type: "string", description: "Updated customer name" },
          customerEmail: { type: "string", description: "Updated customer email" },
          customerPhone: { type: "string", description: "Updated customer phone" },
        },
        required: ["bookingId"],
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
          bookingId: { type: "string", description: "The ID of the reservation to cancel" },
        },
        required: ["bookingId"],
      },
    },
  },
];

export async function dispatchToolCall(
  name: string,
  args: Record<string, any>,
  clientId: string = "dummy-client-id",
  sessionId?: string,
  userId?: string
): Promise<string> {
  try {
    let result: string;
    switch (name) {
      case "check_availability": {
        const isAvail = await checkAvailability(args.date, args.time, clientId);
        result = JSON.stringify({ available: isAvail });
        break;
      }
      
      case "create_booking": {
        const booking = await createBooking({
          userId: args.userId,
          clientId: clientId,
          date: args.date,
          time: args.time,
          partySize: args.partySize,
          customerEmail: args.customerEmail,
          customerName: args.customerName,
          customerPhone: args.customerPhone,
        });

        // Log calendar and email outcomes as session events if context is present
        if (sessionId && userId) {
          await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "calendar_sync", {
            bookingId: booking.id,
            status: "synced",
            eventId: booking.calendarEventId || "MOCK",
          }));
          await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "email_dispatch", {
            bookingId: booking.id,
            email: booking.customerEmail,
            status: "sent",
          }));
        }

        result = JSON.stringify({ success: true, booking });
        break;
      }

      case "modify_booking": {
        const booking = await modifyBooking(
          args.bookingId,
          {
            date: args.newDate,
            time: args.newTime,
            partySize: args.newPartySize,
            customerName: args.customerName,
            customerEmail: args.customerEmail,
            customerPhone: args.customerPhone,
          },
          clientId
        );

        if (sessionId && userId) {
          await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "calendar_sync", {
            bookingId: booking.id,
            status: "updated",
            eventId: booking.calendarEventId || "MOCK",
          }));
          if (booking.customerEmail) {
            await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "email_dispatch", {
              bookingId: booking.id,
              email: booking.customerEmail,
              status: "sent_update",
            }));
          }
        }

        result = JSON.stringify({ success: true, booking });
        break;
      }

      case "cancel_booking": {
        const success = await cancelBooking(args.bookingId, clientId);

        if (success && sessionId && userId) {
          await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "calendar_sync", {
            bookingId: args.bookingId,
            status: "deleted",
          }));
          await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "email_dispatch", {
            bookingId: args.bookingId,
            status: "sent_cancellation",
          }));
        }

        result = JSON.stringify({ success });
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    if (sessionId && userId) {
      await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "tool_invocation", {
        tool: name,
        arguments: args,
        success: true,
      }));
    }

    return result;
  } catch (err: any) {
    const errMsg = err.message || "Tool execution failed";
    if (sessionId && userId) {
      await logSessionEvent(makeEvent({ sessionId, userId, clientId }, "tool_invocation", {
        tool: name,
        arguments: args,
        success: false,
        error: errMsg,
      }));
    }
    return JSON.stringify({ error: errMsg });
  }
}
