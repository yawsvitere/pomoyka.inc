import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import * as archiveApi from "../api/archive";
import { Calendar } from "../components/calendar/calendar.tsx";
import type { CalendarDayData } from "../components/calendar/calendar.tsx";
import "../styles/pages/archive-calendar.css";

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function ArchiveCalendarPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [calendar, setCalendar] =
    useState<archiveApi.ArchiveCalendarMonth | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const navigate = useNavigate();

  useEffect(() => {
    loadCalendar();
  }, [year, month]);

  async function loadCalendar() {
    setIsLoading(true);
    setError("");
    try {
      const data = await archiveApi.getArchiveCalendar(year, month);
      setCalendar(data);
    } catch (err) {
      console.error("Error loading calendar:", err);
      setError("Не удалось загрузить календарь архива");
    } finally {
      setIsLoading(false);
    }
  }

  function handlePreviousMonth() {
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  }

  function handleNextMonth() {
    if (month === 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  }

  function handleDayClick(day: number) {
    navigate(`/archive/${year}/${month}/${day}`);
  }

  const archiveDaysByDate = new Map<number, archiveApi.ArchiveDay>();
  if (calendar) {
    calendar.days.forEach((day) => {
      const [, , dayStr] = day.date.split("-");
      archiveDaysByDate.set(Number(dayStr), day);
    });
  }

  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() + 1 === month;

  const days: CalendarDayData[] = Array.from(
    { length: new Date(year, month, 0).getDate() },
    (_, i) => {
      const dayNum = i + 1;
      const archiveDay = archiveDaysByDate.get(dayNum);

      return {
        day: dayNum,
        isToday: isCurrentMonth && today.getDate() === dayNum,
        isClickable: !!archiveDay,
        chips: archiveDay
          ? [
              {
                label: `Насрано: ${archiveDay.postCount}`,
                weight: "strong" as const,
              },
              {
                label: `Постишки: ${archiveDay.postishkaCount}`,
                weight: "soft" as const,
              },
            ]
          : undefined,
      };
    },
  );

  const totalPosts =
    calendar?.days.reduce((sum, d) => sum + d.postCount, 0) ?? 0;

  return (
    <div className="archive-calendar-page">


      {error && <div className="archive-error">{error}</div>}

      <div className="calendar-container">
        <Calendar
          month={month}
          year={year}
          weekdayLabels={WEEKDAY_LABELS}
          title={`${MONTH_NAMES[month - 1]} ${year}`}
          days={days}
          isLoading={isLoading}
          onPreviousMonth={handlePreviousMonth}
          onNextMonth={handleNextMonth}
          onDayClick={handleDayClick}
          legend={[
            { label: `${totalPosts} постов`, weight: "strong" },
            {
              label: `${calendar?.days.length ?? 0} активных дней`,
              weight: "soft",
            },
          ]}
        />
      </div>
    </div>
  );
}


