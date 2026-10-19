import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { AvatarMedia } from "../components/ui/AvatarMedia";
import "../styles/pages/admin.css";
import * as adminApi from "../api/admin";
import type { AdminUser } from "../api/admin";
import type { FeedBanner, FeedPoll, Post } from "../api/types";
import { getBrowserFileUrl } from "../utils/fileUrl";

const GB = 1024 * 1024 * 1024;
const QUOTA_PRESETS = [1, 2, 5, 10];

const POLL_MAX_OPTIONS = 30;
const POLL_DURATIONS = [
  { label: "1 ч", hours: 1 },
  { label: "6 ч", hours: 6 },
  { label: "24 ч", hours: 24 },
  { label: "3 дня", hours: 72 },
  { label: "7 дней", hours: 168 },
];
const BAN_DURATIONS = [
  { value: "1", label: "1 час" },
  { value: "24", label: "24 часа" },
  { value: "168", label: "7 дней" },
  { value: "720", label: "30 дней" },
  { value: "custom", label: "Свой срок" },
  { value: "permanent", label: "Бессрочно" },
];

type PostFilter = "all" | "on" | "off";

const POST_FILTERS: { id: PostFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "on", label: "На главной" },
  { id: "off", label: "Не выбраны" },
];

const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|avif)$/i;

function postThumbUrl(post: Post) {
  const file = post.files.find((item) => IMAGE_FILE_RE.test(item.fileName));
  return file ? getBrowserFileUrl(file.downloadUrl) : null;
}

function postLabel(post: Post) {
  return post.title?.trim() || post.text?.trim() || "Без названия";
}

function endDateIn(hours: number) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function defaultPollEndDate() {
  return endDateIn(24);
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatGb(bytes: number | null | undefined) {
  if (!bytes) return "0";
  return (bytes / GB).toFixed(2).replace(/\.?0+$/, "");
}

function userQuota(user: AdminUser) {
  return user.storageQuotaBytes ?? user.effectiveStorageQuotaBytes ?? 0;
}

function usageTone(used: number, quota: number) {
  if (!quota) return "";
  const ratio = used / quota;
  if (ratio >= 0.95) return "is-danger";
  if (ratio >= 0.8) return "is-warn";
  return "";
}

function formatLastSeen(user: AdminUser) {
  if (user.isOnline) return "Онлайн";
  if (!user.lastSeenAt) return "Не в сети";
  return `Был ${new Date(user.lastSeenAt).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  })}`;
}

const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const CopyIcon = () => (
  <svg {...iconProps}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.8" />
    <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
  </svg>
);
const TrashIcon = () => (
  <svg {...iconProps}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8" />
  </svg>
);
const EditIcon = () => (
  <svg {...iconProps}>
    <path d="M10.5 3 13 5.5 5.5 13H3v-2.5L10.5 3Z" />
  </svg>
);
const KeyIcon = () => (
  <svg {...iconProps}>
    <circle cx="5.5" cy="10.5" r="2.5" />
    <path d="M7.3 8.7 13 3m-2 2 1.5 1.5" />
  </svg>
);
const PlusIcon = () => (
  <svg {...iconProps}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);
const CheckIcon = () => (
  <svg {...iconProps} strokeWidth={2}>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);
const CloseIcon = () => (
  <svg {...iconProps}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);

function SwitchRow({
  checked,
  onChange,
  title,
  text,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  text: string;
}) {
  return (
    <label className={`admin-switch ${checked ? "is-on" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="admin-switch__track" aria-hidden="true" />
      <span className="admin-switch__text">
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
    </label>
  );
}

type ToastItem = { id: number; kind: "success" | "error"; message: string };

function Toasts({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-region" aria-live="polite">
      {items.map((item) => (
        <div className={`toast toast--${item.kind}`} key={item.id}>
          <span className="toast__icon" />
          <span className="toast__message">{item.message}</span>
          <button
            className="toast__dismiss"
            onClick={() => onDismiss(item.id)}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

type ConfirmState = {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
} | null;

function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!state) return;
    document.documentElement.classList.add("alert-dialog-open");
    document.body.classList.add("alert-dialog-open");
    return () => {
      document.documentElement.classList.remove("alert-dialog-open");
      document.body.classList.remove("alert-dialog-open");
    };
  }, [state]);

  if (!state) return null;
  return (
    <div className="alert-dialog-backdrop" onClick={onClose}>
      <div
        className="alert-dialog"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{state.title}</h2>
        <p>{state.text}</p>
        <div className="alert-dialog__actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn alert-dialog__confirm"
            onClick={() => {
              state.onConfirm();
              onClose();
            }}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="admin-card">
      {(title || actions) && (
        <div className="admin-card__head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

function UsageBar({ used, quota }: { used: number; quota: number }) {
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
  return (
    <div className="usage">
      <div className="usage-bar">
        <div
          className={`usage-bar__fill ${usageTone(used, quota)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="label">
        {formatBytes(used)} из {formatBytes(quota)}
      </span>
    </div>
  );
}

function QuotaEditor({
  currentGb,
  onSave,
}: {
  currentGb: string;
  onSave: (gb: string) => Promise<boolean> | void;
}) {
  const [draft, setDraft] = useState(currentGb);
  const dirty = draft !== currentGb;
  const valid = Number(draft) > 0;

  return (
    <div className="admin-quota">
      <div className="admin-quota__input">
        <input
          className="input admin-input--sm"
          type="number"
          min="0.1"
          step="0.5"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty && valid) void onSave(draft);
            if (e.key === "Escape") setDraft(currentGb);
          }}
        />
        <span className="label">ГБ</span>
        {dirty && (
          <>
            <button
              className="btn btn-primary btn-sm"
              disabled={!valid}
              onClick={() => void onSave(draft)}
            >
              Сохранить
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setDraft(currentGb)}
            >
              Отмена
            </button>
          </>
        )}
      </div>
      <div className="admin-presets">
        {QUOTA_PRESETS.map((preset) => (
          <button
            key={preset}
            className={`btn btn-segment ${Number(currentGb) === preset ? "is-active" : ""}`}
            onClick={() => void onSave(String(preset))}
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}

type Tab = "storage" | "banners" | "users" | "invites";

const TABS: { id: Tab; label: string }[] = [
  { id: "storage", label: "Хранилище" },
  { id: "banners", label: "Главная" },
  { id: "users", label: "Пользователи" },
  { id: "invites", label: "Инвайты" },
];

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("storage");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [codes, setCodes] = useState<adminApi.AdminInviteCode[]>([]);
  const [banners, setBanners] = useState<FeedBanner[]>([]);
  const [polls, setPolls] = useState<FeedPoll[]>([]);
  const [postishki, setPostishki] = useState<Post[]>([]);
  const [storageSummary, setStorageSummary] =
    useState<adminApi.AdminStorageSummary | null>(null);

  const [totalQuotaGb, setTotalQuotaGb] = useState("25");
  const [defaultUserQuotaGb, setDefaultUserQuotaGb] = useState("1");
  const [savingStorage, setSavingStorage] = useState(false);

  const [storageQuery, setStorageQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [postQuery, setPostQuery] = useState("");
  const [postFilter, setPostFilter] = useState<PostFilter>("all");
  const [togglingPostIds, setTogglingPostIds] = useState<string[]>([]);
  const pollOptionsRef = useRef<HTMLDivElement>(null);
  const focusNewPollOption = useRef(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollEndsAt, setPollEndsAt] = useState(defaultPollEndDate);
  const [pollIsAnonymous, setPollIsAnonymous] = useState(false);
  const [pollAllowUserOptions, setPollAllowUserOptions] = useState(false);
  const [pollAllowMultipleChoices, setPollAllowMultipleChoices] =
    useState(false);
  const [savingPoll, setSavingPoll] = useState(false);

  const [hours, setHours] = useState("24");
  const [inviteName, setInviteName] = useState("");
  const [invite, setInvite] = useState<adminApi.AdminInviteCode | null>(null);
  const [inviteImageFile, setInviteImageFile] = useState<File | null>(null);
  const [inviteImageUploading, setInviteImageUploading] = useState(false);

  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [resettingPasswordUserId, setResettingPasswordUserId] = useState<
    string | null
  >(null);
  const [generatedPasswords, setGeneratedPasswords] = useState<
    Record<string, string>
  >({});
  const [banPanelUserId, setBanPanelUserId] = useState<string | null>(null);
  const [banDuration, setBanDuration] = useState("24");
  const [customBanHours, setCustomBanHours] = useState("24");
  const [banReason, setBanReason] = useState("");
  const [savingBanUserId, setSavingBanUserId] = useState<string | null>(null);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const notify = useCallback((kind: ToastItem["kind"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, kind, message }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((t) => t.id !== id)),
      3500,
    );
  }, []);

  async function load() {
    try {
      setLoadError(false);
      const [u, c, b, p, s, pollData] = await Promise.all([
        adminApi.getUsers(),
        adminApi.getInviteCodes(),
        adminApi.getBanners(),
        adminApi.getPostishki(),
        adminApi.getStorageSummary(),
        adminApi.getPolls(),
      ]);
      setUsers(u);
      setCodes(c);
      setBanners(b);
      setPolls(pollData);
      setPostishki(p);
      setStorageSummary(s);
      setTotalQuotaGb(formatGb(s.totalQuotaBytes));
      setDefaultUserQuotaGb(formatGb(s.defaultUserQuotaBytes));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function copyText(text: string, okMessage = "Скопировано") {
    try {
      await navigator.clipboard.writeText(text);
      notify("success", okMessage);
    } catch {
      notify("error", "Не удалось скопировать");
    }
  }

  const allocatedBytes = useMemo(
    () => users.reduce((sum, user) => sum + userQuota(user), 0),
    [users],
  );
  const totalBytes = storageSummary?.totalQuotaBytes ?? 0;
  const usedBytes = storageSummary?.usedBytes ?? 0;
  const freeToAllocate = totalBytes - allocatedBytes;
  const overcommitted = freeToAllocate < 0;

  const storageDirty =
    !!storageSummary &&
    (totalQuotaGb !== formatGb(storageSummary.totalQuotaBytes) ||
      defaultUserQuotaGb !== formatGb(storageSummary.defaultUserQuotaBytes));

  async function saveStorageSettings() {
    const total = Number(totalQuotaGb);
    const def = Number(defaultUserQuotaGb);
    if (!(total > 0) || !(def > 0)) {
      notify("error", "Лимиты должны быть больше нуля");
      return;
    }
    try {
      setSavingStorage(true);
      const summary = await adminApi.updateStorageSettings(
        Math.round(total * GB),
        Math.round(def * GB),
      );
      setStorageSummary(summary);
      notify("success", "Лимиты сохранены");
    } catch {
      notify("error", "Не удалось сохранить лимиты хранилища");
    } finally {
      setSavingStorage(false);
    }
  }

  async function updateUserQuota(id: string, quotaGb: string) {
    const nextValue = Number(quotaGb);
    if (!Number.isFinite(nextValue) || nextValue <= 0) return false;
    try {
      const updated = await adminApi.updateUserStorageQuota(
        id,
        Math.round(nextValue * GB),
      );
      setUsers((current) =>
        current.map((user) =>
          user.id === id
            ? {
                ...user,
                storageQuotaBytes: updated.quotaBytes,
                effectiveStorageQuotaBytes:
                  updated.quotaBytes ?? user.effectiveStorageQuotaBytes,
              }
            : user,
        ),
      );
      notify("success", "Квота обновлена");
      return true;
    } catch {
      notify("error", "Не удалось обновить квоту пользователя");
      return false;
    }
  }

  async function updateRole(id: string, role: string) {
    try {
      await adminApi.changeRole(id, role);
      setUsers((current) =>
        current.map((user) =>
          user.id === id
            ? { ...user, roles: role === "User" ? [] : [role] }
            : user,
        ),
      );
      notify("success", "Роль изменена");
    } catch {
      notify("error", "Не удалось изменить роль");
    }
  }

  function toggleUserPanel(user: AdminUser) {
    if (expandedUserId === user.id) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(user.id);
    setEditEmail(user.email);
    setEditDisplayName(user.displayName);
  }

  async function saveUserProfile(id: string) {
    try {
      setSavingUserId(id);
      const updated = await adminApi.updateUserProfile(
        id,
        editEmail.trim(),
        editDisplayName.trim(),
      );
      setUsers((current) =>
        current.map((user) =>
          user.id === id
            ? {
                ...user,
                email: updated.email,
                displayName: updated.displayName,
              }
            : user,
        ),
      );
      setExpandedUserId(null);
      notify("success", "Профиль обновлён");
    } catch {
      notify("error", "Не удалось изменить email или ник");
    } finally {
      setSavingUserId(null);
    }
  }

  async function generateUserPassword(id: string) {
    try {
      setGeneratedPasswords((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setResettingPasswordUserId(id);
      const password = await adminApi.generateUserPassword(id);
      setGeneratedPasswords((current) => ({ ...current, [id]: password }));
    } catch {
      notify("error", "Не удалось сгенерировать пароль");
    } finally {
      setResettingPasswordUserId(null);
    }
  }

  function openBanPanel(userId: string) {
    setBanPanelUserId(userId);
    setBanDuration("24");
    setCustomBanHours("24");
    setBanReason("");
  }

  async function banUser(user: AdminUser) {
    const reason = banReason.trim();
    if (!reason) {
      notify("error", "Укажи причину блокировки");
      return;
    }

    const durationHours =
      banDuration === "permanent"
        ? null
        : Number(banDuration === "custom" ? customBanHours : banDuration);
    if (
      durationHours !== null &&
      (!Number.isFinite(durationHours) ||
        durationHours < 0.1 ||
        durationHours > 24 * 365)
    ) {
      notify("error", "Срок должен быть от 0,1 до 8760 часов");
      return;
    }

    try {
      setSavingBanUserId(user.id);
      const status = await adminApi.banUser(user.id, durationHours, reason);
      setUsers((current) =>
        current.map((item) =>
          item.id === user.id ? { ...item, ...status } : item,
        ),
      );
      setBanPanelUserId(null);
      notify("success", "Пользователь заблокирован");
    } catch {
      notify("error", "Не удалось заблокировать пользователя");
    } finally {
      setSavingBanUserId(null);
    }
  }

  async function unbanUser(user: AdminUser) {
    try {
      setSavingBanUserId(user.id);
      const status = await adminApi.unbanUser(user.id);
      setUsers((current) =>
        current.map((item) =>
          item.id === user.id ? { ...item, ...status } : item,
        ),
      );
      notify("success", "Блокировка снята");
    } catch {
      notify("error", "Не удалось снять блокировку");
    } finally {
      setSavingBanUserId(null);
    }
  }

  function askGeneratePassword(user: AdminUser) {
    setConfirm({
      title: "Сгенерировать новый пароль?",
      text: `Текущий пароль ${user.displayName} перестанет работать. Новый пароль будет показан один раз.`,
      confirmLabel: "Сгенерировать",
      onConfirm: () => void generateUserPassword(user.id),
    });
  }

  const bannerByPostId = useMemo(
    () => new Map(banners.map((banner) => [banner.postId, banner])),
    [banners],
  );

  const orphanBanners = useMemo(
    () =>
      banners.filter(
        (banner) => !postishki.some((post) => post.id === banner.postId),
      ),
    [banners, postishki],
  );

  const postCounts = useMemo(() => {
    const on = postishki.filter((post) => bannerByPostId.has(post.id)).length;
    return { all: postishki.length, on, off: postishki.length - on };
  }, [postishki, bannerByPostId]);

  const visiblePosts = useMemo(() => {
    const q = postQuery.trim().toLowerCase();
    return postishki.filter((post) => {
      const isOn = bannerByPostId.has(post.id);
      if (postFilter === "on" && !isOn) return false;
      if (postFilter === "off" && isOn) return false;
      if (!q) return true;
      return [post.title, post.text, post.author.displayName].some((value) =>
        (value || "").toLowerCase().includes(q),
      );
    });
  }, [postishki, bannerByPostId, postQuery, postFilter]);

  async function addBanner(postId: string) {
    try {
      const banner = await adminApi.addBanner(postId);
      setBanners((current) => [...current, banner]);
      notify("success", "Постишка добавлена на главную");
    } catch {
      notify("error", "Не удалось добавить баннер");
    }
  }

  async function removeBanner(id: string) {
    try {
      await adminApi.deleteBanner(id);
      setBanners((current) => current.filter((banner) => banner.id !== id));
      notify("success", "Баннер убран");
    } catch {
      notify("error", "Не удалось удалить баннер");
    }
  }

  async function togglePostBanner(post: Post) {
    if (togglingPostIds.includes(post.id)) return;
    setTogglingPostIds((current) => [...current, post.id]);
    try {
      const banner = bannerByPostId.get(post.id);
      if (banner) await removeBanner(banner.id);
      else await addBanner(post.id);
    } finally {
      setTogglingPostIds((current) => current.filter((id) => id !== post.id));
    }
  }

  useEffect(() => {
    if (!focusNewPollOption.current) return;
    focusNewPollOption.current = false;
    const inputs = pollOptionsRef.current?.querySelectorAll("input");
    inputs?.[inputs.length - 1]?.focus();
  }, [pollOptions.length]);

  function addPollOption() {
    if (pollOptions.length >= POLL_MAX_OPTIONS) return;
    focusNewPollOption.current = true;
    setPollOptions((current) => [...current, ""]);
  }

  function updatePollOption(index: number, value: string) {
    setPollOptions((current) =>
      current.map((option, i) => (i === index ? value : option)),
    );
  }

  function removePollOption(index: number) {
    setPollOptions((current) =>
      current.length <= 2 ? current : current.filter((_, i) => i !== index),
    );
  }

  function pastePollOptions(
    index: number,
    event: ClipboardEvent<HTMLInputElement>,
  ) {
    const text = event.clipboardData.getData("text");
    if (!text.includes("\n")) return;
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim().slice(0, 120))
      .filter(Boolean);
    if (!lines.length) return;
    event.preventDefault();
    setPollOptions((current) => {
      const next = [...current];
      const keep = current[index]?.trim() ? [current[index], ...lines] : lines;
      next.splice(index, 1, ...keep);
      return next.slice(0, POLL_MAX_OPTIONS);
    });
  }

  async function createFeedPoll() {
    const options = pollOptions.map((option) => option.trim()).filter(Boolean);
    if (!pollQuestion.trim()) {
      notify("error", "Укажи вопрос голосования");
      return;
    }
    if (options.length < 2 || options.length > POLL_MAX_OPTIONS) {
      notify("error", "Добавь от 2 до 30 вариантов");
      return;
    }
    if (
      new Set(options.map((option) => option.toLocaleLowerCase())).size !==
      options.length
    ) {
      notify("error", "Варианты не должны повторяться");
      return;
    }
    if (!pollEndsAt || new Date(pollEndsAt).getTime() <= Date.now()) {
      notify("error", "Укажи дату завершения в будущем");
      return;
    }

    try {
      setSavingPoll(true);
      const poll = await adminApi.createPoll({
        question: pollQuestion.trim(),
        options,
        endsAt: new Date(pollEndsAt).toISOString(),
        isAnonymous: pollIsAnonymous,
        allowUserOptions: pollAllowUserOptions,
        allowMultipleChoices: pollAllowMultipleChoices,
      });
      setPolls((current) => [poll, ...current]);
      setPollQuestion("");
      setPollOptions(["", ""]);
      setPollEndsAt(defaultPollEndDate());
      notify("success", "Голосование добавлено в сайдбар");
    } catch {
      notify("error", "Не удалось создать голосование");
    } finally {
      setSavingPoll(false);
    }
  }

  async function removePoll(id: string) {
    try {
      await adminApi.deletePoll(id);
      setPolls((current) => current.filter((poll) => poll.id !== id));
      notify("success", "Голосование удалено");
    } catch {
      notify("error", "Не удалось удалить голосование");
    }
  }

  async function generateCode() {
    if (!inviteName.trim()) {
      notify("error", "Укажи имя для инвайта");
      return;
    }
    try {
      const created = await adminApi.createInviteCode(
        inviteName.trim(),
        hours ? Number(hours) : null,
      );
      setInvite(created);
      setInviteName("");
      setInviteImageFile(null);
      setCodes((current) => [created, ...current]);
      notify("success", "Инвайт создан");
    } catch {
      notify("error", "Не удалось создать инвайт-код");
    }
  }

  async function uploadInvitePhoto() {
    if (!invite || !inviteImageFile) return;
    try {
      setInviteImageUploading(true);
      const imageUrl = await adminApi.uploadInviteImage(
        invite.id,
        inviteImageFile,
      );
      const patched = { ...invite, imageUrl };
      setInvite(patched);
      setCodes((current) =>
        current.map((code) => (code.id === invite.id ? patched : code)),
      );
      setInviteImageFile(null);
      notify("success", "Фото загружено");
    } catch {
      notify("error", "Не удалось загрузить фото");
    } finally {
      setInviteImageUploading(false);
    }
  }

  async function deleteCode(id: string) {
    try {
      await adminApi.deleteInviteCode(id);
      setCodes((current) => current.filter((item) => item.id !== id));
      if (invite?.id === id) setInvite(null);
    } catch {
      notify("error", "Не удалось удалить инвайт");
    }
  }

  function codeStatus(code: adminApi.AdminInviteCode) {
    if (code.usedAt) return { label: "Использован", active: false };
    if (code.expiresAt && new Date(code.expiresAt) < new Date())
      return { label: "Истёк", active: false };
    return { label: "Активен", active: true };
  }

  const storageUsers = useMemo(() => {
    const q = storageQuery.trim().toLowerCase();
    return users
      .filter(
        (u) =>
          !q ||
          u.displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      )
      .sort((a, b) => b.storageUsedBytes - a.storageUsedBytes);
  }, [users, storageQuery]);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    return users.filter(
      (u) =>
        !q ||
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
    );
  }, [users, userQuery]);

  const capacityUsedPct = totalBytes
    ? Math.min(100, (usedBytes / totalBytes) * 100)
    : 0;
  const capacityAllocPct = totalBytes
    ? Math.min(100, (allocatedBytes / totalBytes) * 100)
    : 0;

  return (
    <div className="admin-page">
      <header className="admin-header">
        <nav className="admin-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={`btn btn-segment ${tab === item.id ? "is-active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {loading && (
        <div className="admin-center">
          <span className="spinner" />
        </div>
      )}

      {!loading && loadError && (
        <Card>
          <div className="admin-empty">
            <p>Не удалось загрузить админские данные</p>
            <button className="btn btn-secondary" onClick={() => void load()}>
              Повторить
            </button>
          </div>
        </Card>
      )}

      {!loading && !loadError && tab === "storage" && (
        <>
          <Card
            title="Хранилище"
            description={
              storageSummary
                ? `Последний замер: ${new Date(storageSummary.measuredAt).toLocaleString("ru-RU")}`
                : undefined
            }
          >
            <div className="admin-stats">
              <div className="admin-stat">
                <span className="label">Занято</span>
                <strong>{formatBytes(usedBytes)}</strong>
              </div>
              <div className="admin-stat">
                <span className="label">Лимит сервера</span>
                <strong>{formatBytes(totalBytes)}</strong>
              </div>
              <div className="admin-stat">
                <span className="label">Роздано пользователям</span>
                <strong>{formatBytes(allocatedBytes)}</strong>
              </div>
              <div className={`admin-stat ${overcommitted ? "is-danger" : ""}`}>
                <span className="label">
                  {overcommitted ? "Перебор по квотам" : "Свободно для раздачи"}
                </span>
                <strong>{formatBytes(Math.abs(freeToAllocate))}</strong>
              </div>
            </div>

            <div
              className="admin-capacity"
              data-tooltip="Занято / роздано / лимит"
              data-tooltip-align="start"
            >
              <div
                className="admin-capacity__alloc"
                style={{ width: `${capacityAllocPct}%` }}
              />
              <div
                className="admin-capacity__used"
                style={{ width: `${capacityUsedPct}%` }}
              />
            </div>
            <div className="admin-legend">
              <span>
                <i className="is-used" /> занято
              </span>
              <span>
                <i className="is-alloc" /> роздано квотами
              </span>
              {overcommitted && (
                <span className="admin-badge-danger badge">
                  Сумма квот больше лимита сервера
                </span>
              )}
            </div>
          </Card>

          <Card
            title="Лимиты"
            description="Общий объём и квота, которая выдаётся новым пользователям."
          >
            <div className="admin-settings">
              <div>
                <label className="label-field">Общий лимит, ГБ</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  step="0.5"
                  value={totalQuotaGb}
                  onChange={(e) => setTotalQuotaGb(e.target.value)}
                />
              </div>
              <div>
                <label className="label-field">
                  По умолчанию на человека, ГБ
                </label>
                <input
                  className="input"
                  type="number"
                  min="0.1"
                  step="0.5"
                  value={defaultUserQuotaGb}
                  onChange={(e) => setDefaultUserQuotaGb(e.target.value)}
                />
              </div>
              <button
                className="btn btn-primary"
                disabled={!storageDirty || savingStorage}
                onClick={() => void saveStorageSettings()}
              >
                {savingStorage ? "Сохраняю..." : "Сохранить"}
              </button>
            </div>
          </Card>

          <Card
            title="Квоты пользователей"
            description="Отсортировано по занятому месту. Enter — сохранить, Esc — отмена."
            actions={
              <input
                className="input admin-search"
                placeholder="Поиск по нику или email"
                value={storageQuery}
                onChange={(e) => setStorageQuery(e.target.value)}
              />
            }
          >
            <div className="admin-list">
              {storageUsers.map((user) => {
                const quota = userQuota(user);
                return (
                  <div className="admin-row admin-row--quota" key={user.id}>
                    <Link
                      className="admin-person"
                      to={`/profile/${encodeURIComponent(user.displayName)}`}
                    >
                      {user.avatarUrl ? (
                        <AvatarMedia
                          className="admin-avatar"
                          src={getBrowserFileUrl(user.avatarUrl)}
                          alt={`Аватар ${user.displayName}`}
                        />
                      ) : (
                        <div
                          className="admin-avatar"
                          style={
                            user.nicknameColor
                              ? { background: user.nicknameColor }
                              : undefined
                          }
                        >
                          {user.displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="admin-person__text">
                        <strong
                          style={
                            user.nicknameColor
                              ? { color: user.nicknameColor }
                              : undefined
                          }
                        >
                          {user.displayName}
                        </strong>
                        <span>{user.email}</span>
                        {user.isBanned && (
                          <span className="admin-ban-label">
                            Заблокирован
                          </span>
                        )}
                      </div>
                    </Link>
                    <UsageBar used={user.storageUsedBytes} quota={quota} />
                    <QuotaEditor
                      key={`${user.id}-${formatGb(quota)}`}
                      currentGb={formatGb(quota)}
                      onSave={(gb) => updateUserQuota(user.id, gb)}
                    />
                  </div>
                );
              })}
              {!storageUsers.length && (
                <p className="admin-empty">Никого не найдено</p>
              )}
            </div>
          </Card>
        </>
      )}

      {!loading && !loadError && tab === "banners" && (
        <>
          <Card
            title="Постишки на главной"
            description={`${postCounts.on} в сайдбаре ленты · нажми на постишку, чтобы добавить или убрать`}
            actions={
              <div className="admin-picker__tools">
                <input
                  className="input admin-search"
                  placeholder="Название, текст или автор"
                  value={postQuery}
                  onChange={(e) => setPostQuery(e.target.value)}
                />
                <div className="admin-filter" role="tablist">
                  {POST_FILTERS.map((item) => (
                    <button
                      key={item.id}
                      role="tab"
                      aria-selected={postFilter === item.id}
                      className={`btn btn-segment ${postFilter === item.id ? "is-active" : ""}`}
                      onClick={() => setPostFilter(item.id)}
                    >
                      {item.label}
                      <span className="admin-filter__count">
                        {postCounts[item.id]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            }
          >
            <div className="admin-picker">
              {postFilter !== "off" &&
                !postQuery.trim() &&
                orphanBanners.map((banner) => (
                  <button
                    type="button"
                    key={banner.id}
                    className="admin-pick is-on"
                    aria-pressed
                    onClick={() => void removeBanner(banner.id)}
                  >
                    <span className="admin-pick__check">
                      <CheckIcon />
                    </span>
                    {banner.imageUrl ? (
                      <img
                        className="admin-thumb"
                        src={getBrowserFileUrl(banner.imageUrl)}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="admin-thumb" />
                    )}
                    <span className="admin-pick__text">
                      <strong>{banner.title || "Без названия"}</strong>
                      <span>Постишка удалена — убрать баннер</span>
                    </span>
                  </button>
                ))}

              {visiblePosts.map((post) => {
                const banner = bannerByPostId.get(post.id);
                const isOn = !!banner;
                const busy = togglingPostIds.includes(post.id);
                const thumb = banner?.imageUrl
                  ? getBrowserFileUrl(banner.imageUrl)
                  : postThumbUrl(post);
                const position = banner
                  ? banners.findIndex((item) => item.id === banner.id) + 1
                  : 0;
                return (
                  <button
                    type="button"
                    key={post.id}
                    className={`admin-pick ${isOn ? "is-on" : ""}`}
                    aria-pressed={isOn}
                    disabled={busy}
                    onClick={() => void togglePostBanner(post)}
                  >
                    <span className="admin-pick__check">
                      {isOn && <CheckIcon />}
                    </span>
                    {thumb ? (
                      <img
                        className="admin-thumb"
                        src={thumb}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="admin-thumb" />
                    )}
                    <span className="admin-pick__text">
                      <strong>{postLabel(post)}</strong>
                      <span>
                        {post.author.displayName} ·{" "}
                        {new Date(post.createdAt).toLocaleDateString("ru-RU")}
                      </span>
                    </span>
                    {isOn && (
                      <span className="admin-pick__pos">№{position}</span>
                    )}
                  </button>
                );
              })}

              {!visiblePosts.length && !orphanBanners.length && (
                <p className="admin-empty admin-picker__empty">
                  Ничего не найдено
                </p>
              )}
            </div>
          </Card>

          <Card
            title="Новое голосование"
            description="Появится в сайдбаре ленты и будет обновляться у всех участников в реальном времени."
          >
            <div className="admin-poll">
              <div className="admin-poll__main">
                <div>
                  <div className="admin-poll__label-row">
                    <label
                      className="label-field"
                      htmlFor="admin-poll-question"
                    >
                      Вопрос
                    </label>
                    <span className="admin-poll__counter">
                      {pollQuestion.length}/200
                    </span>
                  </div>
                  <input
                    id="admin-poll-question"
                    className="input"
                    value={pollQuestion}
                    maxLength={200}
                    placeholder="О чём спросим участников?"
                    onChange={(event) => setPollQuestion(event.target.value)}
                  />
                </div>

                <div>
                  <div className="admin-poll__label-row">
                    <span className="label-field">Варианты ответа</span>
                    <span className="admin-poll__counter">
                      {pollOptions.filter((option) => option.trim()).length}/
                      {POLL_MAX_OPTIONS}
                    </span>
                  </div>
                  <div className="admin-poll-options" ref={pollOptionsRef}>
                    {pollOptions.map((option, index) => (
                      <div className="admin-poll-option" key={index}>
                        <span className="admin-index">{index + 1}</span>
                        <input
                          className="input"
                          value={option}
                          maxLength={120}
                          placeholder={`Вариант ${index + 1}`}
                          aria-label={`Вариант ${index + 1}`}
                          onChange={(event) =>
                            updatePollOption(index, event.target.value)
                          }
                          onPaste={(event) => pastePollOptions(index, event)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            if (index === pollOptions.length - 1) {
                              if (option.trim()) addPollOption();
                            } else {
                              const next =
                                pollOptionsRef.current?.querySelectorAll(
                                  "input",
                                )[index + 1];
                              next?.focus();
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-icon"
                          data-tooltip="Убрать вариант"
                          disabled={pollOptions.length <= 2}
                          onClick={() => removePollOption(index)}
                        >
                          <CloseIcon />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={pollOptions.length >= POLL_MAX_OPTIONS}
                    onClick={addPollOption}
                  >
                    <PlusIcon />
                    Добавить вариант
                  </button>
                </div>
              </div>

              <div className="admin-poll__side">
                <div>
                  <label className="label-field" htmlFor="admin-poll-ends">
                    Голосование завершится
                  </label>
                  <input
                    id="admin-poll-ends"
                    className="input"
                    type="datetime-local"
                    value={pollEndsAt}
                    onChange={(event) => setPollEndsAt(event.target.value)}
                  />
                  <div className="admin-presets admin-poll__presets">
                    {POLL_DURATIONS.map((item) => (
                      <button
                        type="button"
                        key={item.hours}
                        className="btn btn-segment"
                        onClick={() => setPollEndsAt(endDateIn(item.hours))}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="admin-switches">
                  <SwitchRow
                    checked={pollIsAnonymous}
                    onChange={setPollIsAnonymous}
                    title="Анонимное голосование"
                    text="Не показывать, кто за что проголосовал"
                  />
                  <SwitchRow
                    checked={pollAllowMultipleChoices}
                    onChange={setPollAllowMultipleChoices}
                    title="Несколько ответов"
                    text="Участник может отметить сразу несколько вариантов"
                  />
                  <SwitchRow
                    checked={pollAllowUserOptions}
                    onChange={setPollAllowUserOptions}
                    title="Свои варианты"
                    text="Участники смогут предложить новый вариант"
                  />
                </div>

                <button
                  className="btn btn-primary admin-poll__submit"
                  disabled={savingPoll}
                  onClick={() => void createFeedPoll()}
                >
                  {savingPoll ? "Создаю..." : "Создать голосование"}
                </button>
              </div>
            </div>
          </Card>

          <Card
            title="Голосования в сайдбаре"
            description={`${polls.length} всего`}
          >
            <div className="admin-list">
              {polls.map((poll) => (
                <div className="admin-row" key={poll.id}>
                  <div className="admin-person__text admin-grow">
                    <strong>{poll.question}</strong>
                    <span>
                      {poll.options.length} вар. · {poll.totalVotes} голосов
                      {poll.isAnonymous ? " · анонимное" : ""}
                      {poll.allowMultipleChoices ? " · мультивыбор" : ""}
                      {poll.isClosed
                        ? ""
                        : ` · до ${new Date(poll.endsAt).toLocaleString(
                            "ru-RU",
                            { dateStyle: "short", timeStyle: "short" },
                          )}`}
                    </span>
                  </div>
                  <span
                    className={`badge ${poll.isClosed ? "badge-neutral" : "badge-success"}`}
                  >
                    <i className="badge-dot" />
                    {poll.isClosed ? "Завершено" : "Идёт"}
                  </span>
                  <button
                    className="btn btn-icon"
                    data-tooltip="Удалить голосование"
                    onClick={() =>
                      setConfirm({
                        title: "Удалить голосование?",
                        text: `«${poll.question}» исчезнет из сайдбара вместе со всеми голосами.`,
                        confirmLabel: "Удалить",
                        onConfirm: () => void removePoll(poll.id),
                      })
                    }
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
              {!polls.length && (
                <p className="admin-empty">Голосований пока нет</p>
              )}
            </div>
          </Card>
        </>
      )}

      {!loading && !loadError && tab === "users" && (
        <Card
          title="Пользователи"
          description={`${users.length} участников`}
          actions={
            <input
              className="input admin-search"
              placeholder="Поиск по нику или email"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
            />
          }
        >
          <div className="admin-list">
            {filteredUsers.map((user) => {
              const expanded = expandedUserId === user.id;
              const password = generatedPasswords[user.id];
              return (
                <div className="admin-user" key={user.id}>
                  <div className="admin-row admin-row--user">
                    <Link
                      className="admin-person"
                      to={`/profile/${encodeURIComponent(user.displayName)}`}
                    >
                      {user.avatarUrl ? (
                        <AvatarMedia
                          className="admin-avatar"
                          src={getBrowserFileUrl(user.avatarUrl)}
                          alt={`Аватар ${user.displayName}`}
                        />
                      ) : (
                        <div
                          className="admin-avatar"
                          style={
                            user.nicknameColor
                              ? { background: user.nicknameColor }
                              : undefined
                          }
                        >
                          {user.displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="admin-person__text">
                        <strong
                          style={
                            user.nicknameColor
                              ? { color: user.nicknameColor }
                              : undefined
                          }
                        >
                          {user.displayName}
                        </strong>
                        <span>{user.email}</span>
                      </div>
                    </Link>
                    <span
                      className={`badge ${user.isOnline ? "badge-success" : "badge-neutral"}`}
                    >
                      <i className="badge-dot" />
                      {formatLastSeen(user)}
                    </span>
                    <select
                      className="input admin-input--select"
                      value={user.roles[0] ?? "User"}
                      onChange={(e) => void updateRole(user.id, e.target.value)}
                    >
                      <option value="User">User</option>
                      <option value="Admin">Admin</option>
                    </select>
                    <div className="admin-actions">
                      <button
                        className={`btn btn-icon ${expanded ? "is-active" : ""}`}
                        data-tooltip="Ник и email"
                        onClick={() => toggleUserPanel(user)}
                      >
                        <EditIcon />
                      </button>
                      <button
                        className="btn btn-icon"
                        data-tooltip="Новый пароль"
                        disabled={resettingPasswordUserId === user.id}
                        onClick={() => askGeneratePassword(user)}
                      >
                        <KeyIcon />
                      </button>
                      {user.isBanned ? (
                        <button
                          className="btn btn-sm btn-secondary"
                          disabled={savingBanUserId === user.id}
                          onClick={() => void unbanUser(user)}
                        >
                          {savingBanUserId === user.id
                            ? "Снимаю..."
                            : "Разблокировать"}
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() =>
                            banPanelUserId === user.id
                              ? setBanPanelUserId(null)
                              : openBanPanel(user.id)
                          }
                        >
                          {banPanelUserId === user.id
                            ? "Отмена"
                            : "Заблокировать"}
                        </button>
                      )}
                    </div>
                  </div>

                  {user.isBanned && (
                    <div className="admin-ban-status">
                      <strong>
                        {user.banUntil
                          ? `Блокировка до ${new Date(user.banUntil).toLocaleString("ru-RU")}`
                          : "Бессрочная блокировка"}
                      </strong>
                      <span>Причина: {user.banReason}</span>
                    </div>
                  )}

                  {banPanelUserId === user.id && !user.isBanned && (
                    <div className="admin-user-ban">
                      <div>
                        <label className="label-field" htmlFor={`ban-duration-${user.id}`}>
                          Срок блокировки
                        </label>
                        <select
                          id={`ban-duration-${user.id}`}
                          className="input"
                          value={banDuration}
                          onChange={(event) => setBanDuration(event.target.value)}
                        >
                          {BAN_DURATIONS.map((preset) => (
                            <option key={preset.value} value={preset.value}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {banDuration === "custom" && (
                        <div>
                          <label
                            className="label-field"
                            htmlFor={`ban-custom-hours-${user.id}`}
                          >
                            Срок в часах (до 8760)
                          </label>
                          <input
                            id={`ban-custom-hours-${user.id}`}
                            className="input"
                            type="number"
                            min="0.1"
                            max="8760"
                            step="0.1"
                            value={customBanHours}
                            onChange={(event) =>
                              setCustomBanHours(event.target.value)
                            }
                          />
                        </div>
                      )}
                      <div>
                        <label
                          className="label-field"
                          htmlFor={`ban-reason-${user.id}`}
                        >
                          Причина блокировки
                        </label>
                        <textarea
                          id={`ban-reason-${user.id}`}
                          className="input admin-ban-reason"
                          maxLength={1000}
                          rows={3}
                          value={banReason}
                          onChange={(event) => setBanReason(event.target.value)}
                          placeholder="Напиши причину вручную"
                        />
                      </div>
                      <div className="admin-actions">
                        <button
                          className="btn btn-primary"
                          disabled={savingBanUserId === user.id}
                          onClick={() => void banUser(user)}
                        >
                          {savingBanUserId === user.id
                            ? "Блокирую..."
                            : "Подтвердить блокировку"}
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => setBanPanelUserId(null)}
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  )}

                  {expanded && (
                    <div className="admin-user-panel">
                      <div>
                        <label className="label-field">Ник</label>
                        <input
                          className="input"
                          value={editDisplayName}
                          minLength={2}
                          maxLength={50}
                          onChange={(e) => setEditDisplayName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="label-field">Email</label>
                        <input
                          className="input"
                          type="email"
                          value={editEmail}
                          maxLength={256}
                          onChange={(e) => setEditEmail(e.target.value)}
                        />
                      </div>
                      <div className="admin-actions">
                        <button
                          className="btn btn-primary"
                          disabled={savingUserId === user.id}
                          onClick={() => void saveUserProfile(user.id)}
                        >
                          {savingUserId === user.id
                            ? "Сохраняю..."
                            : "Сохранить"}
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => setExpandedUserId(null)}
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  )}

                  {password && (
                    <div className="admin-user-panel admin-user-panel--password">
                      <span className="label">Новый пароль</span>
                      <code>{password}</code>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          void copyText(password, "Пароль скопирован")
                        }
                      >
                        <CopyIcon />
                        Копировать
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {!filteredUsers.length && (
              <p className="admin-empty">Никого не найдено</p>
            )}
          </div>
        </Card>
      )}

      {!loading && !loadError && tab === "invites" && (
        <>
          <Card
            title="Новый инвайт"
            description="Создай код для нового участника. Срок действия — в часах, пусто — бессрочно."
          >
            <div className="admin-settings">
              <div>
                <label className="label-field">Имя участника</label>
                <input
                  className="input"
                  value={inviteName}
                  maxLength={100}
                  placeholder="Как зовут"
                  onChange={(e) => setInviteName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void generateCode()}
                />
              </div>
              <div>
                <label className="label-field">Срок, часы</label>
                <input
                  className="input admin-input--sm"
                  type="number"
                  min="1"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={() => void generateCode()}
              >
                Сгенерировать
              </button>
            </div>

            {invite && (
              <div className="admin-code-box">
                <code>{invite.code}</code>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => void copyText(invite.code, "Код скопирован")}
                >
                  <CopyIcon />
                  Копировать
                </button>
                <div className="admin-code-box__photo">
                  <input
                    className="input"
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      setInviteImageFile(e.target.files?.[0] ?? null)
                    }
                  />
                  <button
                    className="btn btn-secondary"
                    disabled={!inviteImageFile || inviteImageUploading}
                    onClick={() => void uploadInvitePhoto()}
                  >
                    {inviteImageUploading ? "Загружаю..." : "Загрузить фото"}
                  </button>
                </div>
              </div>
            )}
          </Card>

          <Card title="Все коды" description={`${codes.length} всего`}>
            <div className="admin-list">
              {codes.map((code) => {
                const status = codeStatus(code);
                return (
                  <div className="admin-row" key={code.id}>
                    {code.imageUrl ? (
                      <img
                        className="admin-thumb is-square"
                        src={code.imageUrl}
                        alt={code.name}
                      />
                    ) : (
                      <div className="admin-thumb is-square" />
                    )}
                    <div className="admin-person__text admin-grow">
                      <strong>{code.name}</strong>
                      <span className="admin-mono">{code.code}</span>
                    </div>
                    <span
                      className={`badge ${status.active ? "badge-success" : "badge-neutral"}`}
                    >
                      <i className="badge-dot" />
                      {status.label}
                    </span>
                    <button
                      className="btn btn-icon"
                      data-tooltip="Копировать код"
                      onClick={() => void copyText(code.code, "Код скопирован")}
                    >
                      <CopyIcon />
                    </button>
                    <button
                      className="btn btn-icon"
                      data-tooltip="Удалить"
                      onClick={() =>
                        setConfirm({
                          title: "Удалить инвайт?",
                          text: `Код для «${code.name}» перестанет работать.`,
                          confirmLabel: "Удалить",
                          onConfirm: () => void deleteCode(code.id),
                        })
                      }
                    >
                      <TrashIcon />
                    </button>
                  </div>
                );
              })}
              {!codes.length && (
                <p className="admin-empty">Инвайтов пока нет</p>
              )}
            </div>
          </Card>
        </>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
      <Toasts
        items={toasts}
        onDismiss={(id) => setToasts((c) => c.filter((t) => t.id !== id))}
      />
    </div>
  );
}
