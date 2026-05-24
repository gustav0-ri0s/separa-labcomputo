import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
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
  writeBatch
} from "firebase/firestore";
import { TIME_SLOTS, DEFAULT_CLASSES, Reservation, NotificationLog } from "./src/types";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(express.json());

// Firebase config: env vars take priority, fallback to JSON file for local dev
let firebaseConfig: any = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey) {
  const CONFIG_PATH = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      firebaseConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      console.log("[INFO] Firebase config loaded from firebase-applet-config.json");
    } catch (err) {
      console.error("Error reading firebase config:", err);
    }
  }
}

const firebaseApp = initializeApp(firebaseConfig);
const databaseId = process.env.FIREBASE_DATABASE_ID || firebaseConfig?.firestoreDatabaseId;
const db = databaseId
  ? getFirestore(firebaseApp, databaseId)
  : getFirestore(firebaseApp);


// Helper to get day of the week (0 = Lunes, 1 = Martes, etc.)
// Javascript Date.getDay() has 0 = Domingo, 1 = Lunes, 2 = Martes, ...
function getDayIndex(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dateObj = new Date(year, month - 1, day);
  const rawDay = dateObj.getDay(); // 0 is Sunday, 1 is Monday ...
  if (rawDay === 0) return 6; // Sunday is index 6
  return rawDay - 1; // 0 for Monday, 1 for Tuesday ...
}

// Helper to get monday of a date
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

// Helper to check if a date falls on an occupied week
function isOccupiedWeek(dateStr: string): boolean {
  try {
    const monday = getMondayOfDate(dateStr);
    const msInWeek = 7 * 24 * 60 * 60 * 1000;
    const diffMs = monday.getTime() - BASE_MONDAY.getTime();
    const weekOffset = Math.round(diffMs / msInWeek);
    // If the offset is an even number (0, 2, 4, -2, -4, etc.), it's an occupied week.
    return weekOffset % 2 === 0;
  } catch {
    return true; // Default safety
  }
}

// Check if a slot is disabled on a specific day
function isSlotDisabledForDay(dayIndex: number, slotIndex: number): boolean {
  if (dayIndex === 0 && slotIndex === 9) return true; // Lunes doesn't use 13:05 - 14:05
  if (dayIndex > 0 && dayIndex < 5 && slotIndex === 8) return true; // Martes-Viernes doesn't use 13:05 - 13:50
  if (dayIndex > 4) return true; // Fines de semana (Fin de semana no laborable)
  return false;
}

// Get default computer class for a specific day and slot (if occupied week)
function getDefaultClassForSlot(dateStr: string, slotIndex: number): string | null {
  if (!isOccupiedWeek(dateStr)) return null;
  const dayIndex = getDayIndex(dateStr);
  const key = `${dayIndex}-${slotIndex}`;
  if (DEFAULT_CLASSES[key]) {
    return DEFAULT_CLASSES[key].gradeClass;
  }
  return null;
}

// --- API ROUTES ---

// Get reservations
app.get("/api/reservations", async (req, res) => {
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
    // Sort in-memory by createdAt ascending
    list.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });
    console.log(`[INFO] /api/reservations loaded ${list.length} items successfully.`);
    res.json(list);
  } catch (error: any) {
    console.error("Error fetching reservations:", error);
    res.status(500).json({ error: "No se pudieron obtener las reservas de la base de datos.", details: error.toString() });
  }
});

// Create a reservation
app.post("/api/reservations", async (req, res) => {
  const { teacherName, grade, section, date, startSlot, endSlot, email, phone } = req.body;

  // Validation
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
    // Fetch all existing reservations for this date from Firestore for overlap validation
    const qExisting = query(collection(db, "reservations"), where("date", "==", date));
    const existingSnap = await getDocs(qExisting);
    const dateReservations: Reservation[] = [];
    existingSnap.forEach((docSnap) => {
      dateReservations.push(docSnap.data() as Reservation);
    });

    // Check if weekend or slots are disabled/overlap with breaks or other reservations
    for (let idx = startIdx; idx <= endIdx; idx++) {
      if (isSlotDisabledForDay(dayIdx, idx)) {
        return res.status(400).json({ error: `El bloque de hora '${TIME_SLOTS[idx].name}' no es válido para este día.` });
      }

      // Check default computing class block
      const defClass = getDefaultClassForSlot(date, idx);
      if (defClass) {
        return res.status(400).json({
          error: `El bloque de hora '${TIME_SLOTS[idx].name}' está reservado por la clase de computación fija (${defClass}).`
        });
      }

      // Check existing reservations
      const overlap = dateReservations.find((r) => {
        return idx >= r.startSlot && idx <= r.endSlot;
      });

      if (overlap) {
        return res.status(400).json({
          error: `El bloque de hora '${TIME_SLOTS[idx].name}' ya se encuentra reservado por el docente ${overlap.teacherName} para ${overlap.grade} "${overlap.section}".`
        });
      }
    }

    // Create Reservation
    const newReservation: Reservation = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      teacherName: teacherName.trim(),
      grade: grade.trim(),
      section: section.trim(),
      date,
      startSlot: startIdx,
      endSlot: endIdx,
      createdAt: new Date().toISOString()
    };

    if (email && email.trim()) {
      newReservation.email = email.trim();
    }
    if (phone && phone.trim()) {
      newReservation.phone = phone.trim();
    }

    // Save to Firestore
    await setDoc(doc(db, "reservations", newReservation.id), newReservation);

    // Trigger Confirmation Notification
    const timeTextStart = TIME_SLOTS[startIdx].start;
    const timeTextEnd = TIME_SLOTS[endIdx].end;
    const timeRange = `${timeTextStart} - ${timeTextEnd}`;
    const notificationChan = email ? "email" : (phone ? "sms" : "system");
    const fallbackContact = email || phone || "Sistema Interno";

    const newLog: NotificationLog = {
      id: `notif-${Date.now()}`,
      teacherName: newReservation.teacherName,
      grade: newReservation.grade,
      section: newReservation.section,
      date,
      timeRange,
      emailOrPhone: fallbackContact,
      timestamp: new Date().toISOString(),
      type: notificationChan === "email" ? "email" : (notificationChan === "sms" ? "sms" : "system")
    };

    // Save Log to Firestore
    await setDoc(doc(db, "notifications", newLog.id), newLog);

    res.status(201).json({
      success: true,
      reservation: newReservation,
      notification: newLog
    });
  } catch (error: any) {
    console.error("Error creating reservation in Firestore:", error);
    res.status(500).json({ 
      error: "Error al guardar la reserva en el servidor.",
      details: error?.message || error?.toString() || "Desconocido"
    });
  }
});

// Delete a reservation
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

    // Trigger Cancellation Notification
    const timeTextStart = TIME_SLOTS[removed.startSlot].start;
    const timeTextEnd = TIME_SLOTS[removed.endSlot].end;
    const timeRange = `${timeTextStart} - ${timeTextEnd}`;
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
      type: "system"
    };

    // Save Log to Firestore
    await setDoc(doc(db, "notifications", newLog.id), newLog);

    res.json({ success: true, message: "Reserva cancelada correctamente.", notification: newLog });
  } catch (error) {
    console.error("Error deleting reservation from Firestore:", error);
    res.status(500).json({ error: "No se pudo eliminar la reserva del servidor." });
  }
});

// Get notifications
app.get("/api/notifications", async (req, res) => {
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
    // Sort in-memory by timestamp descending
    list.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeB - timeA;
    });
    const limitedList = list.slice(0, 50);
    res.json(limitedList);
  } catch (error: any) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Error al cargar las notificaciones.", details: error.toString() });
  }
});

// Toggle whole database clear (Useful for resetting/testing the scheduler)
app.post("/api/reset", async (req, res) => {
  try {
    const batch = writeBatch(db);

    const resSnap = await getDocs(collection(db, "reservations"));
    resSnap.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });

    const notifSnap = await getDocs(collection(db, "notifications"));
    notifSnap.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });

    await batch.commit();
    res.json({ success: true, message: "¡Se ha reiniciado el sistema de reservas!" });
  } catch (error) {
    console.error("Error resetting database:", error);
    res.status(500).json({ error: "Error al reiniciar el sistema." });
  }
});


// Serve static frontend files (Vite configuration)
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[OK] Server running in '${process.env.NODE_ENV || "development"}' mode on http://localhost:${PORT}`);
  });
}

startServer();
