import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "../ui/Spinner";
import "../../styles/pages/calendar.css";

export type CalendarView = "day" | "week" | "month" | "list";

export interface CalendarChip {
  label: string;
  weight?: "strong" | "medium" | "soft";
}

export type CalendarGroupTone = "feed" | "posts";

export interface CalendarGroupPreview {
  title: string;
  author: string;
  avatarUrl?: string | null;
  imageUrl?: string;
}

export interface CalendarParticipant {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CalendarGroup {
  id: string;
  label: string;
  count: number;
  tone: CalendarGroupTone;
  preview?: CalendarGroupPreview[];
  previewLoading?: boolean;
  previewError?: string;
  emptyMessage?: string;
}

export interface CalendarDayData {
  day: number;
  chips?: CalendarChip[];
  groups?: CalendarGroup[];
  participantCount?: number;
  participants?: CalendarParticipant[];
  /** 0..1, влияет на яркость фона ячейки */
  intensity?: number;
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
  onDayHover?: (day: number) => void;
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

const POPOVER_W = 288;

function popoverStyle(rect: DOMRect): CSSProperties {
  const fitsRight = rect.right + 12 + POPOVER_W < window.innerWidth;
  const left = fitsRight ? rect.right + 8 : rect.left - POPOVER_W - 8;
  const top = Math.min(Math.max(8, rect.top), window.innerHeight - 340);
  return { left: Math.max(8, left), top: Math.max(8, top), width: POPOVER_W };
}

function russianCount(count: number, forms: [string, string, string]) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
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
  onDayHover,
  maxChipsPerCell = 3,
}: CalendarProps) {
  const [hover, setHover] = useState<{
    day: number;
    rect: DOMRect;
  } | null>(null);

  useEffect(() => {
    setHover(null);
  }, [month, year]);

  const daysByNumber = new Map<number, CalendarDayData>();
  days.forEach((d) => daysByNumber.set(d.day, d));
  const hoverData = hover ? daysByNumber.get(hover.day) : undefined;

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
            const groups = data?.groups ?? [];
            const hasItems = chips.length > 0 || groups.length > 0;

            return (
              <button
                key={`${cell.outside ? "o" : "d"}-${index}`}
                type="button"
                className={[
                  "calendar-cell",
                  cell.outside ? "is-outside" : "",
                  data?.isToday ? "is-today" : "",
                  hasItems ? "has-items" : "",
                  clickable ? "is-clickable" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={
                  {
                    animationDelay: `${70 + index * 10}ms`,
                    "--intensity": data?.intensity ?? 0,
                  } as CSSProperties
                }
                onMouseEnter={(e) => {
                  if (data && groups.length > 0) {
                    onDayHover?.(cell.day);
                    setHover({
                      day: cell.day,
                      rect: e.currentTarget.getBoundingClientRect(),
                    });
                  }
                }}
                onMouseLeave={() => setHover(null)}
                onFocus={(e) => {
                  if (data && groups.length > 0) {
                    onDayHover?.(cell.day);
                    setHover({
                      day: cell.day,
                      rect: e.currentTarget.getBoundingClientRect(),
                    });
                  }
                }}
                onBlur={() => setHover(null)}
                onClick={() => clickable && onDayClick?.(cell.day)}
                disabled={!clickable}
              >
                <span className="calendar-cell-topline">
                  <span
                    className="calendar-cell-daynum"
                    data-weekday-short={weekdayLabel}
                  >
                    {cell.day}
                  </span>
                  {!!data?.participants?.length && (
                    <span
                      className="calendar-cell-participants"
                      aria-label={`${data.participantCount ?? data.participants.length} участников`}
                    >
                      {data.participants.slice(0, 3).map((participant) => (
                        <span
                          key={participant.id}
                          className="calendar-cell-participant"
                          title={participant.displayName}
                        >
                          {participant.avatarUrl ? (
                            <img
                              src={participant.avatarUrl}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            participant.displayName.slice(0, 1).toUpperCase()
                          )}
                        </span>
                      ))}
                      {(data.participantCount ?? data.participants.length) >
                        3 && (
                        <span className="calendar-cell-participant-more">
                          +
                          {(data.participantCount ?? data.participants.length) -
                            3}
                        </span>
                      )}
                    </span>
                  )}
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
                {groups.length > 0 && (
                  <span className="calendar-cell-groups">
                    {groups.map((g) => (
                      <span
                        key={g.id}
                        className={`calendar-group tone-${g.tone}`}
                      >
                        <i className="calendar-group-mark" />
                        <b>{g.count}</b>
                        <span className="calendar-group-label">{g.label}</span>
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!isLoading && days.some((day) => day.intensity !== undefined) && (
        <div
          className="calendar-intensity-legend"
          aria-label="Цвет дня показывает общее количество постов и постишек"
        >
          <span className="calendar-intensity-title">
            Посты + постишки за день
          </span>
          <div className="calendar-intensity-scale">
            <span>Меньше</span>
            <div className="calendar-intensity-swatches" aria-hidden="true">
              {[0, 0.25, 0.5, 0.75, 1].map((level) => (
                <i
                  key={level}
                  className="calendar-intensity-swatch"
                  style={{ "--intensity": level } as CSSProperties}
                />
              ))}
            </div>
            <span>Больше</span>
          </div>
        </div>
      )}

      {hover &&
        hoverData &&
        createPortal(
          <div
            className="calendar-popover"
            style={popoverStyle(hover.rect)}
            role="tooltip"
          >
            <div className="calendar-popover-heading">
              <div className="calendar-popover-title">
                {new Date(year, month - 1, hoverData.day).toLocaleDateString(
                  "ru-RU",
                  {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  },
                )}
              </div>
              <div className="calendar-popover-meta">
                {hoverData.participantCount ?? 0}{" "}
                {russianCount(hoverData.participantCount ?? 0, [
                  "участник",
                  "участника",
                  "участников",
                ])}
                <span aria-hidden="true">·</span>
                {(() => {
                  const total = (hoverData.groups ?? []).reduce(
                    (sum, group) => sum + group.count,
                    0,
                  );
                  return `${total} ${russianCount(total, [
                    "публикация",
                    "публикации",
                    "публикаций",
                  ])}`;
                })()}
              </div>
            </div>
            {(() => {
              const groups = hoverData.groups ?? [];
              const max = Math.max(...groups.map((g) => g.count), 1);
              return groups.map((g) => {
                const shown = g.preview?.slice(0, 3) ?? [];
                const rest = Math.max(0, g.count - shown.length);
                return (
                  <section
                    key={g.id}
                    className={`calendar-popover-group tone-${g.tone}`}
                  >
                    <header>
                      <i className="calendar-group-mark" />
                      <span>{g.label}</span>
                      <b>{g.count}</b>
                    </header>
                    <div className="calendar-popover-bar">
                      <span style={{ width: `${(g.count / max) * 100}%` }} />
                    </div>
                    {g.previewLoading ? (
                      <p className="calendar-popover-state">
                        Загружаю последние записи…
                      </p>
                    ) : g.previewError ? (
                      <p className="calendar-popover-state is-error">
                        {g.previewError}
                      </p>
                    ) : shown.length > 0 ? (
                      <ul>
                        {shown.map((item, i) => (
                          <li key={`${item.author}-${i}`}>
                            {item.imageUrl && (
                              <img
                                className="calendar-popover-image"
                                src={item.imageUrl}
                                alt=""
                                loading="lazy"
                              />
                            )}
                            <div className="calendar-popover-post">
                              <strong title={item.title}>{item.title}</strong>
                              <small
                                title={item.author}
                                aria-label={item.author}
                              >
                                {item.avatarUrl ? (
                                  <img
                                    className="calendar-popover-avatar"
                                    src={item.avatarUrl}
                                    alt=""
                                    loading="lazy"
                                  />
                                ) : (
                                  <span
                                    className="calendar-popover-avatar is-empty"
                                    aria-hidden="true"
                                  >
                                    {item.author.slice(0, 1).toUpperCase()}
                                  </span>
                                )}
                              </small>
                            </div>
                          </li>
                        ))}
                        {rest > 0 && <li className="more">ещё {rest}</li>}
                      </ul>
                    ) : g.emptyMessage ? (
                      <p className="calendar-popover-state">{g.emptyMessage}</p>
                    ) : null}
                  </section>
                );
              });
            })()}
            <div className="calendar-popover-hint">
              Нажмите на день, чтобы открыть архив
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
