import { getTwilioClient } from "./twilio";

export async function sendSMS(args: {
  to: string;
  body: string;
}): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER || "+1234567890";

  if (!accountSid || !authToken) {
    console.warn(`[SMS] Twilio credentials missing. Simulating sending SMS to ${args.to}: "${args.body}"`);
    return;
  }

  try {
    const client = getTwilioClient();
    await client.messages.create({
      to: args.to,
      from: from,
      body: args.body,
    });
    console.log(`[SMS] Successfully sent SMS to ${args.to}`);
  } catch (err: any) {
    console.error(`[SMS] Failed to send SMS to ${args.to}:`, err.message ?? err);
    throw err;
  }
}
