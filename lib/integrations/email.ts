import { Resend } from "resend";
import type { Booking } from "../db/reservations";

/**
 * Dispatches an email notification to the customer via Resend.
 * Handles confirmations, updates, and cancellations.
 */
export async function sendBookingConfirmation(
  email: string,
  booking: Booking,
  isUpdate = false
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[Email Integration] RESEND_API_KEY is not set. Skipping email dispatch.");
    return;
  }

  const resend = new Resend(apiKey);
  const isCancelled = booking.status === "cancelled";
  
  let subject = `Booking Confirmed: ${booking.date} at ${booking.time}`;
  let statusText = "Confirmed";
  let statusColor = "#10b981"; // Green
  
  if (isCancelled) {
    subject = `Booking Cancelled: ${booking.date}`;
    statusText = "Cancelled";
    statusColor = "#ef4444"; // Red
  } else if (isUpdate) {
    subject = `Booking Updated: ${booking.date} at ${booking.time}`;
    statusText = "Updated";
    statusColor = "#3b82f6"; // Blue
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; rounded-corners: 8px;">
      <h2 style="color: ${statusColor}; margin-bottom: 5px;">VOXERA Reservation ${statusText}</h2>
      <p style="color: #4b5563; font-size: 14px;">Hello ${booking.customerName || "there"},</p>
      <p style="color: #4b5563; font-size: 14px;">Your reservation (ID: <strong style="font-family: monospace;">${booking.id}</strong>) has been successfully <strong>${statusText.toLowerCase()}</strong>.</p>
      
      <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; border: 1px solid #f3f4f6; margin: 20px 0;">
        <ul style="list-style: none; padding: 0; margin: 0; font-size: 14px; color: #374151; line-height: 1.6;">
          <li><strong>Date:</strong> ${booking.date}</li>
          <li><strong>Time:</strong> ${booking.time}</li>
          <li><strong>Party Size:</strong> ${booking.partySize} guests</li>
          ${booking.customerPhone ? `<li><strong>Phone:</strong> ${booking.customerPhone}</li>` : ""}
          <li><strong>Email:</strong> ${email}</li>
        </ul>
      </div>
      
      <p style="color: #4b5563; font-size: 14px;">If you need to make further modifications or cancel your booking, please call our VOXERA receptionist line.</p>
      <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 30px 0 15px 0;" />
      <p style="color: #9ca3af; font-size: 11px; text-align: center;">Powered by VOXERA Agentic AI Receptionist Platform</p>
    </div>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: "VOXERA Receptionist <onboarding@resend.dev>",
      to: [email],
      subject,
      html,
    });

    if (error) {
      console.error("[Email Integration] Resend API Error:", error);
    } else {
      console.log(`[Email Integration] Successfully sent ${statusText.toLowerCase()} email to ${email}. ID: ${data?.id}`);
    }
  } catch (err) {
    console.error("[Email Integration] Failed to send email:", err);
  }
}
