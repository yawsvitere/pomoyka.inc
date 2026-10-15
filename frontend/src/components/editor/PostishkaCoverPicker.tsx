import { useEffect, useRef, useState } from "react";
import * as postsApi from "../../api/posts";

const MAX_COVER_SIZE = 10 * 1024 * 1024;

interface PostishkaCoverPickerProps {
  postId?: string;
  hasExistingCover?: boolean;
  coverFile: File | null;
  removeExistingCover: boolean;
  onCoverFileChange: (file: File | null) => void;
  onRemoveExistingCoverChange: (remove: boolean) => void;
}

export function PostishkaCoverPicker({
  postId,
  hasExistingCover = false,
  coverFile,
  removeExistingCover,
  onCoverFileChange,
  onRemoveExistingCoverChange,
}: PostishkaCoverPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const localCoverUrlRef = useRef<string | null>(null);
  const [existingCover, setExistingCover] = useState<{
    postId: string;
    url: string;
  } | null>(null);
  const [loadErrorPostId, setLoadErrorPostId] = useState<string | null>(null);
  const [localCoverUrl, setLocalCoverUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!postId || !hasExistingCover) return;

    let active = true;
    let objectUrl: string | null = null;
    void postsApi
      .getPostishkaCover(postId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setExistingCover({ postId, url: objectUrl });
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        if (active) setLoadErrorPostId(postId);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [postId, hasExistingCover]);

  useEffect(() => {
    return () => {
      if (localCoverUrlRef.current)
        URL.revokeObjectURL(localCoverUrlRef.current);
    };
  }, []);

  const existingCoverUrl =
    existingCover && existingCover.postId === postId ? existingCover.url : null;
  const previewUrl = coverFile
    ? localCoverUrl
    : removeExistingCover
      ? null
      : existingCoverUrl;
  const hasCover = Boolean(previewUrl) || (hasExistingCover && !removeExistingCover);

  function handleFileChange(file: File | undefined) {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Выберите файл изображения");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (file.size > MAX_COVER_SIZE) {
      setError("Размер обложки не должен превышать 10 МБ");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (localCoverUrlRef.current)
      URL.revokeObjectURL(localCoverUrlRef.current);
    localCoverUrlRef.current = URL.createObjectURL(file);
    setLocalCoverUrl(localCoverUrlRef.current);
    onCoverFileChange(file);
    onRemoveExistingCoverChange(false);
  }

  function removeCover() {
    if (localCoverUrlRef.current) {
      URL.revokeObjectURL(localCoverUrlRef.current);
      localCoverUrlRef.current = null;
    }
    setLocalCoverUrl(null);
    onCoverFileChange(null);
    onRemoveExistingCoverChange(hasExistingCover);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <section className="postishka-cover-picker" aria-label="Обложка постишки">
      <div className="postishka-cover-picker-copy">
        <strong>Обложка для превью</strong>
        <span>Необязательно · будет использоваться в OG-превью постишки</span>
        {(error || (loadErrorPostId === postId && postId)) && (
          <small role="alert">
            {error || "Не удалось загрузить текущую обложку"}
          </small>
        )}
      </div>
      {previewUrl && (
        <img className="postishka-cover-preview" src={previewUrl} alt="Обложка постишки" />
      )}
      <div className="postishka-cover-picker-actions">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          aria-label="Выбрать обложку"
          onChange={(event) => handleFileChange(event.currentTarget.files?.[0])}
        />
        <button type="button" onClick={() => inputRef.current?.click()}>
          {hasCover ? "Заменить" : "Выбрать изображение"}
        </button>
        {hasCover && (
          <button type="button" className="postishka-cover-remove" onClick={removeCover}>
            Убрать
          </button>
        )}
      </div>
    </section>
  );
}
