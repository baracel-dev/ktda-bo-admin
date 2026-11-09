/* The people the KTDA demo pages name: farmers (by grower number and
   factory), agents and merchants. Invented, for the pages that still run on
   demo data (the "Demo data" footer); the live pages read omnichannel. Dates
   in the demo are this month's (November 2026), amounts KES only. */

export type DemoFarmer = { growerNo: string; name: string; factory: string; town: string; phone: string };

export const DEMO_FARMERS: DemoFarmer[] = [
  { growerNo: "GN-104233", name: "Joseph Kiprotich Langat", factory: "Litein", town: "Litein", phone: "+254 722 104 233" },
  { growerNo: "GN-118407", name: "Grace Chepkemoi Koech", factory: "Momul", town: "Kericho", phone: "+254 711 418 407" },
  { growerNo: "GN-120955", name: "Samuel Mwangi Gichuki", factory: "Gitugi", town: "Murang'a", phone: "+254 723 120 955" },
  { growerNo: "GN-131620", name: "Lucy Wanjiku Ndirangu", factory: "Chinga", town: "Othaya", phone: "+254 710 316 200" },
  { growerNo: "GN-142078", name: "Peter Kimathi M'Ikiara", factory: "Githongo", town: "Meru", phone: "+254 724 142 078" },
  { growerNo: "GN-150311", name: "Agnes Moraa Nyaboke", factory: "Nyansiongo", town: "Nyamira", phone: "+254 715 150 311" },
  { growerNo: "GN-163842", name: "Wilson Kipngeno Rotich", factory: "Kapkoros", town: "Bomet", phone: "+254 729 638 420" },
  { growerNo: "GN-171206", name: "Esther Wangari Muriuki", factory: "Kangaita", town: "Kerugoya", phone: "+254 712 171 206" },
  { growerNo: "GN-185590", name: "Daniel Ombati Nyakundi", factory: "Kiamokama", town: "Kisii", phone: "+254 708 185 590" },
  { growerNo: "GN-192774", name: "Mary Njeri Kariuki", factory: "Ndima", town: "Nyeri", phone: "+254 721 927 740" },
];

export const farmerByGrower = (growerNo: string) => DEMO_FARMERS.find((f) => f.growerNo === growerNo);

/** "Joseph Kiprotich Langat (GN-104233)" */
export const farmerLabel = (growerNo: string) => {
  const f = farmerByGrower(growerNo);
  return f ? `${f.name} (${f.growerNo})` : growerNo;
};

export type DemoAgent = { agentNo: string; name: string; town: string };

export const DEMO_AGENTS: DemoAgent[] = [
  { agentNo: "AG-2041", name: "Kiprotich Agencies", town: "Litein" },
  { agentNo: "AG-2077", name: "Gitugi Shop & M-PESA", town: "Murang'a" },
  { agentNo: "AG-2103", name: "Nyansiongo Cash Point", town: "Nyamira" },
];

export type DemoMerchant = { brsNo: string; name: string; till: string; town: string };

export const DEMO_MERCHANTS: DemoMerchant[] = [
  { brsNo: "M-10200", name: "Kericho Agrovet", till: "512345", town: "Kericho" },
  { brsNo: "M-10233", name: "Othaya Farm Inputs", till: "512390", town: "Othaya" },
  { brsNo: "M-10251", name: "Meru Fertiliser Depot", till: "512417", town: "Meru" },
];
