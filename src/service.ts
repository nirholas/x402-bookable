import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { buildIcsBase64 } from "./ics.js";
import { sign } from "./sign.js";
import { store } from "./store.js";
import type { Appointment, BookableConfig, LedgerEntry, OpenSlot, Service } from "./types.js";

const CONFIG_PATH = process.env.SERVICES_CONFIG ?? "config/services.json";

export const config: BookableConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

const SLOT_MINUTES = config.slotMinutes ?? 15;

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(mins: number): string {
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function at(date: string, time: string): Date {
  // Interpreted in the server's local timezone — run the server in the
  // provider's timezone (see config.provider.timezone).
  return new Date(`${date}T${time}:00`);
}

export function findService(serviceId: string): Service | undefined {
  return config.services.find((s) => s.id === serviceId);
}

/** Minutes a service occupies on the calendar, including its buffer. */
function blockMinutes(s: Service): number {
  return s.durationMinutes + (s.bufferMinutes ?? 0);
}

/** Does a candidate window collide with anything already on the calendar? */
function isBusy(date: string, startMins: number, lengthMins: number): boolean {
  const end = startMins + lengthMins;
  return store.activeAppointments().some((a) => {
    if (a.date !== date) return false;
    const svc = findService(a.serviceId);
    const aStart = toMinutes(a.time);
    const aEnd = aStart + (svc ? blockMinutes(svc) : a.durationMinutes);
    return startMins < aEnd && aStart < end;
  });
}

/** Every grid time on `date` at which `service` fits inside opening hours. */
function candidateTimes(date: string, service: Service): string[] {
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00`).getDay()];
  const hours = config.hours[weekday];
  if (!hours) return [];
  const open = toMinutes(hours.open);
  const latestStart = toMinutes(hours.close) - service.durationMinutes;
  const out: string[] = [];
  for (let t = open; t <= latestStart; t += SLOT_MINUTES) out.push(fromMinutes(t));
  return out;
}

export interface SlotsQuery {
  service?: string;
  date?: string;
  days?: number;
}

export class BookingError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The paid GET /slots artifact: bookable start times per service. */
export function getSlots(q: SlotsQuery) {
  const services = q.service
    ? config.services.filter((s) => s.id === q.service)
    : config.services;
  if (q.service && services.length === 0)
    throw new BookingError(
      404,
      "UNKNOWN_SERVICE",
      `no service "${q.service}" — see GET /services for valid ids`,
    );

  const days = Math.min(q.days ?? config.bookingWindowDays, config.bookingWindowDays);
  const dates: string[] = [];
  if (q.date) {
    dates.push(q.date);
  } else {
    const today = new Date();
    for (let i = 0; i < days; i++) {
      dates.push(new Date(today.getTime() + i * 86_400_000).toISOString().slice(0, 10));
    }
  }

  const now = Date.now();
  const out = services.map((service) => {
    const slots: OpenSlot[] = [];
    for (const date of dates) {
      for (const time of candidateTimes(date, service)) {
        if (at(date, time).getTime() <= now) continue; // past
        if (isBusy(date, toMinutes(time), blockMinutes(service))) continue;
        slots.push({
          date,
          time,
          endsAt: fromMinutes(toMinutes(time) + service.durationMinutes),
        });
      }
    }
    return {
      serviceId: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes,
      mode: service.mode,
      description: service.description,
      openSlots: slots.length,
      slots,
    };
  });

  return {
    provider: config.provider,
    slotMinutes: SLOT_MINUTES,
    cancelPolicy: config.cancelPolicy,
    generatedAt: new Date().toISOString(),
    services: out,
  };
}

export interface AppointmentRequest {
  service: string;
  date: string;
  time: string;
  name: string;
  email?: string;
  notes?: string;
  payerWallet?: string;
}

/**
 * The paid POST /appointments artifact: the confirmed appointment with its
 * calendar invite, meeting link and cancel policy — all in the 200 body.
 */
export function bookAppointment(req: AppointmentRequest) {
  const { service: serviceId, date, time, name } = req;
  if (!serviceId) throw new BookingError(400, "INVALID_SERVICE", "service id is required");
  const service = findService(serviceId);
  if (!service)
    throw new BookingError(
      404,
      "UNKNOWN_SERVICE",
      `no service "${serviceId}" — see GET /services for valid ids`,
    );
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new BookingError(400, "INVALID_DATE", "date must be YYYY-MM-DD");
  if (!time || !/^\d{2}:\d{2}$/.test(time))
    throw new BookingError(400, "INVALID_TIME", "time must be HH:MM (24h)");
  if (!name || typeof name !== "string")
    throw new BookingError(400, "INVALID_NAME", "name is required");
  if (!candidateTimes(date, service).includes(time))
    throw new BookingError(
      409,
      "OUTSIDE_HOURS",
      `${service.name} does not fit at ${time} on ${date}`,
    );
  if (at(date, time).getTime() <= Date.now())
    throw new BookingError(409, "SLOT_IN_PAST", "that slot has already passed");
  if (isBusy(date, toMinutes(time), blockMinutes(service)))
    throw new BookingError(
      409,
      "SLOT_TAKEN",
      `${time} on ${date} is no longer free — call GET /slots for current openings`,
    );

  const appointmentId = `apt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const cancelToken = sign({ appointmentId, purpose: "cancel" }).slice(0, 32);
  const meetingLink =
    service.mode === "video"
      ? `${config.meetingLinkBase ?? "https://meet.example.com"}/${appointmentId}`
      : undefined;

  const appointment: Appointment = {
    appointmentId,
    status: "confirmed",
    serviceId: service.id,
    serviceName: service.name,
    durationMinutes: service.durationMinutes,
    mode: service.mode,
    date,
    time,
    name,
    email: req.email,
    notes: req.notes,
    meetingLink,
    payerWallet: req.payerWallet,
    cancelToken,
    createdAt: new Date().toISOString(),
  };
  store.addAppointment(appointment);

  const hold: LedgerEntry = {
    entryId: `led_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    appointmentId,
    kind: "hold",
    amount: config.cancelPolicy.holdPrice,
    wallet: req.payerWallet,
    reason: "refundable appointment hold paid via x402",
    at: new Date().toISOString(),
  };
  store.addLedgerEntry(hold);

  const ics = buildIcsBase64({
    uid: `${appointmentId}@x402-bookable`,
    start: at(date, time),
    durationMinutes: service.durationMinutes,
    summary: `${service.name} — ${config.provider.name} (${name})`,
    description:
      `Appointment ${appointmentId} with ${config.provider.name}. ` +
      (meetingLink ? `Join: ${meetingLink}. ` : "") +
      config.cancelPolicy.description,
    location: meetingLink ?? config.provider.location,
  });

  const confirmation = {
    appointmentId,
    status: "confirmed" as const,
    provider: config.provider.name,
    service: {
      id: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes,
      mode: service.mode,
    },
    time: `${date}T${time}`,
    endsAt: `${date}T${fromMinutes(toMinutes(time) + service.durationMinutes)}`,
    name,
    email: req.email,
    location: meetingLink ?? config.provider.location,
    meetingLink,
    cancelPolicy: config.cancelPolicy,
    cancelToken,
    cancelEndpoint: `POST /cancel/${appointmentId}`,
    ledgerEntry: hold,
    ics,
    createdAt: appointment.createdAt,
  };
  return { ...confirmation, signature: sign(confirmation) };
}

/** Free POST /cancel/:id — auth by the cancelToken issued at booking time. */
export function cancel(appointmentId: string, cancelToken: string | undefined) {
  const a = store.getAppointment(appointmentId);
  if (!a) throw new BookingError(404, "NOT_FOUND", `no appointment ${appointmentId}`);
  if (!cancelToken || cancelToken !== a.cancelToken)
    throw new BookingError(403, "BAD_CANCEL_TOKEN", "cancelToken does not match this appointment");
  if (a.status === "cancelled")
    throw new BookingError(409, "ALREADY_CANCELLED", "appointment is already cancelled");

  const msUntil = at(a.date, a.time).getTime() - Date.now();
  const refundable = msUntil >= config.cancelPolicy.freeCancellationHours * 3_600_000;

  a.status = "cancelled";
  a.cancelledAt = new Date().toISOString();
  store.updateAppointment(a);

  const entry: LedgerEntry = {
    entryId: `led_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    appointmentId,
    kind: refundable ? "refund" : "forfeit",
    amount: config.cancelPolicy.holdPrice,
    wallet: a.payerWallet,
    reason: refundable
      ? `cancelled ${(msUntil / 3_600_000).toFixed(1)}h before the appointment — hold refunded`
      : `cancelled inside the ${config.cancelPolicy.freeCancellationHours}h window — hold forfeited`,
    at: new Date().toISOString(),
  };
  store.addLedgerEntry(entry);

  const record = {
    appointmentId,
    status: "cancelled" as const,
    cancelledAt: a.cancelledAt,
    refunded: refundable,
    refundLedgerEntry: entry,
    ledger: store.ledgerFor(appointmentId),
  };
  return { ...record, signature: sign(record) };
}

/** Free GET /appointments/:id lookup (requires cancelToken). */
export function getAppointment(appointmentId: string, cancelToken: string | undefined) {
  const a = store.getAppointment(appointmentId);
  if (!a) throw new BookingError(404, "NOT_FOUND", `no appointment ${appointmentId}`);
  if (!cancelToken || cancelToken !== a.cancelToken)
    throw new BookingError(403, "BAD_CANCEL_TOKEN", "cancelToken does not match this appointment");
  return { ...a, ledger: store.ledgerFor(appointmentId) };
}
