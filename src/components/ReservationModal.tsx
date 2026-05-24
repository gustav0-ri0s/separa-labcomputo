import { useState, useEffect, FormEvent } from "react";
import { TIME_SLOTS, TIME_SLOTS as ALL_SLOTS, DEFAULT_CLASSES, Reservation } from "../types";
import { X, Calendar, Clock, User, Award, School, Mail, MessageSquare, AlertCircle, Sparkles } from "lucide-react";

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string; // YYYY-MM-DD
  selectedSlotIndex: number;
  dayIndex: number; // 0 = Lunes, 1 = Martes, etc.
  reservations: Reservation[];
  isOccupiedWeek: boolean;
  onSubmit: (data: {
    teacherName: string;
    grade: string;
    section: string;
    startSlot: number;
    endSlot: number;
    email?: string;
    phone?: string;
    date?: string;
  }) => Promise<boolean>;
}

export function ReservationModal({
  isOpen,
  onClose,
  selectedDate,
  selectedSlotIndex,
  dayIndex,
  reservations,
  isOccupiedWeek,
  onSubmit
}: ReservationModalProps) {
  const [localDate, setLocalDate] = useState(selectedDate);
  const [localDayIndex, setLocalDayIndex] = useState(dayIndex);
  const [teacherName, setTeacherName] = useState("");
  const [grade, setGrade] = useState("");
  const [section, setSection] = useState("");
  const [startSlot, setStartSlot] = useState(selectedSlotIndex);
  const [endSlot, setEndSlot] = useState(selectedSlotIndex);
  const [notificationType, setNotificationType] = useState<"none" | "email" | "sms">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Generate the 5 days of the current week (Lunes - Viernes)
  const getWeekDays = () => {
    try {
      const parts = selectedDate.split("-").map(Number);
      const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
      const mondayDate = new Date(dateObj);
      mondayDate.setDate(mondayDate.getDate() - dayIndex);

      const days = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(mondayDate);
        d.setDate(d.getDate() + i);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        const dateStr = `${yyyy}-${mm}-${dd}`;
        
        let weekdayName = d.toLocaleDateString("es-ES", { weekday: "long" });
        weekdayName = weekdayName.charAt(0).toUpperCase() + weekdayName.slice(1);
        const dayNum = d.getDate();
        const monthNum = d.getMonth() + 1;
        days.push({
          index: i,
          date: dateStr,
          label: `${weekdayName} (${dayNum}/${monthNum})`
        });
      }
      return days;
    } catch {
      return [];
    }
  };

  const weekDaysList = getWeekDays();

  const getSlotNameForDay = (idx: number) => {
    const slot = ALL_SLOTS[idx];
    if (!slot) return "";
    return slot.name;
  };

  const getSlotEndForDay = (idx: number) => {
    const slot = ALL_SLOTS[idx];
    if (!slot) return "";
    const parts = slot.end.split(":");
    if (parts.length === 2) {
      const h = parseInt(parts[0], 10);
      const m = parts[1];
      if (h > 12) return `${h - 12}:${m}`;
      if (h === 0) return `12:${m}`;
      return `${h}:${m}`;
    }
    return slot.end;
  };

  // Sync state if selected items change
  useEffect(() => {
    if (isOpen) {
      setLocalDate(selectedDate);
      setLocalDayIndex(dayIndex);
      setStartSlot(selectedSlotIndex);
      setEndSlot(selectedSlotIndex);
      setErrorMsg(null);
      
      const loggedName = localStorage.getItem("muivc_name") || "";
      const loggedEmail = localStorage.getItem("muivc_email") || "";
      if (loggedName) {
        setTeacherName(loggedName);
      }
      if (loggedEmail) {
        setEmail(loggedEmail);
        setNotificationType("email");
      }
    }
  }, [isOpen, selectedDate, dayIndex, selectedSlotIndex]);

  if (!isOpen) return null;

  // Custom checker for disabled slot
  function isSlotDisabled(slotIdx: number): boolean {
    return false;
  }

  // Calculate valid start slots
  const availableStartSlots = ALL_SLOTS.filter((_, idx) => {
    if (isSlotDisabled(idx)) return false;
    // Check if occupied by computacion in occupied week
    if (isOccupiedWeek) {
      if (DEFAULT_CLASSES[`${localDayIndex}-${idx}`]) return false;
    }
    // Check if occupied by custom reservation
    const isReserved = reservations.some(r => r.date === localDate && idx >= Number(r.startSlot) && idx <= Number(r.endSlot));
    if (isReserved) return false;
    return true;
  });

  // Calculate valid consecutive end slots to "combinar horas"
  const getValidEndIndices = (startIdx: number): number[] => {
    const valid: number[] = [];
    for (let idx = startIdx; idx < ALL_SLOTS.length; idx++) {
      if (isSlotDisabled(idx)) break;
      if (isOccupiedWeek && DEFAULT_CLASSES[`${localDayIndex}-${idx}`]) break;
      
      const overlap = reservations.some(
        (r) => r.date === localDate && idx >= Number(r.startSlot) && idx <= Number(r.endSlot)
      );
      if (overlap) break;

      valid.push(idx);
    }
    return valid;
  };

  const validEndIndices = getValidEndIndices(startSlot);

  // Auto adjust endSlot if invalid
  if (validEndIndices.length > 0 && !validEndIndices.includes(endSlot)) {
    setEndSlot(validEndIndices[0]);
  }

  const handleStartChange = (idx: number) => {
    setStartSlot(idx);
    const validEnds = getValidEndIndices(idx);
    if (validEnds.length > 0) {
      setEndSlot(validEnds[0]);
    }
  };

  const handleFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!teacherName.trim()) {
      setErrorMsg("Por favor, ingrese el nombre del docente.");
      return;
    }
    if (!grade.trim()) {
      setErrorMsg("Por favor, seleccione o ingrese el grado.");
      return;
    }
    if (!section.trim()) {
      setErrorMsg("Por favor, ingrese el salón / sección.");
      return;
    }

    if (notificationType === "email" && !email.trim()) {
      setErrorMsg("Por favor, ingrese un correo válido para recibir notificaciones.");
      return;
    }
    if (notificationType === "sms" && !phone.trim()) {
      setErrorMsg("Por favor, ingrese un número de teléfono/celular para notificaciones SMS.");
      return;
    }

    setSubmitting(true);
    try {
      const success = await onSubmit({
        teacherName,
        grade,
        section,
        startSlot,
        endSlot,
        email: notificationType === "email" ? email : undefined,
        phone: notificationType === "sms" ? phone : undefined,
        date: localDate
      });

      if (success) {
        // Reset and close
        setTeacherName("");
        setGrade("");
        setSection("");
        setEmail("");
        setPhone("");
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Ocurrió un error al procesar la reserva.");
    } finally {
      setSubmitting(false);
    }
  };

  // Human friendly display date in Spanish (e.g. Lunes, 25 de Mayo)
  const getReadableDate = () => {
    try {
      const parts = localDate.split("-").map(Number);
      const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
      return dateObj.toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long"
      });
    } catch {
      return localDate;
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-sm z-50 overflow-y-auto" id="reservation-modal">
      <div className="min-h-screen w-full flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-50 text-emerald-600 p-2 rounded-xl">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base">Reservar Sala de Cómputo</h3>
              <p className="text-xs text-slate-500">Separar espacio de computación</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-1.5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Info Column */}
        <form onSubmit={handleFormSubmit} className="p-6 space-y-4">
          
          <div className="grid grid-cols-2 gap-3.5 bg-slate-50/70 p-3.5 rounded-xl border border-slate-100">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Calendar className="w-4 h-4 text-emerald-500 shrink-0" />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Día seleccionado</p>
                <p className="font-semibold text-slate-800 capitalize">{getReadableDate()}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Clock className="w-4 h-4 text-emerald-500 shrink-0" />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Frecuencia / Horario</p>
                <p className="font-semibold text-slate-800">
                  {ALL_SLOTS[startSlot]?.start} - {ALL_SLOTS[endSlot]?.end}
                </p>
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="font-medium">{errorMsg}</p>
            </div>
          )}

          {/* Teacher name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" />
              Nombre del Docente
            </label>
            <input
              type="text"
              placeholder="Ej. Prof. Carlos Gómez"
              required
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition-all font-medium text-slate-800"
            />
          </div>

          {/* Grado y sección en fila */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-slate-400" />
                Grado / Nivel
              </label>
              <select
                required
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 bg-white transition-all font-medium text-slate-800"
              >
                <option value="">Seleccione Grado</option>
                <option value="1ER AÑO">1er Año (Secundaria)</option>
                <option value="2DO AÑO">2do Año (Secundaria)</option>
                <option value="3ER AÑO">3er Año (Secundaria)</option>
                <option value="4TO AÑO">4to Año (Secundaria)</option>
                <option value="5TO AÑO">5to Año / Año (Secundaria)</option>
                <option value="1º">1º (Primaria)</option>
                <option value="2º">2º (Primaria)</option>
                <option value="3º">3º (Primaria)</option>
                <option value="4º">4º (Primaria)</option>
                <option value="5º">5º (Primaria)</option>
                <option value="6º">6º (Primaria)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <School className="w-3.5 h-3.5 text-slate-400" />
                Salón / Sección
              </label>
              <input
                type="text"
                placeholder="Ej. A, B, C, Única"
                required
                value={section}
                onChange={(e) => setSection(e.target.value)}
                className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition-all font-medium text-slate-800"
              />
            </div>
          </div>

          {/* Selección de día opcional para corregir errores de fecha */}
          <div className="space-y-1.5 p-3.5 bg-emerald-50/10 border border-emerald-500/15 rounded-xl">
            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-emerald-600" />
              Fecha / Día de la Semana
            </label>
            <select
              value={localDayIndex}
              onChange={(e) => {
                const idx = parseInt(e.target.value, 10);
                const dayObj = weekDaysList.find(d => d.index === idx);
                if (dayObj) {
                  setLocalDayIndex(idx);
                  setLocalDate(dayObj.date);
                  setErrorMsg(null);
                }
              }}
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 bg-white transition-all font-semibold text-slate-800 cursor-pointer"
            >
              {weekDaysList.map((day) => (
                <option key={day.index} value={day.index}>
                  {day.label}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-slate-400 font-medium leading-none block">
              💡 Si te confundiste de día al hacer clic en la agenda, puedes corregirlo aquí.
            </span>
          </div>

          {/* Combinar horas - Interval selection */}
          <div className="grid grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Bloque de Inicio
              </label>
              <select
                value={startSlot}
                onChange={(e) => handleStartChange(parseInt(e.target.value, 10))}
                className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 outline-none bg-white font-medium text-slate-800"
              >
                {availableStartSlots.map((slot) => {
                  const idx = ALL_SLOTS.indexOf(slot);
                  return (
                    <option key={idx} value={idx}>
                      {getSlotNameForDay(idx)}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Bloque de Fin (Combinar)
              </label>
              <select
                value={endSlot}
                onChange={(e) => setEndSlot(parseInt(e.target.value, 10))}
                className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 outline-none bg-white font-medium text-slate-800"
              >
                {validEndIndices.map((idx) => (
                  <option key={idx} value={idx}>
                    Hasta {getSlotEndForDay(idx)} ({getSlotNameForDay(idx)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="p-2 border-t border-slate-100 flex items-center gap-1.5 text-[11px] text-emerald-600 font-medium">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>¡Puedes combinar múltiples horas consecutivas seleccionando un bloque de fin mayor!</span>
          </div>

          {/* Notifications config section */}
          <div className="border border-slate-100 rounded-xl p-4 bg-indigo-50/40 space-y-3.5">
            <div>
              <h4 className="text-xs font-bold text-indigo-950">Sistema de Alertas Automáticas</h4>
              <p className="text-[11px] text-indigo-700 leading-normal">
                Recibe una confirmación instantánea tras realizar tu reserva de forma segura.
              </p>
            </div>

            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="notif_chan"
                  checked={notificationType === "email"}
                  onChange={() => setNotificationType("email")}
                  className="accent-indigo-600"
                />
                <Mail className="w-3.5 h-3.5 text-slate-500" />
                Email
              </label>
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="notif_chan"
                  checked={notificationType === "sms"}
                  onChange={() => setNotificationType("sms")}
                  className="accent-indigo-600"
                />
                <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
                SMS / Celular
              </label>
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="notif_chan"
                  checked={notificationType === "none"}
                  onChange={() => setNotificationType("none")}
                  className="accent-indigo-600"
                />
                Solo App
              </label>
            </div>

            {notificationType === "email" && (
              <div className="space-y-1 text-xs text-slate-700">
                <label className="font-semibold text-slate-600 flex items-center gap-1">Correo Electrónico</label>
                <input
                  type="email"
                  required
                  placeholder="ej. docente@colegio.edu.pe"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full text-xs px-3.5 py-2 border border-slate-200 outline-none rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 bg-white text-slate-800"
                />
              </div>
            )}

            {notificationType === "sms" && (
              <div className="space-y-1 text-xs text-slate-700">
                <label className="font-semibold text-slate-600 flex items-center gap-1">Número Celular</label>
                <input
                  type="tel"
                  required
                  placeholder="ej. +51 987 654 321"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full text-xs px-3.5 py-2 border border-slate-200 outline-none rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 bg-white text-slate-800"
                />
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="text-slate-600 text-xs px-4 py-2.5 rounded-xl hover:bg-slate-100 font-semibold transition-colors border border-transparent"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-5 py-2.5 rounded-xl font-bold font-semibold transition-colors flex items-center gap-1.5 shadow-sm shadow-emerald-600/10 disabled:opacity-50"
            >
              {submitting ? "Confirmando..." : "Confirmar Reserva"}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}
