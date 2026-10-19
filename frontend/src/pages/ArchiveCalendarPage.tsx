import { useCallback, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import * as archiveApi from "../api/archive";
import { Calendar } from "../components/calendar/calendar.tsx";
import type {
  CalendarDayData,
  CalendarGroupPreview,
} from "../components/calendar/calendar.tsx";
import { useToast } from "../components/ui/useToast";
import { getImagePreviewUrl, getBrowserFileUrl } from "../utils/fileUrl";
import "../styles/pages/archive-calendar.css";

interface DayPreviewState {
  posts: CalendarGroupPreview[];
  isLoading: boolean;
  error?: string;
}

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
  const [dayPreviews, setDayPreviews] = useState<
    Record<string, DayPreviewState>
  >({});
  const dayPreviewCache = useRef(new Map<string, DayPreviewState>());
  const dayPreviewRequests = useRef(new Set<string>());
  const { notify } = useToast();
  const navigate = useNavigate();

  const loadCalendar = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await archiveApi.getArchiveCalendar(year, month);
      setCalendar(data);
    } catch (err) {
      console.error("Error loading calendar:", err);
      notify("error", "Не удалось загрузить календарь архива");
    } finally {
      setIsLoading(false);
    }
  }, [year, month, notify]);

  const loadDayPreview = useCallback(
    async (day: number) => {
      const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (dayPreviewRequests.current.has(key)) return;

      const cached = dayPreviewCache.current.get(key);
      if (cached && !cached.error) return;

      const loadingState: DayPreviewState = {
        posts: [],
        isLoading: true,
      };
      dayPreviewCache.current.set(key, loadingState);
      setDayPreviews((current) => ({ ...current, [key]: loadingState }));
      dayPreviewRequests.current.add(key);

      try {
        const detail = await archiveApi.getArchiveDay(year, month, day, 1, 3);
        const posts = detail.posts.slice(0, 3).map((post) => {
          const text = post.isArticle
            ? post.title?.trim() ||
              post.blocks.find((block) => block.type === "text")?.text?.trim()
            : post.text?.trim();
          const title =
            text?.replace(/\s+/g, " ") ||
            (post.files.length > 0
              ? "Публикация с вложением"
              : "Публикация без текста");

          return {
            title: title.length > 96 ? `${title.slice(0, 93)}…` : title,
            author: post.author.displayName,
            avatarUrl: post.author.avatarUrl
              ? getBrowserFileUrl(post.author.avatarUrl)
              : null,
            imageUrl: (() => {
              const image = post.files.find((file) =>
                file.contentType.startsWith("image/"),
              );
              return image?.previewUrl
                ? getImagePreviewUrl(image.previewUrl, 360)
                : undefined;
            })(),
          };
        });
        const previewState = { posts, isLoading: false };
        dayPreviewCache.current.set(key, previewState);
        setDayPreviews((current) => ({ ...current, [key]: previewState }));
      } catch (err) {
        console.error("Error loading archive day preview:", err);
        const previewState: DayPreviewState = {
          posts: [],
          isLoading: false,
          error: "Не удалось загрузить превью",
        };
        dayPreviewCache.current.set(key, previewState);
        setDayPreviews((current) => ({ ...current, [key]: previewState }));
      } finally {
        dayPreviewRequests.current.delete(key);
      }
    },
    [month, year],
  );

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

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

  const maxPerDay = Math.max(
    1,
    ...(calendar?.days.map((d) => d.postCount + d.postishkaCount) ?? [0]),
  );

  const days: CalendarDayData[] = Array.from(
    { length: new Date(year, month, 0).getDate() },
    (_, i) => {
      const dayNum = i + 1;
      const archiveDay = archiveDaysByDate.get(dayNum);
      const previewKey = `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      const preview = dayPreviews[previewKey];

      return {
        day: dayNum,
        isToday: isCurrentMonth && today.getDate() === dayNum,
        isClickable: !!archiveDay,
        participantCount: archiveDay?.participantCount,
        participants: archiveDay?.participants.map((participant) => ({
          ...participant,
          avatarUrl: participant.avatarUrl
            ? getBrowserFileUrl(participant.avatarUrl)
            : null,
        })),
        intensity: archiveDay
          ? (archiveDay.postCount + archiveDay.postishkaCount) / maxPerDay
          : 0,
        groups: archiveDay
          ? [
              {
                id: "feed",
                tone: "feed" as const,
                label: "Лента",
                count: archiveDay.postCount,
                preview: preview?.posts,
                previewLoading: preview?.isLoading,
                previewError: preview?.error,
              },
              {
                id: "posts",
                tone: "posts" as const,
                label: "Постишки",
                count: archiveDay.postishkaCount,
                emptyMessage: "Доступна только статистика дня",
              },
            ].filter((g) => g.count > 0)
          : undefined,
      };
    },
  );

  const totalPosts =
    calendar?.days.reduce((sum, d) => sum + d.postCount, 0) ?? 0;

  return (
    <div className="archive-calendar-page">
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
          onDayHover={(day) => {
            if ((archiveDaysByDate.get(day)?.postCount ?? 0) > 0) {
              void loadDayPreview(day);
            }
          }}
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
