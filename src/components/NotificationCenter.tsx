import { NotificationLog } from "../types";
import { Mail, MessageSquare, Bell, Clock, Trash2, RotateCcw } from "lucide-react";

interface NotificationCenterProps {
  logs: NotificationLog[];
  onReset: () => void;
}

export function NotificationCenter({ logs, onReset }: NotificationCenterProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden h-full flex flex-col" id="notification-center">
      <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-50 text-indigo-600 p-2 rounded-lg">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 text-sm">Historial de Notificaciones</h3>
            <p className="text-xs text-slate-500">Alertas de confirmación automáticas</p>
          </div>
        </div>
        
        <button
          onClick={onReset}
          className="text-xs text-rose-600 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1 border border-rose-100"
          title="Reiniciar base de datos"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reiniciar Todo
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[420px] lg:max-h-none">
        {logs.length === 0 ? (
          <div className="text-center py-8 text-slate-400 space-y-2">
            <Bell className="w-8 h-8 mx-auto stroke-1" />
            <p className="text-xs">Usa la agenda para realizar reservas. Las notificaciones de confirmación aparecerán aquí automáticamente.</p>
          </div>
        ) : (
          logs.map((log) => {
            const isEmail = log.type === "email";
            const isSms = log.type === "sms";
            
            return (
              <div
                key={log.id}
                className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-medium text-slate-700">
                    {isEmail && <Mail className="w-3.5 h-3.5 text-blue-500" />}
                    {isSms && <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />}
                    {!isEmail && !isSms && <Bell className="w-3.5 h-3.5 text-indigo-500" />}
                    {isEmail ? "Notificación por Email" : isSms ? "Notificación por SMS" : "Sistema"}
                  </span>
                  <span className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                    <Clock className="w-3 h-3" />
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>

                <p className="text-slate-600 leading-normal">
                  Se ha despachado una alerta instantánea para el docente <strong className="text-slate-800 font-semibold">{log.teacherName}</strong> confirmando su reserva de la sala de cómputo para <strong className="text-slate-800 font-semibold">{log.grade} "{log.section}"</strong> el día <strong className="text-slate-800 font-semibold">{log.date}</strong> en el rango <strong className="text-indigo-600 font-semibold">{log.timeRange}</strong>.
                </p>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                  <span>Destinatario: <strong className="text-slate-700">{log.emailOrPhone}</strong></span>
                  <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">Enviado</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
