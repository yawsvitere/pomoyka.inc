import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../../styles/components/date-range-picker.css";

export type DateRangeValue = {
  from: string | null;
  to: string | null;
};

type Props = {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  placeholder?: string;
  max?: string;
  align?: "start" | "end";
  className?: string;
};

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const monthFormatter = new Intl.DateTimeFormat("ru-RU", {
  month: "long",
  year: "numeric",
});
const shortFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
});
const shortYearFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatRange(from: string | null, to: string | null) {
  if (!from) return null;
  const a = parseISO(from);
  const sameYear = new Date().getFullYear() === a.getFullYear();
  const fmt = sameYear ? shortFormatter : shortYearFormatter;
  if (!to || to === from) return fmt.format(a);
  return `${fmt.format(a)} – ${fmt.format(parseISO(to))}`;
}

const ChevronIcon = ({ dir }: { dir: "left" | "right" }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={dir === "left" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} />
  </svg>
);

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Любая дата",
  max,
  align = "end",
  className = "",
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState(() =>
    startOfMonth(value.from ? parseISO(value.from) : new Date()),
  );

  const todayISO = toISO(new Date());

  const close = useCallback(() => {
    setOpen(false);
    setAnchor(null);
    setHover(null);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    setViewMonth(startOfMonth(value.from ? parseISO(value.from) : new Date()));
    setOpen(true);
  };

  const [rangeStart, rangeEnd] = useMemo(() => {
    if (anchor) {
      const other = hover ?? anchor;
      return anchor <= other ? [anchor, other] : [other, anchor];
    }
    return [value.from, value.to ?? value.from];
  }, [anchor, hover, value.from, value.to]);

  const days = useMemo(() => {
    const first = startOfMonth(viewMonth);
    const offset = (first.getDay() + 6) % 7;
    const count = new Date(
      first.getFullYear(),
      first.getMonth() + 1,
      0,
    ).getDate();
    const cells: (string | null)[] = Array(offset).fill(null);
    for (let i = 1; i <= count; i += 1)
      cells.push(toISO(new Date(first.getFullYear(), first.getMonth(), i)));
    return cells;
  }, [viewMonth]);

  const shiftMonth = (delta: number) =>
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const handlePick = (iso: string) => {
    if (!anchor) {
      setAnchor(iso);
      setHover(iso);
      return;
    }
    const [from, to] = anchor <= iso ? [anchor, iso] : [iso, anchor];
    onChange({ from, to });
    close();
  };

  const applyPreset = (daysBack: number) => {
    const today = new Date();
    onChange({
      from: toISO(addDays(today, -daysBack)),
      to: toISO(today),
    });
    close();
  };

  const clear = () => {
    onChange({ from: null, to: null });
    close();
  };

  const label = formatRange(value.from, value.to);
  const hasValue = Boolean(value.from);
  const monthTitle = monthFormatter.format(viewMonth);

  return (
    <div
      ref={rootRef}
      className={`drp${open ? " is-open" : ""} ${className}`.trim()}
    >
      <button
        type="button"
        className={`drp-trigger${hasValue ? " has-value" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <svg
          className="drp-trigger__icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <rect x="3.5" y="5" width="17" height="15" rx="3" />
          <path d="M8 3v4M16 3v4M3.5 10h17" />
        </svg>
        <span className="drp-trigger__label">{label ?? placeholder}</span>
      </button>

      {open && (
        <div
          className={`drp-popover drp-popover--${align}`}
          role="dialog"
          aria-label="Выбор периода"
        >
          <div className="drp-presets">
            <button type="button" onClick={() => applyPreset(0)}>
              Сегодня
            </button>
            <button type="button" onClick={() => applyPreset(6)}>
              7 дней
            </button>
            <button type="button" onClick={() => applyPreset(29)}>
              30 дней
            </button>
          </div>

          <div className="drp-header">
            <button
              type="button"
              className="drp-nav"
              onClick={() => shiftMonth(-1)}
              aria-label="Предыдущий месяц"
            >
              <ChevronIcon dir="left" />
            </button>
            <span className="drp-title">{monthTitle}</span>
            <button
              type="button"
              className="drp-nav"
              onClick={() => shiftMonth(1)}
              aria-label="Следующий месяц"
            >
              <ChevronIcon dir="right" />
            </button>
          </div>

          <div className="drp-weekdays">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div
            className="drp-grid"
            onMouseLeave={() => anchor && setHover(anchor)}
          >
            {days.map((iso, index) => {
              if (!iso) return <span key={`blank-${index}`} />;
              const disabled = Boolean(max && iso > max);
              const isStart = iso === rangeStart;
              const isEnd = iso === rangeEnd;
              const inRange =
                rangeStart && rangeEnd && iso > rangeStart && iso < rangeEnd;
              const single = rangeStart === rangeEnd;
              const cellClass = [
                "drp-cell",
                inRange ? "is-in-range" : "",
                isStart && !single ? "is-range-start" : "",
                isEnd && !single ? "is-range-end" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const dayClass = [
                "drp-day",
                isStart || isEnd ? "is-selected" : "",
                iso === todayISO ? "is-today" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div key={iso} className={cellClass}>
                  <button
                    type="button"
                    className={dayClass}
                    disabled={disabled}
                    aria-pressed={isStart || isEnd}
                    aria-label={shortYearFormatter.format(parseISO(iso))}
                    onClick={() => handlePick(iso)}
                    onMouseEnter={() => anchor && setHover(iso)}
                    onFocus={() => anchor && setHover(iso)}
                  >
                    {Number(iso.slice(8))}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="drp-footer">
            <span className="drp-hint">
              {anchor ? "Выберите конец периода" : "Выберите начало периода"}
            </span>
            {hasValue && (
              <button type="button" className="drp-clear" onClick={clear}>
                Сбросить
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
