import { useState, useEffect } from "react";
import { TIME_SLOTS, DEFAULT_CLASSES, Reservation, NotificationLog } from "./types";
import { NotificationCenter } from "./components/NotificationCenter";
import { ReservationModal } from "./components/ReservationModal";
import {
  Calendar,
  Clock,
  Trash2,
  Plus,
  Sparkles,
  RefreshCw,
  Lock,
  User,
  HelpCircle,
  CheckCircle,
  AlertTriangle,
  Info,
  Mail,
  X,
  MessageSquare,
  Bell
} from "lucide-react";

// Google Calendar template link creator for standard user localized calendar view
function getGoogleCalendarUrl(reservation: Reservation): string {
  if (!reservation) return "";
  const dateStr = reservation.date.replace(/-/g, ""); // "20260525"
  const startSlotObj = TIME_SLOTS[reservation.startSlot];
  const endSlotObj = TIME_SLOTS[reservation.endSlot];
  if (!startSlotObj || !endSlotObj) return "";
  
  const startTime = startSlotObj.start.replace(/:/g, "") + "00";
  const endTime = endSlotObj.end.replace(/:/g, "") + "00";
  
  const dates = `${dateStr}T${startTime}/${dateStr}T${endTime}`;
  const title = encodeURIComponent(`Reserva Sala de Cómputo: ${reservation.grade} "${reservation.section}"`);
  const details = encodeURIComponent(
    `Reserva ingresada para la Sala de Cómputo.\n\n` +
    `• Docente: ${reservation.teacherName}\n` +
    `• Grado y sección: ${reservation.grade} "${reservation.section}"\n` +
    `• Horario: ${startSlotObj.start} - ${endSlotObj.end}\n` +
    `• Contacto/Correo: ${reservation.email || "No especificado"}\n\n` +
    `¡Asistir con el grupo de alumnos asignado!`
  );
  const location = encodeURIComponent("Sala de Cómputo - IE");
  
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&location=${location}`;
}

// Helper to get Monday of a Date
function getMondayOfDate(d: Date): Date {
  const dateCopy = new Date(d);
  const day = dateCopy.getDay();
  // Adjust for Sunday (0) to get previous Monday
  const diff = dateCopy.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(dateCopy.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// Helper to shift to the next week's Monday if currently on Saturday or Sunday
function getInitialMonday(d: Date = new Date()): Date {
  const dateCopy = new Date(d);
  const day = dateCopy.getDay(); // 0 = Sunday, ..., 6 = Saturday
  if (day === 6) {
    // Saturday: add 2 days to get next Monday
    const nextMonday = new Date(dateCopy);
    nextMonday.setDate(dateCopy.getDate() + 2);
    nextMonday.setHours(0, 0, 0, 0);
    return nextMonday;
  } else if (day === 0) {
    // Sunday: add 1 day to get next Monday
    const nextMonday = new Date(dateCopy);
    nextMonday.setDate(dateCopy.getDate() + 1);
    nextMonday.setHours(0, 0, 0, 0);
    return nextMonday;
  }
  return getMondayOfDate(dateCopy);
}

// Convert Date object to YYYY-MM-DD
function formatDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const BASE_MONDAY = new Date("2026-05-25T00:00:00");
BASE_MONDAY.setHours(0, 0, 0, 0);

// Helper to check if a week is occupied by computer classes - odd/even week offset alternating pattern
function isWeekOccupied(mondayDate: Date): boolean {
  const msInWeek = 7 * 24 * 60 * 60 * 1000;
  const diffMs = mondayDate.getTime() - BASE_MONDAY.getTime();
  const weekOffset = Math.round(diffMs / msInWeek);
  return weekOffset % 2 === 0;
}

export default function App() {
  const [userEmail, setUserEmail] = useState<string | null>(() => localStorage.getItem("muivc_email"));
  const [userName, setUserName] = useState<string | null>(() => localStorage.getItem("muivc_name"));
  const [loginError, setLoginError] = useState<string | null>(null);
  const [lastCreatedReservation, setLastCreatedReservation] = useState<Reservation | null>(null);

  // Helper to determine if current user has permissions to cancel or modify a reservation
  const isAuthorizedToEdit = (resEmail?: string, resTeacherName?: string) => {
    if (userEmail && userEmail.toLowerCase() === "informatica@muivc.com") {
      return true;
    }
    const cleanEmail = resEmail?.trim().toLowerCase();
    const cleanUserEmail = userEmail?.trim().toLowerCase();
    if (cleanEmail && cleanUserEmail && cleanEmail === cleanUserEmail) {
      return true;
    }
    const cleanName = resTeacherName?.trim().toLowerCase();
    const cleanUserName = userName?.trim().toLowerCase();
    if (cleanName && cleanUserName) {
      return (
        cleanName === cleanUserName ||
        cleanUserName.includes(cleanName) ||
        cleanName.includes(cleanUserName)
      );
    }
    return false;
  };

  const [currentMonday, setCurrentMonday] = useState<Date>(() => {
    return getInitialMonday();
  });

  const [dateInput, setDateInput] = useState(() => formatDateString(getInitialMonday()));
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [notifications, setNotifications] = useState<NotificationLog[]>([]);
  const [syncStatus, setSyncStatus] = useState<"synced" | "syncing" | "error">("synced");
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [selectedColDate, setSelectedColDate] = useState("");
  const [selectedResForDetail, setSelectedResForDetail] = useState<Reservation | null>(null);

  // Toast / System Confirmation State
  const [toastMessage, setToastMessage] = useState<{ text: string; channel: string; active: boolean } | null>(null);

  const [consoleTab, setConsoleTab] = useState<"directory" | "notifications">("directory");
  const [showHelp, setShowHelp] = useState(false);

  // Fetch reservations & notifications
  const loadData = async (showSyncIndicator = false) => {
    if (showSyncIndicator) setSyncStatus("syncing");
    try {
      const [res1, res2] = await Promise.all([
        fetch("/api/reservations"),
        fetch("/api/notifications")
      ]);

      if (res1.ok && res2.ok) {
        const reservationsData = await res1.json();
        const notificationsData = await res2.json();
        setReservations(reservationsData);
        setNotifications(notificationsData);
        setSyncStatus("synced");
        setLastSyncTime(new Date());
      } else {
        setSyncStatus("error");
      }
    } catch (error) {
      console.error("Error connecting to server:", error);
      setSyncStatus("error");
    }
  };

  // Poll data in real-time every 4 seconds
  useEffect(() => {
    loadData(true);
    const interval = setInterval(() => {
      loadData(false);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Sync date input when calendar changes
  useEffect(() => {
    setDateInput(formatDateString(currentMonday));
  }, [currentMonday]);

  // Navigate between weeks
  const handlePrevWeek = () => {
    const prev = new Date(currentMonday);
    prev.setDate(prev.getDate() - 7);
    setCurrentMonday(prev);
  };

  const handleNextWeek = () => {
    const next = new Date(currentMonday);
    next.setDate(next.getDate() + 7);
    setCurrentMonday(next);
  };

  const handleDatePick = (dateStr: string) => {
    if (!dateStr) return;
    const parts = dateStr.split("-").map(Number);
    const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    const monday = getMondayOfDate(dateObj);
    setCurrentMonday(monday);
  };

  // Jump to May 25 Reference Week (Occupied)
  const jumpToReferenceWeekOccupied = () => {
    setCurrentMonday(getMondayOfDate(new Date("2026-05-25")));
  };

  // Jump to June 01 Reference Week (Free)
  const jumpToReferenceWeekFree = () => {
    setCurrentMonday(getMondayOfDate(new Date("2026-06-01")));
  };

  // Get array of Mon-Fri date strings for the currently selected week
  const getWeekDates = (): string[] => {
    const dates: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(currentMonday);
      d.setDate(d.getDate() + i);
      dates.push(formatDateString(d));
    }
    return dates;
  };

  const weekDays = getWeekDates();
  const isOccupied = isWeekOccupied(currentMonday);

  // Submit a reservation
  const handleCreateReservation = async (formData: {
    teacherName: string;
    grade: string;
    section: string;
    startSlot: number;
    endSlot: number;
    email?: string;
    phone?: string;
    date?: string;
  }) => {
    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          date: formData.date || selectedColDate
        })
      });

      const result = await response.json().catch(() => ({
        error: `Error del servidor (código ${response.status}). Verifica la consola del servidor.`
      }));
      if (!response.ok) {
        const errMsg = result.details ? `${result.error} (Detalle: ${result.details})` : (result.error || "No se pudo realizar la reserva.");
        throw new Error(errMsg);
      }

      if (result.success && result.reservation) {
        setLastCreatedReservation(result.reservation);
      }

      // Show real confirmation notification Banner
      const channelText = formData.email 
        ? `Enviado correo electrónico automático a: ${formData.email}`
        : (formData.phone ? `Enviado SMS de confirmación a: ${formData.phone}` : "Reserva ingresada al sistema.");

      setToastMessage({
        text: `¡Reserva Confirmada! Docente: ${formData.teacherName} (Grado: ${formData.grade} "${formData.section}").`,
        channel: channelText,
        active: true
      });

      // Clear toast after 6 seconds
      setTimeout(() => {
        setToastMessage(prev => prev ? { ...prev, active: false } : null);
      }, 6000);

      await loadData(true);
      return true;
    } catch (error: any) {
      // Propagate the error so the modal can handle it natively and show it to the user
      throw error;
    }
  };

  // Cancel/Delete a reservation
  const handleCancelReservation = async (reservationId: string, docName: string) => {
    const confirmCancel = window.confirm(
      `¿Está seguro que desea cancelar la reserva de la sala de cómputo del docente "${docName}"?`
    );
    if (!confirmCancel) return;

    try {
      const response = await fetch(`/api/reservations/${reservationId}`, {
        method: "DELETE"
      });

      const result = await response.json().catch(() => ({
        error: `Error del servidor (código ${response.status}).`
      }));
      if (!response.ok) {
        throw new Error(result.error || "No se pudo cancelar la reserva.");
      }

      setToastMessage({
        text: `Se ha cancelado la reserva de ${docName}.`,
        channel: "Alerta automática de cancelación enviada al docente.",
        active: true
      });

      setTimeout(() => {
        setToastMessage(prev => prev ? { ...prev, active: false } : null);
      }, 5000);

      await loadData(true);
    } catch (error: any) {
      setToastMessage({
        text: `Error al cancelar: ${error.message || error.toString()}`,
        channel: "No se pudo actualizar el servidor en este momento.",
        active: true
      });
      setTimeout(() => {
        setToastMessage(prev => prev ? { ...prev, active: false } : null);
      }, 6000);
    }
  };

  // Reset entire state
  const handleResetSystem = async () => {
    const confirmReset = window.confirm(
      "¿Está seguro que desea borrar TODAS las reservas de docentes y reiniciar el historial de notificaciones? El horario de clases de computación por semanas se mantendrá activo por defecto."
    );
    if (!confirmReset) return;

    try {
      const response = await fetch("/api/reset", { method: "POST" });
      if (response.ok) {
        setToastMessage({
          text: "¡Se ha reiniciado el sistema con éxito!",
          channel: "El historial de reservas personalizadas ha sido limpiado.",
          active: true
        });
        setTimeout(() => setToastMessage(null), 4000);
        await loadData(true);
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Error de respuesta del servidor.");
      }
    } catch (error: any) {
      setToastMessage({
        text: `Error al reiniciar el sistema: ${error.message || "No se pudo conectar con el servidor."}`,
        channel: "Compruebe la conexión o inténtelo de nuevo.",
        active: true
      });
      setTimeout(() => setToastMessage(null), 6000);
    }
  };

  // Display human format date for titles
  const getWeekRangeLabel = () => {
    if (weekDays.length === 0) return "";
    const startObj = new Date(currentMonday);
    const endObj = new Date(currentMonday);
    endObj.setDate(endObj.getDate() + 4);

    const startLabel = startObj.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
    const endLabel = endObj.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
    return `${startLabel} - ${endLabel}`;
  };

  // Check if cell has default class (computacion)
  const isSlotDisabledForDay = (dayIdx: number, slotIdx: number): boolean => {
    return false;
  };

  // Calculate cell span for dynamic merging (rowSpan)
  const getCellSpan = (dayIdx: number, slotIdx: number, colDate: string) => {
    // 1. Is it not active?
    if (isSlotDisabledForDay(dayIdx, slotIdx)) {
      return { type: "disabled" as const, rowSpan: 1, isStart: true };
    }

    // 3. Is it a default class? (Only if week is occupied)
    if (isOccupied && DEFAULT_CLASSES[`${dayIdx}-${slotIdx}`]) {
      const defClass = DEFAULT_CLASSES[`${dayIdx}-${slotIdx}`];
      // Find start and end of this class on this day
      let start = slotIdx;
      while (start > 0) {
        const prevKey = `${dayIdx}-${start - 1}`;
        if (DEFAULT_CLASSES[prevKey] && DEFAULT_CLASSES[prevKey].gradeClass === defClass.gradeClass) {
          start--;
        } else {
          break;
        }
      }

      let end = slotIdx;
      while (end < TIME_SLOTS.length - 1) {
        const nextKey = `${dayIdx}-${end + 1}`;
        if (DEFAULT_CLASSES[nextKey] && DEFAULT_CLASSES[nextKey].gradeClass === defClass.gradeClass) {
          end++;
        } else {
          break;
        }
      }

      const rowSpan = end - start + 1;
      const isStart = (slotIdx === start);
      return { type: "default" as const, rowSpan, isStart, data: defClass };
    }

    // 4. Is it a teacher reservation?
    const teacherRes = reservations.find(
      (r) => r.date === colDate && slotIdx >= Number(r.startSlot) && slotIdx <= Number(r.endSlot)
    );
    if (teacherRes) {
      const s = Number(teacherRes.startSlot);
      const e = Number(teacherRes.endSlot);
      const rowSpan = e - s + 1;
      const isStart = (slotIdx === s);
      return { type: "reservation" as const, rowSpan, isStart, data: teacherRes };
    }

    // 5. It's free!
    return { type: "free" as const, rowSpan: 1, isStart: true };
  };

  // Handle cell click to trigger modal
  const handleCellClick = (dayIdx: number, slotIdx: number, colDate: string) => {
    if (isSlotDisabledForDay(dayIdx, slotIdx)) return;
    
    // check if computer class exists during occupied week
    if (isOccupied && DEFAULT_CLASSES[`${dayIdx}-${slotIdx}`]) return;

    // check if teacher reservation exists
    const hasRes = reservations.find(r => r.date === colDate && slotIdx >= Number(r.startSlot) && slotIdx <= Number(r.endSlot));
    if (hasRes) return; // clicking a reserved slot won't open add modal directly, hover does cancellation instead

    setSelectedDayIndex(dayIdx);
    setSelectedSlotIndex(slotIdx);
    setSelectedColDate(colDate);
    setIsModalOpen(true);
  };

  // Color helper to get colors based on image
  const getColorClasses = (colorTheme: string) => {
    switch (colorTheme) {
      case "blue":
        return "bg-sky-100 hover:bg-sky-150 text-sky-800 border-sky-200"; // 5º A, 5º B
      case "peach":
        return "bg-amber-100 hover:bg-amber-150 text-amber-800 border-amber-200"; // 6º A, 6º B
      case "yellow":
        return "bg-yellow-100 hover:bg-yellow-150 text-yellow-800 border-yellow-200"; // Jueves, 5to Año, etc.
      case "purple":
        return "bg-indigo-100 hover:bg-indigo-150 text-indigo-800 border-indigo-200"; // 4º A
      case "purple-light":
        return "bg-violet-100 hover:bg-violet-150 text-violet-800 border-violet-200"; // 4º B
      case "green":
        return "bg-emerald-100/80 hover:bg-emerald-150 text-emerald-800 border-emerald-200"; // 3º A, 3º B
      default:
        return "bg-slate-100 text-slate-800 border-slate-200";
    }
  };

  const dayNames = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

  if (!userEmail) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
        {/* Subtle decorative background glow */}
        <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="w-full max-w-md bg-slate-950/40 border border-slate-800 rounded-3xl p-8 backdrop-blur-xl shadow-2xl relative z-10 space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex bg-emerald-500/10 text-emerald-400 p-3.5 rounded-2xl border border-emerald-500/20 mb-2">
              <Calendar className="w-8 h-8 stroke-2" />
            </div>
            <h1 className="text-xl font-extrabold tracking-tight text-white uppercase sm:text-2xl">
              Agenda de Computación
            </h1>
            <p className="text-xs text-slate-400 font-medium">
              Verificación obligatoria de dominio de correo docente
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setLoginError(null);
              const emailInput = (e.currentTarget.elements.namedItem("email") as HTMLInputElement).value.trim();
              const nameInput = (e.currentTarget.elements.namedItem("name") as HTMLInputElement).value.trim();

              if (!nameInput) {
                setLoginError("Por favor ingrese su nombre.");
                return;
              }

              if (!emailInput.toLowerCase().endsWith("@muivc.com")) {
                setLoginError("Acceso denegado: Únicamente se permite el ingreso a correos con dominio institucional @muivc.com (ej. profesor@muivc.com)");
                return;
              }

              localStorage.setItem("muivc_email", emailInput.toLowerCase());
              localStorage.setItem("muivc_name", nameInput);
              setUserEmail(emailInput.toLowerCase());
              setUserName(nameInput);
            }}
            className="space-y-4"
          >
            {loginError && (
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-xl text-xs font-semibold flex items-start gap-2 animate-in fade-in slide-in-from-top-1">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="leading-relaxed">{loginError}</p>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-500" />
                Nombre del Docente
              </label>
              <input
                name="name"
                type="text"
                required
                placeholder="Ej. Prof. Juan Pérez"
                className="w-full text-xs px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition-all text-white font-medium"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-500" />
                Correo Institucional (@muivc.com)
              </label>
              <input
                name="email"
                type="email"
                required
                placeholder="ejemplo@muivc.com"
                className="w-full text-xs px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition-all text-white font-medium"
              />
              <span className="text-[10px] text-slate-400 block font-medium">
                Acceso exclusivo para docentes de nivel primaria y secundaria.
              </span>
            </div>

            <button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-3.5 rounded-xl transition-all shadow-lg hover:shadow-emerald-600/10 flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              <span>Verificar e Ingresar a la Agenda</span>
            </button>
          </form>

          <div className="text-center pt-2">
            <span className="text-[10px] font-semibold text-slate-500 tracking-wide font-mono">
              PORTAL DE SEGURIDAD MUIVC
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/80 flex flex-col font-sans text-slate-900 antialiased">

      {/* Toast notification */}
      {toastMessage && toastMessage.active && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-md p-4 bg-slate-900 border border-slate-800 text-white rounded-2xl shadow-2xl flex items-start gap-3 animate-in slide-in-from-top-4 duration-300">
          <div className="bg-emerald-500/20 text-emerald-400 p-1.5 rounded-lg shrink-0">
            <CheckCircle className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-emerald-300 leading-snug">{toastMessage.text}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{toastMessage.channel}</p>
            {lastCreatedReservation && (
              <div className="pt-1.5">
                <a
                  href={getGoogleCalendarUrl(lastCreatedReservation)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition-colors"
                >
                  <Calendar className="w-3 h-3" />
                  <span>Google Calendar</span>
                </a>
              </div>
            )}
          </div>
          <button
            onClick={() => setToastMessage(prev => prev ? { ...prev, active: false } : null)}
            className="text-slate-500 hover:text-white p-0.5 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-150 px-4 lg:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="bg-emerald-600 text-white p-2 rounded-xl shadow-sm shadow-emerald-600/20">
              <Calendar className="w-5 h-5 stroke-2" />
            </div>
            <span className="text-sm font-extrabold tracking-tight text-slate-900 uppercase hidden sm:block">
              Sala de Cómputo · MUIVC
            </span>
            <span className="text-sm font-extrabold tracking-tight text-slate-900 uppercase sm:hidden">
              Cómputo
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold ${
              syncStatus === "syncing" ? "bg-amber-50 text-amber-700 animate-pulse"
              : syncStatus === "error" ? "bg-rose-50 text-rose-700"
              : "bg-emerald-50 text-emerald-700"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                syncStatus === "syncing" ? "bg-amber-500"
                : syncStatus === "error" ? "bg-rose-500"
                : "bg-emerald-500"
              }`}></span>
              <span className="hidden sm:inline">
                {syncStatus === "error" ? "Sin conexión" : syncStatus === "syncing" ? "Sync..." : "En vivo"}
              </span>
              <button onClick={() => loadData(true)} className="text-current opacity-60 hover:opacity-100 transition-opacity" title="Sincronizar">
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>

            {userEmail && (
              <div className="flex items-center gap-1.5">
                <div className="bg-emerald-50 text-emerald-800 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-extrabold border border-emerald-100 shrink-0">
                  {userName ? userName.slice(0, 2).toUpperCase() : "?"}
                </div>
                <span className="text-xs font-semibold text-slate-700 hidden md:block max-w-[120px] truncate">{userName}</span>
                <button
                  onClick={() => {
                    if (window.confirm("¿Cerrar sesión?")) {
                      localStorage.removeItem("muivc_email");
                      localStorage.removeItem("muivc_name");
                      setUserEmail(null);
                      setUserName(null);
                    }
                  }}
                  className="text-[10px] font-bold text-slate-400 hover:text-rose-600 transition-colors px-1.5 py-0.5 rounded hover:bg-rose-50"
                >
                  Salir
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 lg:px-6 py-4 space-y-4">

        {/* Week navigation row */}
        <div className="bg-white rounded-2xl border border-slate-100 px-4 py-3 shadow-sm flex flex-wrap items-center gap-2">
          <button
            onClick={handlePrevWeek}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold transition-colors"
          >
            ← Ant.
          </button>

          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-100 rounded-lg">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-xs font-bold text-slate-700">{getWeekRangeLabel()}</span>
          </div>

          <button
            onClick={handleNextWeek}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold transition-colors"
          >
            Sig. →
          </button>

          <input
            type="date"
            value={dateInput}
            onChange={(e) => handleDatePick(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-700 bg-white font-medium outline-none focus:border-emerald-500"
          />

          <span className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
            isOccupied
              ? "bg-amber-50 text-amber-800 border border-amber-200/60"
              : "bg-emerald-50 text-emerald-800 border border-emerald-200/50"
          }`}>
            {isOccupied ? <Lock className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
            <span>{isOccupied ? "Semana con computación" : "Semana libre"}</span>
          </span>

          {userEmail?.toLowerCase() === "informatica@muivc.com" && (
            <button
              onClick={handleResetSystem}
              className="text-[10px] font-bold text-rose-400 hover:text-rose-600 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg border border-rose-100 transition-colors"
              title="Reiniciar todas las reservas"
            >
              Reiniciar
            </button>
          )}
        </div>

        {/* Calendar */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">

          {/* Compact legend */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5 border-b border-slate-100 text-[11px] text-slate-500 font-medium">
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-sky-300 bg-sky-100 shrink-0"></span>Computación fija</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-indigo-600 shrink-0"></span>Reservado</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-slate-200 bg-white shadow-inner shrink-0"></span>Libre — clic para reservar</span>
          </div>

          {/* TABLE GRID AREA */}
          <div className="overflow-x-auto relative">
              
              <table className="w-full text-left border-collapse table-fixed min-w-[700px]">
                
                {/* Table Header */}
                <thead>
                  <tr className="bg-slate-50/80 text-slate-700 border-b border-slate-150">
                    <th className="p-3 text-[11px] font-extrabold uppercase tracking-wider text-slate-500 text-center w-[120px] border-r border-slate-150">
                      HORA
                    </th>
                    {dayNames.map((dayName, dayIdx) => {
                      const colDateStr = weekDays[dayIdx];
                      const parts = colDateStr ? colDateStr.split("-").map(Number) : [];
                      const formattedColDate = parts.length === 3 ? `${parts[2]}/${parts[1]}` : "";
                      return (
                        <th 
                          key={dayIdx} 
                          className="p-3 text-center border-r border-slate-150 last:border-r-0"
                        >
                          <div className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest leading-tight">
                            {dayName}
                          </div>
                          <div className="text-xs font-bold font-mono text-indigo-600 font-medium">
                            {formattedColDate}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                {/* Table Body */}
                <tbody>
                  {TIME_SLOTS.map((slot, slotIdx) => {
                    return (
                      <tr 
                        key={slotIdx} 
                        className="border-b border-slate-150 last:border-b-0 hover:bg-slate-50/20"
                      >
                        {/* HORA COLUMN CELL */}
                        <td className="p-3 border-r border-slate-150 align-middle text-center bg-slate-50/60 min-w-[110px]">
                          <div className="text-sm font-extrabold text-slate-700 tracking-tight whitespace-nowrap">
                            {slot.name}
                          </div>
                        </td>

                        {/* DAYS COLUMNS */}
                        {dayNames.map((_, dayIdx) => {
                          const colDate = weekDays[dayIdx];
                          const spanInfo = getCellSpan(dayIdx, slotIdx, colDate);

                          if (!spanInfo.isStart) {
                            return null;
                          }

                          if (spanInfo.type === "disabled") {
                            return (
                              <td 
                                key={dayIdx} 
                                rowSpan={spanInfo.rowSpan}
                                className="p-2 border-r border-slate-150 last:border-r-0 align-middle text-center bg-slate-100/60"
                              >
                                <span className="text-[9px] font-bold tracking-tight text-slate-400/80 font-mono font-medium">
                                  No aplicable
                                </span>
                              </td>
                            );
                          }

                          if (spanInfo.type === "default") {
                            const defClass = spanInfo.data;
                            return (
                              <td 
                                key={dayIdx} 
                                rowSpan={spanInfo.rowSpan}
                                className={`p-3 border-r border-slate-150 last:border-r-0 text-center align-middle border-l-2 border-l-orange-500/10 ${getColorClasses(defClass.colorTheme)}`}
                              >
                                <div className="space-y-0.5">
                                  <div className="text-xs font-extrabold tracking-tight">
                                    {defClass.gradeClass}
                                  </div>
                                  <div className="text-[9px] font-bold uppercase tracking-wider opacity-80 flex items-center justify-center gap-0.5">
                                    <Lock className="w-2.5 h-2.5 shrink-0" />
                                    <span>Computación</span>
                                  </div>
                                </div>
                              </td>
                            );
                          }

                          if (spanInfo.type === "reservation") {
                            const teacherRes = spanInfo.data;
                            const isOwnReservation = isAuthorizedToEdit(teacherRes.email, teacherRes.teacherName);
                            
                            return (
                              <td 
                                key={dayIdx} 
                                rowSpan={spanInfo.rowSpan}
                                onClick={() => setSelectedResForDetail(teacherRes)}
                                className="p-3 text-center align-middle bg-indigo-600 border-r border-slate-150 last:border-r-0 text-white relative group transition-all duration-150 cursor-pointer hover:bg-indigo-700 active:bg-indigo-800 shadow-inner"
                                title="Hacer clic para ver detalles o liberar esta reserva"
                              >
                                <div className="space-y-1">
                                  <div className="text-xs font-black tracking-tight drop-shadow-sm uppercase">
                                    {teacherRes.grade} "{teacherRes.section}"
                                  </div>
                                  
                                  <div className="text-[10px] opacity-90 inline-flex items-center justify-center gap-1 bg-indigo-700/50 px-2 py-0.5 rounded-full font-semibold">
                                    <User className="w-3 h-3 text-indigo-200 shrink-0" />
                                    <span className="truncate max-w-[100px]" title={teacherRes.teacherName}>
                                      {teacherRes.teacherName.split(" ").slice(0, 2).join(" ")}
                                    </span>
                                  </div>
                                </div>

                                {/* Hover Cancel Button */}
                                <div className="absolute inset-0 bg-indigo-700/95 rounded-lg flex flex-col items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-2">
                                  <a
                                    href={getGoogleCalendarUrl(teacherRes)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all shadow-md flex items-center justify-center gap-1 w-full text-center border border-emerald-500/20"
                                    title="Añadir a Google Calendar"
                                  >
                                    <Calendar className="w-3.5 h-3.5" />
                                    <span>Agendar</span>
                                  </a>
                                  
                                  {isOwnReservation && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCancelReservation(teacherRes.id, teacherRes.teacherName);
                                      }}
                                      className="bg-white/95 hover:bg-white text-rose-600 px-3 py-1 rounded-xl text-[10px] font-bold transition-all shadow-md flex items-center justify-center gap-1 w-full"
                                      title="Cancelar reserva"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      <span>Liberar</span>
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          }

                          // spanInfo.type === "free"
                          return (
                            <td 
                              key={dayIdx} 
                              onClick={() => handleCellClick(dayIdx, slotIdx, colDate)}
                              className="p-3 text-center border-r border-slate-150 last:border-r-0 bg-white hover:bg-emerald-50/50 hover:cursor-pointer transition-colors text-slate-300 hover:text-emerald-600 group"
                            >
                              <div className="w-full h-full min-h-[40px] flex flex-col items-center justify-center gap-0.5">
                                <Plus className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all font-bold stroke-2" />
                                <span className="text-[10px] text-slate-400 font-semibold group-hover:text-emerald-700 opacity-60 group-hover:opacity-100 transition-opacity">
                                  Disponible
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>

              </table>

            </div>
          </div>

          {/* Bottom panel – reservations & notifications */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex bg-slate-100 p-1 rounded-xl">
                <button
                  onClick={() => setConsoleTab("directory")}
                  className={`text-xs px-3.5 py-1.5 rounded-lg transition-all font-bold ${
                    consoleTab === "directory" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Reservas ({reservations.length})
                </button>
                <button
                  onClick={() => setConsoleTab("notifications")}
                  className={`text-xs px-3.5 py-1.5 rounded-lg transition-all font-bold ${
                    consoleTab === "notifications" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Alertas ({notifications.length})
                </button>
              </div>
            </div>

            <div className="p-4">
              {consoleTab === "directory" ? (
                reservations.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 space-y-2">
                    <Calendar className="w-8 h-8 mx-auto stroke-1 text-slate-300" />
                    <p className="text-xs font-semibold text-slate-500">No hay reservas registradas</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-150">
                    <table className="w-full text-left border-collapse text-xs min-w-[600px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-150 text-slate-500 font-semibold">
                          <th className="p-3">Docente</th>
                          <th className="p-3">Grado / Sección</th>
                          <th className="p-3">Fecha</th>
                          <th className="p-3">Horario</th>
                          <th className="p-3">Contacto</th>
                          <th className="p-3 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reservations.map((res, idx) => {
                          const isOwn = isAuthorizedToEdit(res.email, res.teacherName);
                          return (
                            <tr key={res.id || `res-${idx}`} className="hover:bg-slate-50/50 bg-white">
                              <td className="p-3 font-bold text-slate-800 uppercase">
                                {res.teacherName}
                                {isOwn && (
                                  <span className="ml-1.5 bg-indigo-100 text-indigo-700 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded-full">Tú</span>
                                )}
                              </td>
                              <td className="p-3 font-extrabold text-indigo-600 uppercase">{res.grade} "{res.section}"</td>
                              <td className="p-3 font-bold text-slate-700 capitalize">
                                {(() => {
                                  try {
                                    const parts = res.date.split("-").map(Number);
                                    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
                                  } catch { return res.date; }
                                })()}
                              </td>
                              <td className="p-3 font-semibold font-mono text-slate-500">
                                {TIME_SLOTS[Number(res.startSlot)]?.start} - {TIME_SLOTS[Number(res.endSlot)]?.end}
                              </td>
                              <td className="p-3 font-medium text-slate-500">{res.email || res.phone || "–"}</td>
                              <td className="p-3 text-right space-x-1.5 whitespace-nowrap">
                                <button
                                  onClick={() => {
                                    const parts = res.date.split("-").map(Number);
                                    setCurrentMonday(getMondayOfDate(new Date(parts[0], parts[1] - 1, parts[2])));
                                    document.querySelector("table")?.scrollIntoView({ behavior: "smooth" });
                                  }}
                                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 transition-all text-xs"
                                >
                                  Ver
                                </button>
                                {isOwn && (
                                  <button
                                    onClick={() => handleCancelReservation(res.id, res.teacherName)}
                                    className="bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold px-2.5 py-1.5 rounded-lg border border-rose-100 transition-all text-xs"
                                  >
                                    Liberar
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                <div className="space-y-2.5 max-h-[380px] overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="text-center py-10 text-slate-400 space-y-2">
                      <Mail className="w-8 h-8 mx-auto stroke-1 text-slate-300" />
                      <p className="text-xs font-semibold text-slate-500">Sin notificaciones</p>
                    </div>
                  ) : (
                    notifications.map((log, idx) => {
                      const isEmail = log.type === "email";
                      const isSms = log.type === "sms";
                      return (
                        <div key={log.id || `notif-${idx}`} className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                              {isEmail ? <Mail className="w-3.5 h-3.5 text-blue-500 shrink-0" /> : isSms ? <MessageSquare className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> : <Bell className="w-3.5 h-3.5 text-indigo-500 shrink-0" />}
                              {log.teacherName} · {log.grade} "{log.section}"
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center justify-between gap-2">
                            <span className="truncate">{log.timeRange} · {log.emailOrPhone}</span>
                            <span className="shrink-0 bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-bold text-[10px]">Enviado</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

        </main>

        {/* Floating help button */}
        <button
          onClick={() => setShowHelp(true)}
          className="fixed bottom-6 right-6 z-40 w-11 h-11 bg-white border border-slate-200 text-slate-500 hover:text-emerald-600 hover:border-emerald-300 rounded-full shadow-lg flex items-center justify-center transition-all hover:shadow-xl"
          title="Ayuda"
        >
          <HelpCircle className="w-5 h-5" />
        </button>

        {/* Help modal */}
        {showHelp && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-emerald-600" />
                  ¿Cómo usar la agenda?
                </h3>
                <button onClick={() => setShowHelp(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4 text-xs text-slate-600">
                <div className="space-y-1.5">
                  <h4 className="font-bold text-slate-800">Reservar un espacio</h4>
                  <ol className="space-y-1 text-slate-600 leading-relaxed">
                    <li>1. Navega a la semana deseada con las flechas.</li>
                    <li>2. Haz clic en una celda blanca libre.</li>
                    <li>3. Completa el formulario y elige el horario de fin para combinar bloques.</li>
                    <li>4. Confirma — la reserva se muestra en tiempo real para todos.</li>
                  </ol>
                </div>
                <div className="space-y-1.5">
                  <h4 className="font-bold text-slate-800">Tipos de celdas</h4>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded border border-sky-300 bg-sky-100 shrink-0"></span>Clase fija de computación (bloqueada)</div>
                    <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded bg-indigo-600 shrink-0"></span>Reservada por docente — clic para ver</div>
                    <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded border border-slate-200 bg-white shadow-inner shrink-0"></span>Libre — clic para reservar</div>
                  </div>
                </div>
                <div className="p-3 bg-amber-50 border border-amber-200/60 rounded-xl text-amber-800 space-y-1">
                  <p className="font-bold">Semanas alternadas</p>
                  <p>Cada 2 semanas hay clases fijas de computación. Las demás semanas, la sala está completamente libre.</p>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* Booking Form Dialog Modal */}
      <ReservationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        selectedDate={selectedColDate}
        selectedSlotIndex={selectedSlotIndex}
        dayIndex={selectedDayIndex}
        reservations={reservations}
        isOccupiedWeek={isOccupied}
        onSubmit={handleCreateReservation}
      />

      {/* POPUP DE ÉXITO REASEGURADOR (Resuelve la confusión con Google Calendar) */}
      {lastCreatedReservation && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200" id="success-confirmation-modal">
            <div className="p-6 text-center space-y-4">
              <div className="mx-auto bg-emerald-50 text-emerald-600 p-3.5 rounded-full w-14 h-14 flex items-center justify-center border border-emerald-100 shadow-inner">
                <CheckCircle className="w-8 h-8 stroke-2" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-black text-slate-850">¡RESERVA GUARDADA CON ÉXITO!</h3>
                <p className="text-xs text-slate-500 font-semibold px-2">
                  La sala de cómputo ya quedó registrada oficialmente en la Agenda Escolar. Todos los docentes pueden verla desde sus celulares.
                </p>
              </div>

              {/* Info card display */}
              <div className="bg-slate-50/80 border border-slate-150 rounded-2xl p-4 text-left space-y-2.5">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block leading-none">Grado y sección</span>
                    <span className="font-extrabold text-slate-800 uppercase">{lastCreatedReservation.grade} "{lastCreatedReservation.section}"</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block leading-none">Docente</span>
                    <span className="font-extrabold text-slate-800 truncate block max-w-full" title={lastCreatedReservation.teacherName}>
                      {lastCreatedReservation.teacherName}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs pt-1.5 border-t border-slate-100">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block leading-none">Fecha de reserva</span>
                    <span className="font-extrabold text-slate-800 capitalize">
                      {(() => {
                        try {
                          const parts = lastCreatedReservation.date.split("-").map(Number);
                          const d = new Date(parts[0], parts[1] - 1, parts[2]);
                          return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" });
                        } catch {
                          return lastCreatedReservation.date;
                        }
                      })()}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block leading-none">Horario</span>
                    <span className="font-extrabold text-slate-800">
                      {TIME_SLOTS[Number(lastCreatedReservation.startSlot)]?.start} - {TIME_SLOTS[Number(lastCreatedReservation.endSlot)]?.end}
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 py-2 px-3 rounded-xl flex items-center gap-1.5 justify-center font-medium leading-normal">
                <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0 animate-pulse" />
                <span>¿Deseas guardar un recordatorio en tu celular de Google?</span>
              </div>

              {/* Actions list */}
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => setLastCreatedReservation(null)}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-3 rounded-xl transition-all shadow-md flex items-center justify-center cursor-pointer"
                >
                  Listo, Volver a la Agenda Principal
                </button>
                
                <a
                  href={getGoogleCalendarUrl(lastCreatedReservation)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-emerald-600 hover:bg-emerald-505 text-white text-xs font-bold py-3 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 border border-emerald-500/10 cursor-pointer"
                >
                  <Calendar className="w-4 h-4" />
                  <span>Añadir a mi Google Calendar (Opcional)</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DETALLE DE RESERVA POPUP (Para ver información o cancelar desde móviles) */}
      {selectedResForDetail && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200" id="detail-reservation-modal">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-slate-850">
                <Info className="w-4 h-4 text-indigo-500 shrink-0" />
                <h3 className="font-extrabold text-sm">Información de la Reserva</h3>
              </div>
              <button 
                onClick={() => setSelectedResForDetail(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content card */}
            <div className="p-5 space-y-4">
              <div className="text-center space-y-1">
                <div className="text-xl font-black text-indigo-700 uppercase tracking-tight">
                  {selectedResForDetail.grade} "{selectedResForDetail.section}"
                </div>
                <div className="text-xs text-slate-500 font-semibold flex items-center justify-center gap-1">
                  <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>Docente: {selectedResForDetail.teacherName}</span>
                </div>
              </div>

              {/* Summary fields */}
              <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-3.5 space-y-2.5 text-xs text-slate-700">
                <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                  <span className="text-slate-400 font-bold uppercase text-[9px]">Día escolar</span>
                  <span className="font-extrabold text-slate-800 capitalize">
                    {(() => {
                      try {
                        const parts = selectedResForDetail.date.split("-").map(Number);
                        const d = new Date(parts[0], parts[1] - 1, parts[2]);
                        return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" });
                      } catch {
                        return selectedResForDetail.date;
                      }
                    })()}
                  </span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                  <span className="text-slate-400 font-bold uppercase text-[9px]">Horario Académico</span>
                  <span className="font-extrabold text-indigo-600">
                    {TIME_SLOTS[selectedResForDetail.startSlot]?.start} - {TIME_SLOTS[selectedResForDetail.endSlot]?.end}
                  </span>
                </div>
                {selectedResForDetail.email && (
                  <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                    <span className="text-slate-400 font-bold uppercase text-[9px]">Correo docente</span>
                    <span className="font-extrabold text-slate-800 truncate max-w-[180px]">{selectedResForDetail.email}</span>
                  </div>
                )}
                {selectedResForDetail.phone && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 font-bold uppercase text-[9px]">Notificación SMS</span>
                    <span className="font-extrabold text-slate-800">{selectedResForDetail.phone}</span>
                  </div>
                )}
              </div>

              {/* Ownership alert text */}
              {(() => {
                const isOwn = isAuthorizedToEdit(selectedResForDetail.email, selectedResForDetail.teacherName);
                
                return isOwn ? (
                  <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 p-2.5 rounded-xl text-center font-medium leading-normal">
                    ✨ Eres el propietario de esta reserva y puedes liberarla desde aquí.
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 p-2.5 rounded-xl text-center font-medium leading-normal">
                    🔒 Reservado para otro docente de forma oficial.
                  </div>
                );
              })()}

              <div className="flex flex-col gap-2 pt-1 border-t border-slate-100">
                {(() => {
                  const isOwn = isAuthorizedToEdit(selectedResForDetail.email, selectedResForDetail.teacherName);
                  
                  return isOwn ? (
                    <button
                      onClick={() => {
                        handleCancelReservation(selectedResForDetail.id, selectedResForDetail.teacherName);
                        setSelectedResForDetail(null);
                      }}
                      className="w-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md shadow-rose-600/10 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Liberar Horario (Cancelar reserva)</span>
                    </button>
                  ) : null;
                })()}

                <a
                  href={getGoogleCalendarUrl(selectedResForDetail)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setSelectedResForDetail(null)}
                  className="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all border border-slate-200 cursor-pointer text-center"
                >
                  <Calendar className="w-3.5 h-3.5 text-slate-500" />
                  <span>Añadir a mi Google Calendar</span>
                </a>

                <button
                  type="button"
                  onClick={() => setSelectedResForDetail(null)}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2.5 rounded-xl transition-all cursor-pointer"
                >
                  Volver a la Agenda
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
