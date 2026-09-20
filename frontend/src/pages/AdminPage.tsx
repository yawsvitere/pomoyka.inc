import { useEffect, useState } from "react";
import * as adminApi from "../api/admin";
import type { AdminUser } from "../api/admin";
import type { FeedBanner, Post } from "../api/types";

const GB = 1024 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (!bytes) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatGb(bytes: number | null | undefined) {
  if (!bytes) return "0";
  return (bytes / GB).toFixed(2).replace(/\.00$/, "");
}

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [codes, setCodes] = useState<adminApi.AdminInviteCode[]>([]);
  const [banners, setBanners] = useState<FeedBanner[]>([]);
  const [postishki, setPostishki] = useState<Post[]>([]);
  const [storageSummary, setStorageSummary] =
    useState<adminApi.AdminStorageSummary | null>(null);
  const [totalQuotaGb, setTotalQuotaGb] = useState("25");
  const [defaultUserQuotaGb, setDefaultUserQuotaGb] = useState("1");
  const [selectedPostId, setSelectedPostId] = useState("");
  const [hours, setHours] = useState("24");
  const [inviteName, setInviteName] = useState("");
  const [invite, setInvite] = useState<adminApi.AdminInviteCode | null>(null);
  const [inviteImageFile, setInviteImageFile] = useState<File | null>(null);
  const [inviteImageUploading, setInviteImageUploading] = useState(false);
  const [error, setError] = useState("");

  async function loadUsers() {
    try {
      const [
        loadedUsers,
        loadedCodes,
        loadedBanners,
        loadedPostishki,
        loadedSummary,
      ] = await Promise.all([
        adminApi.getUsers(),
        adminApi.getInviteCodes(),
        adminApi.getBanners(),
        adminApi.getPostishki(),
        adminApi.getStorageSummary(),
      ]);
      setUsers(loadedUsers);
      setCodes(loadedCodes);
      setBanners(loadedBanners);
      setPostishki(loadedPostishki);
      setStorageSummary(loadedSummary);
      setTotalQuotaGb(formatGb(loadedSummary.totalQuotaBytes));
      setDefaultUserQuotaGb(formatGb(loadedSummary.defaultUserQuotaBytes));
    } catch {
      setError("Не удалось загрузить админские данные");
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function generateCode() {
    try {
      setError("");
      if (!inviteName.trim()) {
        setError("Укажи имя для инвайта");
        return;
      }
      const created = await adminApi.createInviteCode(
        inviteName,
        hours ? Number(hours) : null,
      );
      setInvite(created);
      setInviteImageFile(null);
      setCodes((current) => [created, ...current]);
    } catch {
      setError("Не удалось создать инвайт-код");
    }
  }

  async function uploadInvitePhoto() {
    if (!invite || !inviteImageFile) return;
    try {
      setError("");
      setInviteImageUploading(true);
      const imageUrl = await adminApi.uploadInviteImage(
        invite.id,
        inviteImageFile,
      );
      const patchedInvite = { ...invite, imageUrl };
      setInvite(patchedInvite);
      setCodes((current) =>
        current.map((code) => (code.id === invite.id ? patchedInvite : code)),
      );
      setInviteImageFile(null);
    } catch {
      setError("Не удалось загрузить фото для инвайт-кода");
    } finally {
      setInviteImageUploading(false);
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
    } catch {
      setError("Не удалось изменить роль");
    }
  }

  async function saveStorageSettings() {
    try {
      setError("");
      const summary = await adminApi.updateStorageSettings(
        Math.round(Number(totalQuotaGb || 0) * GB),
        Math.round(Number(defaultUserQuotaGb || 0) * GB),
      );
      setStorageSummary(summary);
    } catch {
      setError("Не удалось сохранить лимиты хранилища");
    }
  }

  async function updateUserQuota(id: string, quotaGb: string) {
    const nextValue = Number(quotaGb);
    if (!Number.isFinite(nextValue) || nextValue <= 0) return;

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
    } catch {
      setError("Не удалось обновить квоту пользователя");
    }
  }

  async function addBanner() {
    if (!selectedPostId) return;
    try {
      setError("");
      const banner = await adminApi.addBanner(selectedPostId);
      setBanners((current) => [...current, banner]);
      setSelectedPostId("");
    } catch {
      setError("Не удалось добавить баннер");
    }
  }

  async function removeBanner(id: string) {
    try {
      await adminApi.deleteBanner(id);
      setBanners((current) => current.filter((banner) => banner.id !== id));
    } catch {
      setError("Не удалось удалить баннер");
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div>
          <span className="admin-kicker">Управление</span>
          <h1>Админка</h1>
        </div>
      </header>
      {error && <p className="admin-error">{error}</p>}

      <section className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h2>Хранилище</h2>
            <p>
              {storageSummary
                ? `Последний замер: ${new Date(storageSummary.measuredAt).toLocaleString("ru-RU")}`
                : "Загрузка..."}
            </p>
          </div>
        </div>
        <div className="admin-storage-summary">
          <div>
            <strong>{formatBytes(storageSummary?.usedBytes ?? 0)}</strong>
            <span>использовано</span>
          </div>
          <div>
            <strong>{formatBytes(storageSummary?.totalQuotaBytes ?? 0)}</strong>
            <span>общий лимит</span>
          </div>
          <div>
            <strong>
              {formatBytes(storageSummary?.defaultUserQuotaBytes ?? 0)}
            </strong>
            <span>по умолчанию на пользователя</span>
          </div>
        </div>
        <div className="admin-storage-controls">
          <label>
            Общий лимит, ГБ
            <input
              type="number"
              min="1"
              step="0.5"
              value={totalQuotaGb}
              onChange={(e) => setTotalQuotaGb(e.target.value)}
            />
          </label>
          <label>
            По умолчанию на пользователя, ГБ
            <input
              type="number"
              min="0.1"
              step="0.5"
              value={defaultUserQuotaGb}
              onChange={(e) => setDefaultUserQuotaGb(e.target.value)}
            />
          </label>
          <button onClick={() => void saveStorageSettings()}>
            Сохранить лимиты
          </button>
        </div>
      </section>

      <section className="admin-section admin-invite">
        <div>
          <h2>Инвайт-коды</h2>
          <p>Создай код для нового участника.</p>
        </div>
        <div className="admin-invite-controls">
          <input
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            placeholder="Имя нового участника"
            maxLength={100}
          />
          <input
            type="number"
            min="1"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="Часы"
          />
          <button onClick={() => void generateCode()}>Сгенерировать</button>
        </div>
        {invite && (
          <div className="admin-code">
            <strong>{invite.code}</strong>
            <button
              onClick={() => void navigator.clipboard.writeText(invite.code)}
            >
              Копировать
            </button>
          </div>
        )}
        {invite && (
          <div className="admin-invite-photo">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setInviteImageFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => void uploadInvitePhoto()}
              disabled={!inviteImageFile || inviteImageUploading}
            >
              {inviteImageUploading ? "Загружаю..." : "Загрузить фото"}
            </button>
          </div>
        )}
        <div className="admin-codes">
          {codes.map((code) => (
            <div className="admin-code-row" key={code.id}>
              <strong>{code.name}</strong>
              {code.imageUrl && (
                <img
                  src={code.imageUrl}
                  alt={code.name}
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: "cover",
                    borderRadius: 8,
                  }}
                />
              )}
              <span>{code.code}</span>
              <span>
                {code.usedAt
                  ? "Использован"
                  : code.expiresAt && new Date(code.expiresAt) < new Date()
                    ? "Истёк"
                    : "Активен"}
              </span>
              <button
                className="admin-delete"
                onClick={() =>
                  void adminApi
                    .deleteInviteCode(code.id)
                    .then(() =>
                      setCodes((current) =>
                        current.filter((item) => item.id !== code.id),
                      ),
                    )
                }
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="admin-section admin-banners">
        <div className="admin-section-heading">
          <div>
            <h2>Баннеры в сайдбаре</h2>
            <p>Выбери постишку, которая будет показана вверху ленты.</p>
          </div>
        </div>
        <div className="admin-banner-controls">
          <select
            value={selectedPostId}
            onChange={(e) => setSelectedPostId(e.target.value)}
          >
            <option value="">Выбери постишку</option>
            {postishki
              .filter(
                (post) => !banners.some((banner) => banner.postId === post.id),
              )
              .map((post) => (
                <option value={post.id} key={post.id}>
                  {post.title || "Без названия"}
                </option>
              ))}
          </select>
          <button onClick={() => void addBanner()} disabled={!selectedPostId}>
            Добавить
          </button>
        </div>
        <div className="admin-banners-list">
          {banners.map((banner) => (
            <div className="admin-banner-row" key={banner.id}>
              {banner.imageUrl && <img src={banner.imageUrl} alt="" />}
              <strong>{banner.title}</strong>
              <span>
                {new Date(banner.createdAt).toLocaleDateString("ru-RU")}
              </span>
              <button
                className="admin-delete"
                onClick={() => void removeBanner(banner.id)}
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h2>Пользователи</h2>
            <p>{users.length} участников</p>
          </div>
        </div>
        <div className="admin-users">
          {users.map((user) => (
            <div className="admin-user" key={user.id}>
              <div className="admin-user-main">
                <div
                  className="admin-user-avatar"
                  style={{ background: user.nicknameColor ?? "#4f46e5" }}
                >
                  {user.displayName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <strong style={{ color: user.nicknameColor ?? "#4f46e5" }}>
                    {user.displayName}
                  </strong>
                  <span>{user.email}</span>
                  <small>
                    {user.isOnline
                      ? "Онлайн"
                      : user.lastSeenAt
                        ? `Был в сети ${new Date(user.lastSeenAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}`
                        : "Не в сети"}
                  </small>
                </div>
              </div>
              <div className="admin-user-storage">
                <div>
                  <span>{formatBytes(user.storageUsedBytes)}</span>
                  <small>использовано</small>
                </div>
                <label>
                  Квота, ГБ
                  <input
                    type="number"
                    min="0.1"
                    step="0.5"
                    value={formatGb(
                      user.storageQuotaBytes ?? user.effectiveStorageQuotaBytes,
                    )}
                    onChange={(e) =>
                      void updateUserQuota(user.id, e.target.value)
                    }
                  />
                </label>
              </div>
              <select
                value={user.roles[0] ?? "User"}
                onChange={(e) => void updateRole(user.id, e.target.value)}
              >
                <option value="User">User</option>
                <option value="Admin">Admin</option>
              </select>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
