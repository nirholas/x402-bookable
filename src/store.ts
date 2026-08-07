import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Appointment, LedgerEntry } from "./types.js";

/**
 * File-backed persistence. State lives in data/*.json so a restart never
 * loses appointments. No database required.
 */

const DATA_DIR = process.env.DATA_DIR ?? "data";
const APPOINTMENTS_FILE = `${DATA_DIR}/appointments.json`;
const LEDGER_FILE = `${DATA_DIR}/ledger.json`;

function load<T>(file: string, fallback: T): T {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    // corrupt file — start fresh rather than crash
  }
  return fallback;
}

function save(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

export class Store {
  private appointments: Appointment[] = load<Appointment[]>(APPOINTMENTS_FILE, []);
  private ledger: LedgerEntry[] = load<LedgerEntry[]>(LEDGER_FILE, []);

  allAppointments(): Appointment[] {
    return this.appointments;
  }

  activeAppointments(): Appointment[] {
    return this.appointments.filter((a) => a.status === "confirmed");
  }

  getAppointment(id: string): Appointment | undefined {
    return this.appointments.find((a) => a.appointmentId === id);
  }

  addAppointment(a: Appointment): void {
    this.appointments.push(a);
    save(APPOINTMENTS_FILE, this.appointments);
  }

  updateAppointment(a: Appointment): void {
    const i = this.appointments.findIndex((x) => x.appointmentId === a.appointmentId);
    if (i >= 0) this.appointments[i] = a;
    save(APPOINTMENTS_FILE, this.appointments);
  }

  addLedgerEntry(e: LedgerEntry): void {
    this.ledger.push(e);
    save(LEDGER_FILE, this.ledger);
  }

  ledgerFor(appointmentId: string): LedgerEntry[] {
    return this.ledger.filter((e) => e.appointmentId === appointmentId);
  }
}

export const store = new Store();
