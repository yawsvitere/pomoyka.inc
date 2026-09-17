import { Spinner } from "../ui/Spinner";
import "../../styles/pages/calendar.css";

export type CalendarView = "day" | "week" | "month" | "list";

export interface CalendarChip {
  label: string;
  weight?: "strong" | "medium" | "soft";
}

export interface CalendarDayData {
  day: number;
  chips?: CalendarChip[];
  isToday?: boolean;
  isClickable?: boolean;
}

export interface CalendarLegendItem {
  label: string;
  weight?: "strong" | "medium" | "soft";
}

export interface CalendarProps {
  month: number;
  year: number;
  weekdayLabels: string[];
  title: string;
  days: CalendarDayData[];
  isLoading?: boolean;
  onPreviousMonth?: () => void;
  onNextMonth?: () => void;
  onDayClick?: (day: number) => void;
  legend?: CalendarLegendItem[];
  view?: CalendarView;
  onViewChange?: (view: CalendarView) => void;
  maxChipsPerCell?: number;
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M6.15 1.79L5.64 1.28 2.56 4.36l3.08 3.08.51-.51L3.59 4.36 6.15 1.79z"
        fill="currentColor"
      />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.56 6.92l.51.52 3.08-3.08L2.56 1.28l-.51.51 2.57 2.57-2.57 2.56z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Calendar({
  month,
  year,
  weekdayLabels,
  title,
  days,
  isLoading = false,
  onPreviousMonth,
  onNextMonth,
  onDayClick,
  maxChipsPerCell = 3,
}: CalendarProps) {
  const daysByNumber = new Map<number, CalendarDayData>();
  days.forEach((d) => daysByNumber.set(d.day, d));

  // Monday-first offset (JS getDay: 0 = Sunday)
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

  const cells: { day: number; outside: boolean }[] = [];

  for (let i = firstWeekday; i > 0; i--) {
    cells.push({ day: daysInPrevMonth - i + 1, outside: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, outside: false });
  }
  while (cells.length % 7 !== 0) {
    cells.push({
      day: cells.length - firstWeekday - daysInMonth + 1,
      outside: true,
    });
  }

  return (
    <div className="calendar">
     

      <div className="calendar-nav">
        <button
          type="button"
          className="calendar-nav-btn"
          onClick={onPreviousMonth}
          disabled={!onPreviousMonth}
          aria-label="Предыдущий месяц"
        >
          <ChevronLeft />
        </button>
        <span className="calendar-title">{title}</span>
        <button
          type="button"
          className="calendar-nav-btn"
          onClick={onNextMonth}
          disabled={!onNextMonth}
          aria-label="Следующий месяц"
        >
          <ChevronRight />
        </button>
      </div>

      {isLoading ? (
        <div className="calendar-loading">
          <Spinner />
        </div>
      ) : (
        <div className="calendar-grid">
          {weekdayLabels.map((label) => (
            <div className="calendar-weekday" key={label}>
              {label}
            </div>
          ))}

          {cells.map((cell, index) => {
            const data = !cell.outside ? daysByNumber.get(cell.day) : undefined;
            const chips = data?.chips ?? [];
            const visibleChips = chips.slice(0, maxChipsPerCell);
            const hiddenCount = chips.length - visibleChips.length;
            const clickable =
              !cell.outside && !!data?.isClickable && !!onDayClick;
            const weekdayLabel = weekdayLabels[index % 7];

            return (
              <button
                key={`${cell.outside ? "o" : "d"}-${index}`}
                type="button"
                className={[
                  "calendar-cell",
                  cell.outside ? "is-outside" : "",
                  data?.isToday ? "is-today" : "",
                  chips.length > 0 ? "has-items" : "",
                  clickable ? "is-clickable" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => clickable && onDayClick?.(cell.day)}
                disabled={!clickable}
              >
                <span className="calendar-cell-daynum" data-weekday-short={weekdayLabel}>
                  {cell.day}
                </span>
                {visibleChips.length > 0 && (
                  <span className="calendar-cell-chips">
                    {visibleChips.map((chip, i) => (
                      <span
                        key={i}
                        className={`calendar-chip chip-${chip.weight ?? "medium"}`}
                      >
                        {chip.label}
                      </span>
                    ))}
                    {hiddenCount > 0 && (
                      <span className="calendar-chip-more">+{hiddenCount}</span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}