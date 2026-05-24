import express from "express";
import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
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
import { TIME_SLOTS, DEFAULT_CLASSES, Reservation, NotificationLog } from "../src/types";

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

const db = process.env.FIREBASE_DATABASE_ID
  ? getFirestore(firebaseApp, process.env.FIREBASE_DATABASE_ID)
  : getFirestore(firebaseApp);

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
