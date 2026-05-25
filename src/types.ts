export interface TimeSlot {
  name: string; // e.g. "07:20 - 08:05"
  start: string; // "07:20"
  end: string; // "08:05"
  isRecreo?: boolean;
}

export interface Reservation {
  id: string;
  teacherName: string;
  grade: string;
  section: string;
  date: string; // "YYYY-MM-DD"
  startSlot: number; // Index in TIME_SLOTS
  endSlot: number; // Index in TIME_SLOTS (inclusive)
  email?: string;
  phone?: string;
  createdAt: string;
}

export interface DefaultClass {
  gradeClass: string;
  colorTheme: 'blue' | 'peach' | 'yellow' | 'purple' | 'purple-light' | 'green';
}

export interface NotificationLog {
  id: string;
  teacherName: string;
  grade: string;
  section: string;
  date: string;
  timeRange: string;
  emailOrPhone: string;
  timestamp: string;
  type: 'email' | 'sms' | 'system';
}

export const TIME_SLOTS: TimeSlot[] = [
  { name: "7:20 – 8:05", start: "07:20", end: "08:05" },
  { name: "8:05 – 8:50", start: "08:05", end: "08:50" },
  { name: "8:50 – 9:35", start: "08:50", end: "09:35" },
  { name: "9:35 – 10:20", start: "09:35", end: "10:20" },
  { name: "10:20 – 10:50", start: "10:20", end: "10:50" },
  { name: "10:50 – 11:35", start: "10:50", end: "11:35" },
  { name: "11:35 – 12:20", start: "11:35", end: "12:20" },
  { name: "12:20 – 1:05", start: "12:20", end: "13:05" },
  { name: "1:05 – 1:50", start: "13:05", end: "13:50" },
  { name: "1:50 – 2:05", start: "13:50", end: "14:05" },
  { name: "2:05 – 2:35", start: "14:05", end: "14:35" }
];

export const DEFAULT_CLASSES: Record<string, DefaultClass> = {
  // Lunes (DayIndex 0 in clientside Mon-Fri mapping)
  "0-0": { gradeClass: "5º A", colorTheme: "blue" },
  "0-1": { gradeClass: "5º A", colorTheme: "blue" },
  "0-2": { gradeClass: "5º B", colorTheme: "blue" },
  "0-3": { gradeClass: "5º B", colorTheme: "blue" },
  "0-7": { gradeClass: "4º A", colorTheme: "purple" },
  "0-8": { gradeClass: "4º A", colorTheme: "purple" },

  // Martes (DayIndex 1)
  "1-0": { gradeClass: "6º A", colorTheme: "peach" },
  "1-1": { gradeClass: "6º A", colorTheme: "peach" },
  "1-2": { gradeClass: "6º B", colorTheme: "peach" },
  "1-3": { gradeClass: "6º B", colorTheme: "peach" },
  "1-8": { gradeClass: "3ER AÑO A", colorTheme: "yellow" },
  "1-9": { gradeClass: "3ER AÑO A", colorTheme: "yellow" },
  "1-10": { gradeClass: "3ER AÑO A", colorTheme: "yellow" },

  // Miércoles (DayIndex 2)
  "2-6": { gradeClass: "1ER AÑO B", colorTheme: "yellow" },
  "2-7": { gradeClass: "1ER AÑO B", colorTheme: "yellow" },
  "2-8": { gradeClass: "5TO AÑO", colorTheme: "yellow" },
  "2-9": { gradeClass: "5TO AÑO", colorTheme: "yellow" },
  "2-10": { gradeClass: "5TO AÑO", colorTheme: "yellow" },

  // Jueves (DayIndex 3)
  "3-0": { gradeClass: "2DO AÑO B", colorTheme: "yellow" },
  "3-1": { gradeClass: "2DO AÑO B", colorTheme: "yellow" },
  "3-2": { gradeClass: "1ER AÑO A", colorTheme: "yellow" },
  "3-3": { gradeClass: "1ER AÑO A", colorTheme: "yellow" },
  "3-6": { gradeClass: "2DO AÑO A", colorTheme: "yellow" },
  "3-7": { gradeClass: "2DO AÑO A", colorTheme: "yellow" },
  "3-8": { gradeClass: "3ER AÑO B", colorTheme: "yellow" },
  "3-9": { gradeClass: "3ER AÑO B", colorTheme: "yellow" },
  "3-10": { gradeClass: "3ER AÑO B", colorTheme: "yellow" },

  // Viernes (DayIndex 4)
  "4-0": { gradeClass: "4º B", colorTheme: "purple-light" },
  "4-1": { gradeClass: "4º B", colorTheme: "purple-light" },
  "4-2": { gradeClass: "3º A", colorTheme: "green" },
  "4-3": { gradeClass: "3º A", colorTheme: "green" },
  "4-5": { gradeClass: "3º B", colorTheme: "green" },
  "4-6": { gradeClass: "3º B", colorTheme: "green" },
  "4-8": { gradeClass: "4TO AÑO", colorTheme: "yellow" },
  "4-9": { gradeClass: "4TO AÑO", colorTheme: "yellow" },
  "4-10": { gradeClass: "4TO AÑO", colorTheme: "yellow" }
};
