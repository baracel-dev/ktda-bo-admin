/* Messages to farmers: campaigns staff send, and the automatic messages the
   platform sends on its own (payment notices, consent requests, one-time
   codes). Demo data until the messaging service is connected. An SMS of more
   than 160 characters goes as several parts, and each part is billed. */

export type MessageChannel = "SMS" | "USSD push" | "App";

export type MessageCampaign = {
  id: string;
  name: string;
  audience: string;
  channel: MessageChannel;
  status: "sent" | "scheduled" | "draft";
  /** When it went, or will go. */
  at: string;
  sentBy: string;
  recipients: number;
  delivered: number;
  failed: number;
  /** SMS parts per message. */
  parts: number;
  text: string;
};

export type AutoMessage = {
  id: string;
  name: string;
  trigger: string;
  channel: MessageChannel;
  /** This month so far. */
  sent: number;
  delivered: number;
  failed: number;
  parts: number;
  text: string;
};

/** SMS parts for a text: one up to 160 characters, then 153 a part (each
 *  part carries a header that joins them on the phone). */
export const smsParts = (text: string) => (text.length <= 160 ? 1 : Math.ceil(text.length / 153));

function withParts<T extends { text: string; parts: number }>(rows: Omit<T, "parts">[]): T[] {
  return rows.map((r) => ({ ...r, parts: smsParts(r.text) }) as T);
}

/** KES per SMS part, the aggregator's rate. */
export const SMS_PART_KES = 0.8;

export const MESSAGE_CAMPAIGNS: MessageCampaign[] = withParts<MessageCampaign>([
  {
    id: "msg_c1", name: "October green leaf payment is on the way", audience: "All farmers paid in the 6 November run", channel: "SMS", status: "sent",
    at: "2026-11-06T07:30:00Z", sentBy: "Faith Kamau", recipients: 18_240, delivered: 17_986, failed: 254,
    text: "KTDA: Your October green leaf payment is being sent to your wallet today. Dial *483*7# to check your balance.",
  },
  {
    id: "msg_c2", name: "Fertiliser vouchers: where to redeem", audience: "Farmers at Chinga, Gitugi and Ndima", channel: "SMS", status: "sent",
    at: "2026-11-03T08:00:00Z", sentBy: "Faith Kamau", recipients: 6_412, delivered: 6_301, failed: 111,
    text: "KTDA: Your fertiliser voucher can be used at any listed agro-dealer. Pay with your wallet at the till. Ask the shop for the KTDA voucher list before you buy. Help: 0800 720 000.",
  },
  {
    id: "msg_c3", name: "Agent cash-out now available in Nyamira", audience: "Farmers at Nyansiongo", channel: "USSD push", status: "sent",
    at: "2026-11-02T09:15:00Z", sentBy: "Anthony Mwenda", recipients: 3_128, delivered: 3_040, failed: 88,
    text: "KTDA: You can now cash out at Nyansiongo Cash Point (agent AG-2103). Carry your ID.",
  },
  {
    id: "msg_c4", name: "Never share your PIN", audience: "All active farmers", channel: "SMS", status: "scheduled",
    at: "2026-11-12T06:00:00Z", sentBy: "Kevin Baraka", recipients: 41_870, delivered: 0, failed: 0,
    text: "KTDA: No KTDA staff or agent will ever ask for your PIN. Report any request on 0800 720 000.",
  },
  {
    id: "msg_c5", name: "Mini bonus dates for Kericho factories", audience: "Farmers at Litein, Momul and Kapkoros", channel: "SMS", status: "draft",
    at: "2026-11-15T06:00:00Z", sentBy: "Faith Kamau", recipients: 9_604, delivered: 0, failed: 0,
    text: "KTDA: The mini bonus for your factory will be paid to your wallet on 20 November.",
  },
]);

export const AUTO_MESSAGES: AutoMessage[] = withParts<AutoMessage>([
  {
    id: "msg_a1", name: "Payment notice", trigger: "A farmer's line in a payment run is credited", channel: "SMS",
    sent: 18_011, delivered: 17_802, failed: 209,
    text: "KTDA: KES 7,412.00 received for 486 kg delivered to Litein in October. New balance KES 7,950.00. Ref TP6K2M9Q1.",
  },
  {
    id: "msg_a2", name: "Consent request", trigger: "A farmer is registered in bulk or by an agent", channel: "SMS",
    sent: 2_386, delivered: 2_351, failed: 35,
    text: "KTDA: Reply YES to receive your tea payments in a KTDA wallet on this number. Reply NO to decline.",
  },
  {
    id: "msg_a3", name: "One-time code", trigger: "Sign-in, PIN reset or a new device", channel: "SMS",
    sent: 9_517, delivered: 9_489, failed: 28,
    text: "KTDA: Your code is 482913. It expires in 5 minutes. Never share it with anyone.",
  },
  {
    id: "msg_a4", name: "Cash-out receipt", trigger: "A farmer cashes out at an agent", channel: "SMS",
    sent: 6_204, delivered: 6_150, failed: 54,
    text: "KTDA: You cashed out KES 3,000.00 at Kiprotich Agencies (AG-2041). New balance KES 4,950.00.",
  },
  {
    id: "msg_a5", name: "Voucher issued", trigger: "An input voucher is loaded to a wallet", channel: "SMS",
    sent: 6_398, delivered: 6_301, failed: 97,
    text: "KTDA: A fertiliser voucher of KES 4,500.00 is in your wallet. Use it at any listed agro-dealer.",
  },
  {
    id: "msg_a6", name: "Pay to M-PESA confirmation", trigger: "A farmer's payment is sent to their M-PESA line", channel: "SMS",
    sent: 4_872, delivered: 4_861, failed: 11,
    text: "KTDA: KES 2,000.00 sent to M-PESA 0722104233. Ref TPM8Z1C4X.",
  },
]);

const later = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));

export const getMessageCampaigns = () => later(MESSAGE_CAMPAIGNS);
export const getAutoMessages = () => later(AUTO_MESSAGES);
