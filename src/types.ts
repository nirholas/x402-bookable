/** Shared types for x402-bookable. */

export interface ProviderInfo {
  name: string;
  description: string;
  timezone: string;
  location: string;
}

export interface DayHours {
  open: string; // "HH:MM"
  close: string; // "HH:MM"
}

export interface Service {
  id: string;
  name: string;
  durationMinutes: number;
  /** "video" services get a generated meeting link; "in-person" get the address. */
  mode: "video" | "in-person" | "phone";
  description: string;
  /** Minutes of padding kept free after the appointment. Optional. */
  bufferMinutes?: number;
}

export interface CancelPolicy {
  holdPrice: string;
  freeCancellationHours: number;
  description: string;
}

export interface BookableConfig {
  provider: ProviderInfo;
  hours: Record<string, DayHours | null>;
  bookingWindowDays: number;
  /** Booking grid in minutes. Defaults to 15. */
  slotMinutes?: number;
  services: Service[];
  cancelPolicy: CancelPolicy;
  /** Base URL for generated video meeting links. Optional. */
  meetingLinkBase?: string;
}

export interface OpenSlot {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  endsAt: string; // HH:MM
}

export interface Appointment {
  appointmentId: string;
  status: "confirmed" | "cancelled";
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  mode: Service["mode"];
  date: string;
  time: string;
  name: string;
  email?: string;
  notes?: string;
  meetingLink?: string;
  payerWallet?: string;
  cancelToken: string;
  createdAt: string;
  cancelledAt?: string;
}

export interface LedgerEntry {
  entryId: string;
  appointmentId: string;
  kind: "hold" | "refund" | "forfeit";
  amount: string;
  wallet?: string;
  reason: string;
  at: string;
}
