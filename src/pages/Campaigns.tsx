import { useState } from "react";
import { getAutoMessages, getMessageCampaigns, SMS_PART_KES, type AutoMessage, type MessageCampaign } from "../mock/fixtures/messages";
import {
  PageHeader, Badge, DataTable, Skeleton, Money, GlassPanel, GlassStat, StatRail, SectionTitle, Modal, formatDateTime, type Column,
} from "../ui";
import { MessageSquare, CheckCircle2, AlertTriangle, Coins } from "lucide-react";
import { useAsyncData } from "../lib/useAsyncData";

/* Messages to farmers: the campaigns staff send, and the automatic messages
   the platform sends itself (payment notices, consent requests, one-time
   codes), with how many went, how many arrived and the SMS parts billed.
   Demo data until the messaging service is connected. */

const STATUS: Record<MessageCampaign["status"], { tone: "success" | "info" | "neutral"; label: string }> = {
  sent: { tone: "success", label: "Sent" },
  scheduled: { tone: "info", label: "Scheduled" },
  draft: { tone: "neutral", label: "Draft" },
};

const n = (v: number) => v.toLocaleString("en-KE");
const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");
const smsCount = (sent: number, parts: number) => sent * parts;

export default function Campaigns() {
  const { data: campaigns, loading } = useAsyncData(getMessageCampaigns);
  const { data: autos } = useAsyncData(getAutoMessages);
  const [open, setOpen] = useState<{ title: string; text: string; parts: number } | null>(null);

  const sentCampaigns = (campaigns ?? []).filter((c) => c.status === "sent");
  const all = [
    ...sentCampaigns.map((c) => ({ sent: c.recipients, delivered: c.delivered, failed: c.failed, parts: c.parts })),
    ...(autos ?? []).map((a) => ({ sent: a.sent, delivered: a.delivered, failed: a.failed, parts: a.parts })),
  ];
  const sent = all.reduce((s, m) => s + m.sent, 0);
  const delivered = all.reduce((s, m) => s + m.delivered, 0);
  const failed = all.reduce((s, m) => s + m.failed, 0);
  const parts = all.reduce((s, m) => s + smsCount(m.sent, m.parts), 0);

  const campaignColumns: Column<MessageCampaign>[] = [
    { key: "name", header: "Campaign", className: "min-w-[240px]", render: (r) => (
      <div>
        <div className="text-text font-medium">{r.name}</div>
        <div className="mt-0.5 text-xs text-text-faint">{r.audience}</div>
      </div>
    ) },
    { key: "status", header: "Status · when", className: "whitespace-nowrap", render: (r) => (
      <div>
        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
        <div className="mt-1 tabular text-xs text-text-soft">{formatDateTime(r.at)}</div>
      </div>
    ) },
    { key: "channel", header: "Channel", className: "whitespace-nowrap", render: (r) => <span className="text-text-soft">{r.channel}</span>, hideOnMobile: true },
    { key: "recipients", header: "Farmers", className: "text-right whitespace-nowrap", render: (r) => <span className="tabular">{n(r.recipients)}</span> },
    { key: "delivered", header: "Delivered", className: "text-right whitespace-nowrap", render: (r) => r.status === "sent" ? (
      <div>
        <div className="tabular text-text">{n(r.delivered)}</div>
        <div className="text-xs text-text-faint">{pct(r.delivered, r.recipients)}{r.failed ? ` · ${n(r.failed)} failed` : ""}</div>
      </div>
    ) : <span className="text-xs text-text-faint">not sent yet</span> },
    { key: "sms", header: "SMS", className: "text-right whitespace-nowrap", render: (r) => (
      <div>
        <div className="tabular text-text">{n(smsCount(r.recipients, r.parts))}</div>
        <div className="text-xs text-text-faint">{r.parts} {r.parts === 1 ? "part" : "parts"} each</div>
      </div>
    ), hideOnMobile: true },
    { key: "by", header: "Sent by", className: "whitespace-nowrap", render: (r) => <span className="text-text-soft">{r.sentBy}</span>, hideOnMobile: true, defaultHidden: true },
  ];

  const autoColumns: Column<AutoMessage>[] = [
    { key: "name", header: "Message", className: "min-w-[220px]", render: (r) => (
      <div>
        <div className="text-text font-medium">{r.name}</div>
        <div className="mt-0.5 text-xs text-text-faint">{r.trigger}</div>
      </div>
    ) },
    { key: "channel", header: "Channel", className: "whitespace-nowrap", render: (r) => <span className="text-text-soft">{r.channel}</span>, hideOnMobile: true },
    { key: "sent", header: "Sent this month", className: "text-right whitespace-nowrap", render: (r) => <span className="tabular">{n(r.sent)}</span> },
    { key: "delivered", header: "Delivered", className: "text-right whitespace-nowrap", render: (r) => (
      <div>
        <div className="tabular text-text">{n(r.delivered)}</div>
        <div className="text-xs text-text-faint">{pct(r.delivered, r.sent)}{r.failed ? ` · ${n(r.failed)} failed` : ""}</div>
      </div>
    ) },
    { key: "sms", header: "SMS", className: "text-right whitespace-nowrap", render: (r) => (
      <div>
        <div className="tabular text-text">{n(smsCount(r.sent, r.parts))}</div>
        <div className="text-xs text-text-faint">{r.parts} {r.parts === 1 ? "part" : "parts"} each</div>
      </div>
    ), hideOnMobile: true },
  ];

  if (loading) return <Skeleton className="h-96" />;

  return (
    <div>
      <PageHeader
        title="Messages"
        tooltip="An SMS longer than 160 characters goes as several parts, and each part is billed. The SMS column counts parts."
        subtitle="Campaigns to farmers, and the messages the platform sends on its own: payment notices, consent requests and one-time codes."
      />

      <StatRail className="mb-5">
        <GlassStat label="Messages sent" value={n(sent)} icon={<MessageSquare size={17} />} tone="primary" hint="this month, campaigns and automatic" />
        <GlassStat label="Delivered" value={pct(delivered, sent)} icon={<CheckCircle2 size={17} />} tone="success" emphasis={false} hint={`${n(delivered)} reached the phone`} />
        <GlassStat label="Failed" value={n(failed)} icon={<AlertTriangle size={17} />} tone={failed ? "warning" : "success"} hint="switched off, out of range or a wrong number" />
        <GlassStat label="SMS billed" value={n(parts)} icon={<Coins size={17} />} tone="neutral" hint={<><Money amount={parts * SMS_PART_KES} currency="KES" compact /> at KES {SMS_PART_KES.toFixed(2)} a part</>} />
      </StatRail>

      <SectionTitle title="Campaigns" description="Sent by staff to a group of farmers. Open one to read the message." />
      <div data-testid="message-campaigns">
        <GlassPanel className="p-1 mb-6" sheen={false}>
          <DataTable newest={(r) => r.at} columns={campaignColumns} rows={campaigns ?? []} columnPicker onRowClick={(r) => setOpen({ title: r.name, text: r.text, parts: r.parts })} />
        </GlassPanel>
      </div>

      <SectionTitle title="Automatic messages" description="Sent by the platform when something happens to a farmer's wallet or account." />
      <div data-testid="auto-messages">
        <GlassPanel className="p-1" sheen={false}>
          <DataTable columns={autoColumns} rows={autos ?? []} onRowClick={(r) => setOpen({ title: r.name, text: r.text, parts: r.parts })} />
        </GlassPanel>
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title}>
        {open && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-border bg-surface-sunken p-3 text-[13px] text-text leading-relaxed" data-testid="message-text">{open.text}</div>
            <p className="text-xs text-text-faint">{open.text.length} characters · {open.parts} SMS {open.parts === 1 ? "part" : "parts"}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
