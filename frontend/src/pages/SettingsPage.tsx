import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Cropper, { type Area } from "react-easy-crop";
import { useAuth } from "../context/AuthContext";
import * as authApi from "../api/auth";
import pencilIcon from "../assets/icons/pencil.svg";
import { AvatarMedia } from "../components/ui/AvatarMedia";
import { getBrowserFileUrl } from "../utils/fileUrl";
import "../styles/pages/settings.css";

type CropTarget = "avatar" | "banner";

async function createCroppedImage(imageSrc: string, crop: Area) {
  const image = new Image();
  image.src = imageSrc;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Не удалось прочитать изображение"));
  });

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas недоступен");

  canvas.width = crop.width;
  canvas.height = crop.height;
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Не удалось обрезать изображение")),
      "image/jpeg",
      0.92,
    );
  });
}

export function SettingsPage() {
  const { user, updateUser, logout } = useAuth();
  const savedDisplayName = user?.displayName ?? "";
  const savedNicknameColor = user?.nicknameColor ?? "#4f46e5";
  const savedAbout = user?.about ?? "";
  const [displayName, setDisplayName] = useState(savedDisplayName);
  const [nicknameColor, setNicknameColor] = useState(savedNicknameColor);
  const [about, setAbout] = useState(savedAbout);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [cropVideo, setCropVideo] = useState<string | null>(null);
  const [cropVideoFile, setCropVideoFile] = useState<File | null>(null);
  const [cropFileName, setCropFileName] = useState("image.jpg");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName ?? "");
      setNicknameColor(user.nicknameColor ?? "#4f46e5");
      setAbout(user.about ?? "");
    }
  }, [user]);

  async function saveChanges(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");

    try {
      const profileChanged =
        displayName !== savedDisplayName ||
        nicknameColor !== savedNicknameColor ||
        about !== savedAbout;
      const passwordChanged = Boolean(currentPassword || newPassword);

      if (profileChanged) {
        const updatedUser = await authApi.updateProfile(
          displayName,
          nicknameColor,
          about,
        );
        updateUser(updatedUser);
      }
      if (passwordChanged) {
        await authApi.changePassword(currentPassword, newPassword);
      }

      setCurrentPassword("");
      setNewPassword("");
      setMessage("Изменения сохранены");
    } catch {
      setError("Не удалось сохранить изменения");
    }
  }

  function openCropper(
    e: React.ChangeEvent<HTMLInputElement>,
    target: CropTarget,
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropTarget(target);
    setCropFileName(file.name.replace(/\.[^.]+$/, "") + ".jpg");
    const objectUrl = URL.createObjectURL(file);
    const isVideo = target === "avatar" && file.type.startsWith("video/");
    setCropImage(isVideo ? null : objectUrl);
    setCropVideo(isVideo ? objectUrl : null);
    setCropVideoFile(isVideo ? file : null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    e.target.value = "";
  }

  function closeCropper() {
    if (cropImage) URL.revokeObjectURL(cropImage);
    if (cropVideo) URL.revokeObjectURL(cropVideo);
    setCropImage(null);
    setCropVideo(null);
    setCropVideoFile(null);
    setCropTarget(null);
  }

  async function uploadCroppedImage() {
    if ((!cropImage && !cropVideo) || !cropTarget || !croppedAreaPixels) return;
    setError("");
    setIsUploading(true);
    try {
      if (cropTarget === "avatar") {
        if (cropVideoFile) {
          const avatarUrl = await authApi.uploadAvatar(
            cropVideoFile,
            croppedAreaPixels,
          );
          updateUser({ ...user!, avatarUrl });
        } else {
          if (!cropImage) return;
          const blob = await createCroppedImage(cropImage, croppedAreaPixels);
          const file = new File([blob], cropFileName, { type: "image/jpeg" });
          const avatarUrl = await authApi.uploadAvatar(file);
          updateUser({ ...user!, avatarUrl });
        }
        setMessage("Аватар обновлён");
      } else {
        if (!cropImage) return;
        const blob = await createCroppedImage(cropImage, croppedAreaPixels);
        const file = new File([blob], cropFileName, { type: "image/jpeg" });
        const bannerUrl = await authApi.uploadBanner(file);
        updateUser({ ...user!, bannerUrl: `${bannerUrl}?v=${Date.now()}` });
        setMessage("Баннер обновлён");
      }
      closeCropper();
    } catch {
      setError(
        `Не удалось загрузить ${cropTarget === "avatar" ? "аватар" : "баннер"}`,
      );
    } finally {
      setIsUploading(false);
    }
  }

  const avatarUrl = user?.avatarUrl
    ? getBrowserFileUrl(user.avatarUrl)
    : undefined;
  const hasChanges =
    displayName !== savedDisplayName ||
    nicknameColor !== savedNicknameColor ||
    about !== savedAbout ||
    Boolean(currentPassword || newPassword);
  const colorPickerValue = /^#[0-9a-fA-F]{6}$/.test(nicknameColor)
    ? nicknameColor
    : "#000000";

  return (
    <main className="settings-page">
      <div className="settings-card">
        <div className="settings-header">
          <div className="settings-title-wrap">
            <h1>Настройки</h1>
          </div>
        </div>

        <label className="settings-avatar-upload" htmlFor="avatar-upload">
          {avatarUrl ? (
            <AvatarMedia
              className="settings-avatar"
              src={avatarUrl}
              alt="Аватар пользователя"
            />
          ) : (
            <span className="settings-avatar settings-avatar--placeholder">
              {displayName.charAt(0).toUpperCase() || "?"}
            </span>
          )}
          <span className="settings-avatar-overlay" aria-hidden="true">
            <img src={pencilIcon} alt="" />
          </span>
        </label>

        <input
          id="avatar-upload"
          className="settings-upload-input"
          type="file"
          accept="image/*,video/*"
          onChange={(e) => openCropper(e, "avatar")}
        />

        <label className="settings-banner-upload" htmlFor="banner-upload">
          {user?.bannerUrl && (
            <img
              src={getBrowserFileUrl(user.bannerUrl)}
              alt="Баннер профиля"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          )}
          <span>{user?.bannerUrl ? "Изменить баннер" : "Добавить баннер"}</span>
        </label>
        <input
          id="banner-upload"
          className="settings-upload-input"
          type="file"
          accept="image/*"
          onChange={(e) => openCropper(e, "banner")}
        />

        <form className="settings-form" onSubmit={saveChanges}>
          <div className="settings-field">
            <label className="settings-label" htmlFor="display-name">
              Никнейм
            </label>
            <input
              className="input"
              id="display-name"
              type="text"
              value={displayName}
              minLength={2}
              maxLength={50}
              required
              onChange={(e) => setDisplayName(e.target.value)}
              style={{ color: nicknameColor }}
              aria-label="Никнейм"
            />
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="nickname-color">
              Цвет ника
            </label>
            <div className="settings-color-row">
              <input
                className="settings-color-picker"
                type="color"
                value={colorPickerValue}
                onChange={(e) => setNicknameColor(e.target.value)}
                aria-label="Выбрать цвет ника"
              />
              <input
                className="input settings-hex-input"
                id="nickname-color"
                type="text"
                value={nicknameColor}
                maxLength={7}
                pattern="#[0-9a-fA-F]{6}"
                onChange={(e) => setNicknameColor(e.target.value)}
                aria-label="HEX-код цвета ника"
              />
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="about">
              О себе
            </label>
            <textarea
              className="input settings-about-input"
              id="about"
              value={about}
              maxLength={500}
              rows={4}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Расскажите немного о себе"
            />
          </div>

          <div className="settings-password-form">
            <h2 className="settings-section-title">Изменить пароль</h2>

            <div className="settings-field">
              <label className="settings-label" htmlFor="current-password">
                Текущий пароль
              </label>
              <input
                className="input"
                id="current-password"
                type="password"
                value={currentPassword}
                minLength={8}
                required={Boolean(currentPassword || newPassword)}
                autoComplete="current-password"
                onChange={(e) => setCurrentPassword(e.target.value)}
                aria-label="Текущий пароль"
              />
            </div>

            <div className="settings-field">
              <label className="settings-label" htmlFor="new-password">
                Новый пароль
              </label>
              <input
                className="input"
                id="new-password"
                type="password"
                value={newPassword}
                minLength={8}
                required={Boolean(currentPassword || newPassword)}
                autoComplete="new-password"
                onChange={(e) => setNewPassword(e.target.value)}
                aria-label="Новый пароль"
              />
            </div>
          </div>

          {hasChanges && (
            <div className="settings-actions">
              <button className="btn btn-primary" type="submit">
                Сохранить
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  setDisplayName(savedDisplayName);
                  setNicknameColor(savedNicknameColor);
                  setAbout(savedAbout);
                  setCurrentPassword("");
                  setNewPassword("");
                  setError("");
                  setMessage("");
                }}
              >
                Отменить
              </button>
            </div>
          )}
        </form>

        {message && (
          <p className="settings-message settings-message--success">
            {message}
          </p>
        )}
        {error && (
          <p className="settings-message settings-message--error">{error}</p>
        )}
        <button className="settings-logout" type="button" onClick={logout}>
          Выйти
        </button>
      </div>

      {(cropImage || cropVideo) &&
        cropTarget &&
        createPortal(
          <div
            className="settings-crop-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="crop-title"
          >
            <div className="settings-crop-dialog">
              <div className="settings-crop-header">
                <h2 id="crop-title">
                  Обрезать {cropTarget === "avatar" ? "аватар" : "баннер"}
                </h2>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={closeCropper}
                  disabled={isUploading}
                >
                  Отмена
                </button>
              </div>
              <div
                className={`settings-crop-area settings-crop-area--${cropTarget}`}
              >
                <Cropper
                  image={cropImage ?? undefined}
                  video={cropVideo ?? undefined}
                  crop={crop}
                  zoom={zoom}
                  aspect={cropTarget === "avatar" ? 1 : 3}
                  cropShape={cropTarget === "avatar" ? "round" : "rect"}
                  showGrid
                  mediaProps={{
                    muted: true,
                    playsInline: true,
                    autoPlay: true,
                  }}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={(_, areaPixels) =>
                    setCroppedAreaPixels(areaPixels)
                  }
                />
              </div>
              <div className="settings-crop-controls">
                <label>
                  Масштаб{" "}
                  <input
                    type="range"
                    min="1"
                    max="3"
                    step="0.1"
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                  />
                </label>
              </div>
              <button
                className="btn btn-primary"
                type="button"
                onClick={uploadCroppedImage}
                disabled={isUploading || !croppedAreaPixels}
              >
                {isUploading ? "Загрузка..." : "Обрезать и загрузить"}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </main>
  );
}
