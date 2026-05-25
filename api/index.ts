import express from "express";
import { initializeApp, getApps } from "firebase/app";
import {
  initializeFirestore,
  collection,
  getDocs,
  setDoc,
  doc,
  deleteDoc,
  getDoc,
  query,
  where,
  writeBatch,
} from "firebase/firestore";

// Inline types and data to avoid relative import issues in Vercel serverless
interface Reservation {
  id: string;
  teacherName: string;
  grade: string;
  section: string;
  date: string;
  startSlot: number;
  endSlot: number;
  email?: string;
  phone?: string;
  createdAt: string;
}

interface NotificationLog {
  id: string;
  teacherName: string;
  grade: string;
  section: string;
  date: string;
  timeRange: string;
  emailOrPhone: string;
  timestamp: string;
  type: "email" | "sms" | "system";
}

const TIME_SLOTS = [
  { name: "7:20 – 8:05",   start: "07:20", end: "08:05" },
  { name: "8:05 – 8:50",   start: "08:05", end: "08:50" },
  { name: "8:50 – 9:35",   start: "08:50", end: "09:35" },
  { name: "9:35 – 10:20",  start: "09:35", end: "10:20" },
  { name: "10:20 – 10:50", start: "10:20", end: "10:50" },
  { name: "10:50 – 11:35", start: "10:50", end: "11:35" },
  { name: "11:35 – 12:20", start: "11:35", end: "12:20" },
  { name: "12:20 – 1:05",  start: "12:20", end: "13:05" },
  { name: "1:05 – 1:50",   start: "13:05", end: "13:50" },
  { name: "1:50 – 2:05",   start: "13:50", end: "14:05" },
  { name: "2:05 – 2:35",   start: "14:05", end: "14:35" },
];

const DEFAULT_CLASSES: Record<string, { gradeClass: string }> = {
  "0-0": { gradeClass: "5º A" },  "0-1": { gradeClass: "5º A" },
  "0-2": { gradeClass: "5º B" },  "0-3": { gradeClass: "5º B" },
  "0-7": { gradeClass: "4º A" },  "0-8": { gradeClass: "4º A" },
  "1-0": { gradeClass: "6º A" },  "1-1": { gradeClass: "6º A" },
  "1-2": { gradeClass: "6º B" },  "1-3": { gradeClass: "6º B" },
  "1-8": { gradeClass: "3ER AÑO A" }, "1-9": { gradeClass: "3ER AÑO A" }, "1-10": { gradeClass: "3ER AÑO A" },
  "2-6": { gradeClass: "1ER AÑO B" }, "2-7": { gradeClass: "1ER AÑO B" },
  "2-8": { gradeClass: "5TO AÑO" },   "2-9": { gradeClass: "5TO AÑO" },   "2-10": { gradeClass: "5TO AÑO" },
  "3-0": { gradeClass: "2DO AÑO B" }, "3-1": { gradeClass: "2DO AÑO B" },
  "3-2": { gradeClass: "1ER AÑO A" }, "3-3": { gradeClass: "1ER AÑO A" },
  "3-6": { gradeClass: "2DO AÑO A" }, "3-7": { gradeClass: "2DO AÑO A" },
  "3-8": { gradeClass: "3ER AÑO B" }, "3-9": { gradeClass: "3ER AÑO B" }, "3-10": { gradeClass: "3ER AÑO B" },
  "4-0": { gradeClass: "4º B" },  "4-1": { gradeClass: "4º B" },
  "4-2": { gradeClass: "3º A" },  "4-3": { gradeClass: "3º A" },
  "4-5": { gradeClass: "3º B" },  "4-6": { gradeClass: "3º B" },
  "4-8": { gradeClass: "4TO AÑO" }, "4-9": { gradeClass: "4TO AÑO" }, "4-10": { gradeClass: "4TO AÑO" },
};

const app = express();
app.use(express.json());

// Firebase config from environment variables
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

// Avoid re-initializing on warm serverless invocations
const firebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Use experimentalForceLongPolling so Firestore uses HTTP/REST instead of
// gRPC, which avoids gRPC metadata issues and connection timeouts in Vercel
// serverless functions.
const db = initializeFirestore(
  firebaseApp,
  { experimentalForceLongPolling: true },
  process.env.FIREBASE_DATABASE_ID || undefined
);

// Helpers

function getDayIndex(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dateObj = new Date(year, month - 1, day);
  const rawDay = dateObj.getDay();
  if (rawDay === 0) return 6;
  return rawDay - 1;
}

function getMondayOfDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dateObj = new Date(year, month - 1, day);
  const dayOfWeek = dateObj.getDay();
  const diff = dateObj.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(dateObj.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

const BASE_MONDAY = new Date("2026-05-25");
BASE_MONDAY.setHours(0, 0, 0, 0);

function isOccupiedWeek(dateStr: string): boolean {
  try {
    const monday = getMondayOfDate(dateStr);
    const msInWeek = 7 * 24 * 60 * 60 * 1000;
    const diffMs = monday.getTime() - BASE_MONDAY.getTime();
    const weekOffset = Math.round(diffMs / msInWeek);
    return weekOffset % 2 === 0;
  } catch {
    return true;
  }
}

function isSlotDisabledForDay(dayIndex: number, slotIndex: number): boolean {
  if (dayIndex < 0 || dayIndex > 4) return true;
  return false;
}

function getDefaultClassForSlot(dateStr: string, slotIndex: number): string | null {
  if (!isOccupiedWeek(dateStr)) return null;
  const dayIndex = getDayIndex(dateStr);
  const key = `${dayIndex}-${slotIndex}`;
  return DEFAULT_CLASSES[key]?.gradeClass ?? null;
}

// GET /api/reservations
app.get("/api/reservations", async (_req, res) => {
  try {
    const snapshot = await getDocs(collection(db, "reservations"));
    const list: Reservation[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as Reservation;
      if (data) {
        data.id = docSnap.id;
        list.push(data);
      }
    });
    list.sort((a, b) => {
      const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tA - tB;
    });
    res.json(list);
  } catch (error: any) {
    console.error("Error fetching reservations:", error);
    res.status(500).json({ error: "No se pudieron obtener las reservas.", details: error.toString() });
  }
});

// POST /api/reservations
app.post("/api/reservations", async (req, res) => {
  const { teacherName, grade, section, date, startSlot, endSlot, email, phone } = req.body;

  if (!teacherName || !grade || !section || !date || startSlot === undefined || endSlot === undefined) {
    return res.status(400).json({ error: "Faltan datos obligatorios para realizar la reserva." });
  }

  const startIdx = parseInt(startSlot, 10);
  const endIdx = parseInt(endSlot, 10);

  if (startIdx < 0 || startIdx >= TIME_SLOTS.length || endIdx < 0 || endIdx >= TIME_SLOTS.length) {
    return res.status(400).json({ error: "Los rangos de hora seleccionados no son válidos." });
  }

  if (startIdx > endIdx) {
    return res.status(400).json({ error: "La hora de inicio debe ser anterior o igual a la hora de fin." });
  }

  const dayIdx = getDayIndex(date);
  if (dayIdx < 0 || dayIdx > 4) {
    return res.status(400).json({ error: "Las reservas solo se pueden realizar de lunes a viernes." });
  }

  try {
    const qExisting = query(collection(db, "reservations"), where("date", "==", date));
    const existingSnap = await getDocs(qExisting);
    const dateReservations: Reservation[] = [];
    existingSnap.forEach((docSnap) => {
      dateReservations.push(docSnap.data() as Reservation);
    });

    for (let idx = startIdx; idx <= endIdx; idx++) {
      if (isSlotDisabledForDay(dayIdx, idx)) {
        return res.status(400).json({ error: `El bloque '${TIME_SLOTS[idx].name}' no es válido para este día.` });
      }

      const defClass = getDefaultClassForSlot(date, idx);
      if (defClass) {
        return res.status(400).json({
          error: `El bloque '${TIME_SLOTS[idx].name}' está reservado por la clase de computación fija (${defClass}).`,
        });
      }

      const overlap = dateReservations.find((r) => idx >= r.startSlot && idx <= r.endSlot);
      if (overlap) {
        return res.status(400).json({
          error: `El bloque '${TIME_SLOTS[idx].name}' ya está reservado por el docente ${overlap.teacherName} para ${overlap.grade} "${overlap.section}".`,
        });
      }
    }

    const newReservation: Reservation = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      teacherName: teacherName.trim(),
      grade: grade.trim(),
      section: section.trim(),
      date,
      startSlot: startIdx,
      endSlot: endIdx,
      createdAt: new Date().toISOString(),
    };

    if (email?.trim()) newReservation.email = email.trim();
    if (phone?.trim()) newReservation.phone = phone.trim();

    await setDoc(doc(db, "reservations", newReservation.id), newReservation);

    const timeRange = `${TIME_SLOTS[startIdx].start} - ${TIME_SLOTS[endIdx].end}`;
    const notifType: NotificationLog["type"] = email ? "email" : phone ? "sms" : "system";
    const contact = email || phone || "Sistema Interno";

    const newLog: NotificationLog = {
      id: `notif-${Date.now()}`,
      teacherName: newReservation.teacherName,
      grade: newReservation.grade,
      section: newReservation.section,
      date,
      timeRange,
      emailOrPhone: contact,
      timestamp: new Date().toISOString(),
      type: notifType,
    };

    await setDoc(doc(db, "notifications", newLog.id), newLog);

    return res.status(201).json({ success: true, reservation: newReservation, notification: newLog });
  } catch (error: any) {
    console.error("Error creating reservation:", error);
    return res.status(500).json({ error: "Error al guardar la reserva.", details: error?.message ?? error?.toString() });
  }
});

// DELETE /api/reservations/:id
app.delete("/api/reservations/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const docRef = doc(db, "reservations", id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return res.status(404).json({ error: "La reserva no fue encontrada." });
    }

    const removed = docSnap.data() as Reservation;
    await deleteDoc(docRef);

    const timeRange = `${TIME_SLOTS[removed.startSlot].start} - ${TIME_SLOTS[removed.endSlot].end}`;
    const contact = removed.email || removed.phone || "Sistema Interno";

    const newLog: NotificationLog = {
      id: `notif-${Date.now()}`,
      teacherName: removed.teacherName,
      grade: removed.grade,
      section: removed.section,
      date: removed.date,
      timeRange,
      emailOrPhone: contact,
      timestamp: new Date().toISOString(),
      type: "system",
    };

    await setDoc(doc(db, "notifications", newLog.id), newLog);

    return res.json({ success: true, message: "Reserva cancelada correctamente.", notification: newLog });
  } catch (error) {
    console.error("Error deleting reservation:", error);
    return res.status(500).json({ error: "No se pudo eliminar la reserva." });
  }
});

// GET /api/notifications
app.get("/api/notifications", async (_req, res) => {
  try {
    const snapshot = await getDocs(collection(db, "notifications"));
    const list: NotificationLog[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as NotificationLog;
      if (data) {
        data.id = docSnap.id;
        list.push(data);
      }
    });
    list.sort((a, b) => {
      const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tB - tA;
    });
    return res.json(list.slice(0, 50));
  } catch (error: any) {
    console.error("Error fetching notifications:", error);
    return res.status(500).json({ error: "Error al cargar las notificaciones.", details: error.toString() });
  }
});

// POST /api/reset
app.post("/api/reset", async (_req, res) => {
  try {
    const batch = writeBatch(db);

    const resSnap = await getDocs(collection(db, "reservations"));
    resSnap.forEach((docSnap) => batch.delete(docSnap.ref));

    const notifSnap = await getDocs(collection(db, "notifications"));
    notifSnap.forEach((docSnap) => batch.delete(docSnap.ref));

    await batch.commit();
    return res.json({ success: true, message: "¡Se ha reiniciado el sistema de reservas!" });
  } catch (error) {
    console.error("Error resetting database:", error);
    return res.status(500).json({ error: "Error al reiniciar el sistema." });
  }
});

// Catch-all JSON error handler (covers body-parser errors, unhandled throws, etc.)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[API Error]", err?.message || err);
  if (!res.headersSent) {
    res.status(err?.status || 500).json({
      error: err?.message || "Error interno del servidor.",
      details: String(err?.message || err)
    });
  }
});

export default app;
