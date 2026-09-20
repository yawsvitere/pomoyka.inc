import { useEffect, useMemo, useRef, useState } from "react";
import { PhotoSlider } from "react-photo-view";
import * as filesApi from "../api/files";
import { ContextMenu } from "../components/feed/ContextMenu";
import { AlertDialog } from "../components/ui/AlertDialog";
import { MediaModal } from "../components/ui/MediaModal";
import copyIcon from "../assets/icons/copy.svg";
import deleteIcon from "../assets/icons/delete.svg";
import downloadIcon from "../assets/icons/download.svg";
import filterIcon from "../assets/icons/filter.svg";
import folderIcon from "../assets/icons/folder.svg";
import searchIcon from "../assets/icons/search.svg";
import "react-photo-view/dist/react-photo-view.css";
import "../styles/pages/file-manager.css";

function formatSize(bytes: number) {
  if (!bytes) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}
function isImage(file: filesApi.UserFile) {
  return file.contentType.startsWith("image/");
}
function isVideo(file: filesApi.UserFile) {
  return (
    file.contentType.startsWith("video/") ||
    /\.(mp4|webm|mov|m4v|ogv|avi|mkv)$/i.test(file.fileName)
  );
}
function isAudio(file: filesApi.UserFile) {
  return (
    file.contentType.startsWith("audio/") ||
    /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i.test(file.fileName)
  );
}

function fileInitials(name: string) {
  const base = name.split(".")[0] || name;
  const parts = base.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function InlineRenameInput({
  value,
  onChange,
  onConfirm,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      className="fm-inline-rename"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") void onConfirm();
        if (event.key === "Escape") onCancel();
      }}
    />
  );
}

function EmptyFilesState({
  onUpload,
  readOnly = false,
}: {
  onUpload: () => void;
  readOnly?: boolean;
}) {
  return (
    <div className="fm-empty-state">
      <div className="fm-empty-state-icon">
        <img src={folderIcon} alt="" />
      </div>
      <strong>Файлов пока нет</strong>
      <p>
        {readOnly
          ? "В общей библиотеке пока нет файлов."
          : "Загрузите первый файл, чтобы начать работу."}
      </p>
      {!readOnly && (
        <div className="fm-empty-state-actions">
          <button type="button" className="btn btn-primary" onClick={onUpload}>
            Загрузить
          </button>
        </div>
      )}
    </div>
  );
}

function ImageFilePreview({
  file,
  isRenaming,
  renameName,
  onRenameChange,
  onConfirmRename,
  onCancelRename,
}: {
  file: filesApi.UserFile;
  isRenaming: boolean;
  renameName: string;
  onRenameChange: (value: string) => void;
  onConfirmRename: () => void;
  onCancelRename: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  async function openImage() {
    if (isLoading) return;
    if (url) {
      setIsViewerOpen(true);
      return;
    }

    setIsLoading(true);
    try {
      setUrl(await filesApi.getAuthenticatedFileUrl(file.downloadUrl));
      setIsViewerOpen(true);
    } finally {
      setIsLoading(false);
    }
  }

  const content = (
    <>
      {file.previewUrl ? (
        <img
          className="fm-image-preview"
          src={file.previewUrl}
          alt=""
          loading="lazy"
        />
      ) : (
        <span className="fm-file-avatar">IMG</span>
      )}
      <span className="fm-file-meta">
        {isRenaming ? (
          <InlineRenameInput
            value={renameName}
            onChange={onRenameChange}
            onConfirm={onConfirmRename}
            onCancel={onCancelRename}
          />
        ) : (
          <strong>{file.fileName}</strong>
        )}
        <small>{file.fileName.split(".").pop()?.toUpperCase()}</small>
      </span>
    </>
  );

  const fileNameControl = isRenaming ? (
    <div className="fm-file-name fm-image-file-name">{content}</div>
  ) : (
    <button
      type="button"
      className="fm-file-name fm-image-file-name"
      onClick={() => void openImage()}
      disabled={isLoading}
    >
      {content}
    </button>
  );

  return (
    <>
      {fileNameControl}
      {url && (
        <PhotoSlider
          images={[{ key: file.id, src: url }]}
          index={0}
          visible={isViewerOpen}
          onClose={() => setIsViewerOpen(false)}
        />
      )}
    </>
  );
}

const PAGE_SIZE = 100;

function accessLabel(accessLevel: filesApi.FileAccessLevel) {
  return accessLevel === 2
    ? "Публичный"
    : accessLevel === 1
      ? "Братва"
      : "Приватный";
}

type PendingDelete =
  | { type: "folder"; item: filesApi.FileFolder }
  | { type: "file"; item: filesApi.UserFile }
  | { type: "files"; ids: string[] }
  | null;

type RenameTarget =
  | { type: "folder"; item: filesApi.FileFolder }
  | { type: "file"; item: filesApi.UserFile }
  | null;

type FileFilter = "all" | "audio" | "video" | "image" | "other";

const fileFilterLabels: Record<FileFilter, string> = {
  all: "Все файлы",
  audio: "Аудио",
  video: "Видео",
  image: "Фото",
  other: "Другое",
};

export function FileManagerPage({ shared = false }: { shared?: boolean }) {
  const [library, setLibrary] = useState<filesApi.Library>({
    folders: [],
    files: [],
  });
  const [quota, setQuota] = useState<filesApi.StorageQuota | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [fileFilter, setFileFilter] = useState<FileFilter>("all");
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [activeMedia, setActiveMedia] = useState<{
    type: "video" | "audio";
    name: string;
    url: string;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [renameName, setRenameName] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{
    currentFile: string;
    completed: number;
    total: number;
    percent: number;
  } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (activeMedia?.url) URL.revokeObjectURL(activeMedia.url);
    };
  }, [activeMedia]);

  async function reload() {
    try {
      const [nextLibrary, nextQuota] = await Promise.all([
        shared ? filesApi.getCommonLibrary() : filesApi.getLibrary(),
        shared ? Promise.resolve(null) : filesApi.getQuota(),
      ]);
      setLibrary(nextLibrary);
      setQuota(nextQuota);
    } catch {
      setError("Не удалось загрузить файловую библиотеку");
    }
  }
  useEffect(() => {
    void reload();
  }, [shared]);

  const folder = library.folders.find((item) => item.id === folderId);
  const quotaPercent = quota
    ? Math.min(
        100,
        Math.round((quota.usedBytes / Math.max(quota.quotaBytes, 1)) * 100),
      )
    : 0;

  const filteredFiles = useMemo(
    () =>
      library.files
        .filter((file) =>
          folderId ? file.folderId === folderId : !file.folderId,
        )
        .filter((file) =>
          file.fileName.toLowerCase().includes(search.toLowerCase()),
        )
        .filter((file) => {
          if (fileFilter === "all") return true;
          if (fileFilter === "image") return isImage(file);
          if (fileFilter === "video") return isVideo(file);
          if (fileFilter === "audio") return isAudio(file);
          return !isImage(file) && !isVideo(file) && !isAudio(file);
        }),
    [fileFilter, folderId, library.files, search],
  );

  const filteredFolders = useMemo(
    () =>
      folderId
        ? []
        : library.folders.filter((item) =>
            item.name.toLowerCase().includes(search.toLowerCase()),
          ),
    [folderId, library.folders, search],
  );

  const visibleItems = useMemo(
    () => [
      ...filteredFolders.map((item) => ({ type: "folder" as const, item })),
      ...filteredFiles.map((item) => ({ type: "file" as const, item })),
    ],
    [filteredFiles, filteredFolders],
  );

  const pageCount = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));
  const visibleItemsPage = useMemo(
    () => visibleItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [visibleItems, page],
  );

  const visibleFiles = visibleItemsPage
    .filter(
      (entry): entry is { type: "file"; item: filesApi.UserFile } =>
        entry.type === "file",
    )
    .map((entry) => entry.item);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [folderId, search]);

  async function upload(files: FileList | File[]) {
    setError("");
    const uploadFiles = Array.from(files);
    if (uploadFiles.length === 0) return;
    setUploadProgress({
      currentFile: uploadFiles[0].name,
      completed: 0,
      total: uploadFiles.length,
      percent: 0,
    });
    try {
      for (let index = 0; index < uploadFiles.length; index += 1) {
        const file = uploadFiles[index];
        setUploadProgress({
          currentFile: file.name,
          completed: index,
          total: uploadFiles.length,
          percent: Math.round((index / uploadFiles.length) * 100),
        });
        await filesApi.uploadFile(file, folderId, (filePercent) => {
          setUploadProgress({
            currentFile: file.name,
            completed: index,
            total: uploadFiles.length,
            percent: Math.round(
              ((index + filePercent / 100) / uploadFiles.length) * 100,
            ),
          });
        });
      }
      await reload();
    } catch (reason: any) {
      setError(reason?.response?.data?.message ?? "Не удалось загрузить файл");
    } finally {
      setUploadProgress(null);
    }
  }
  async function pasteImagesFromClipboard() {
    setError("");
    try {
      if (!navigator.clipboard?.read) {
        throw new Error("Clipboard read is not supported");
      }

      const pastedFiles: File[] = [];
      for (const clipboardItem of await navigator.clipboard.read()) {
        for (const type of clipboardItem.types) {
          if (!type.startsWith("image/")) continue;
          const blob = await clipboardItem.getType(type);
          const extension = type.split("/")[1]?.split("+")[0] || "png";
          pastedFiles.push(
            new File([blob], `pasted-image-${Date.now()}.${extension}`, {
              type: blob.type || type,
            }),
          );
          break;
        }
      }

      if (pastedFiles.length === 0) {
        setError("В буфере обмена нет изображения");
        return;
      }
      await upload(pastedFiles);
    } catch {
      setError("Не удалось вставить изображение из буфера обмена");
    }
  }

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      if (shared) return;
      const pastedImages = Array.from(event.clipboardData?.items ?? [])
        .filter(
          (item) => item.kind === "file" && item.type.startsWith("image/"),
        )
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);

      if (pastedImages.length === 0) return;
      event.preventDefault();
      void upload(pastedImages);
    }

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [folderId, shared]);

  useEffect(() => {
    if (!isFilterMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!filterMenuRef.current?.contains(event.target as Node)) {
        setIsFilterMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isFilterMenuOpen]);

  async function createFolder() {
    if (!folderName.trim()) return;
    try {
      const created = await filesApi.createFolder(folderName, 0);
      setLibrary((current) => ({
        ...current,
        folders: [...current.folders, created],
      }));
      setFolderName("");
      setFolderDialog(false);
    } catch (reason: any) {
      setError(reason?.response?.data?.message ?? "Не удалось создать папку");
    }
  }
  async function setFileAccess(
    file: filesApi.UserFile,
    accessLevel: filesApi.FileAccessLevel,
  ) {
    const updated = await filesApi.setFileVisibility(file.id, accessLevel);
    setLibrary((current) => ({
      ...current,
      files: current.files.map((item) =>
        item.id === file.id ? updated : item,
      ),
    }));
  }
  async function toggleFile(file: filesApi.UserFile) {
    await setFileAccess(file, file.accessLevel === 2 ? 0 : 2);
  }
  async function setFolderAccess(
    item: filesApi.FileFolder,
    accessLevel: filesApi.FileAccessLevel,
  ) {
    await filesApi.setFolderVisibility(item.id, accessLevel);
    setLibrary((current) => ({
      ...current,
      folders: current.folders.map((folderItem) =>
        folderItem.id === item.id ? { ...folderItem, accessLevel } : folderItem,
      ),
    }));
  }
  async function toggleFolder(item: filesApi.FileFolder) {
    await setFolderAccess(item, item.accessLevel === 2 ? 0 : 2);
  }
  async function openMedia(file: filesApi.UserFile) {
    if (!isVideo(file) && !isAudio(file)) return;
    try {
      const url = await filesApi.getAuthenticatedFileUrl(file.downloadUrl);
      setActiveMedia({
        type: isVideo(file) ? "video" : "audio",
        name: file.fileName,
        url,
      });
    } catch {
      setError("Не удалось открыть файл");
    }
  }
  async function copyShareUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      setError("Не удалось скопировать ссылку");
    }
  }
  async function moveFile(fileId: string, targetFolderId: string | null) {
    setError("");
    setDragOverFolderId(null);
    try {
      await filesApi.moveFile(fileId, targetFolderId);
      await reload();
    } catch (reason: any) {
      setError(
        reason?.response?.data?.message ?? "Не удалось переместить файл",
      );
    }
  }
  function removeFolder(item: filesApi.FileFolder) {
    setPendingDelete({ type: "folder", item });
  }
  function startRename(target: RenameTarget) {
    if (!target) return;
    setRenameTarget(target);
    setRenameName(
      target.type === "folder" ? target.item.name : target.item.fileName,
    );
  }
  async function confirmRename() {
    if (!renameTarget || !renameName.trim()) return;
    setError("");
    try {
      if (renameTarget.type === "folder") {
        await filesApi.renameFolder(renameTarget.item.id, renameName);
      } else {
        await filesApi.renameFile(renameTarget.item.id, renameName);
      }
      setRenameTarget(null);
      setRenameName("");
      await reload();
    } catch (reason: any) {
      setError(reason?.response?.data?.message ?? "Не удалось переименовать");
    }
  }
  async function confirmDelete() {
    const action = pendingDelete;
    setPendingDelete(null);
    if (!action) return;
    setError("");
    try {
      if (action.type === "folder") {
        await filesApi.deleteFolder(action.item.id);
        if (folderId === action.item.id) setFolderId(null);
      } else if (action.type === "file") {
        await filesApi.deleteFile(action.item.id);
      } else {
        await Promise.all(action.ids.map((id) => filesApi.deleteFile(id)));
        setSelected(new Set());
      }
      await reload();
    } catch (reason: any) {
      setError(
        reason?.response?.data?.message ??
          (action.type === "folder"
            ? "Не удалось удалить папку"
            : "Не удалось удалить файлы"),
      );
    }
  }
  async function bulkSetVisibility(accessLevel: filesApi.FileAccessLevel) {
    setError("");
    try {
      await Promise.all(
        [...selected].map((id) => filesApi.setFileVisibility(id, accessLevel)),
      );
      setSelected(new Set());
      await reload();
    } catch (reason: any) {
      setError(reason?.response?.data?.message ?? "Не удалось изменить доступ");
    }
  }
  function bulkDelete() {
    setPendingDelete({ type: "files", ids: [...selected] });
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((current) =>
      visibleFiles.length > 0 &&
      visibleFiles.every((file) => current.has(file.id))
        ? new Set()
        : new Set(visibleFiles.map((f) => f.id)),
    );
  }

  return (
    <div className="fm-page">
      <ContextMenu
        popoverClassName="fm-file-manager-context-menu"
        customActions={[
          ...(!shared
            ? [
                {
                  key: "upload",
                  label: "Загрузить файлы",
                  icon: downloadIcon,
                  onClick: () => uploadRef.current?.click(),
                },
                {
                  key: "paste",
                  label: "Вставить изображение",
                  icon: downloadIcon,
                  onClick: () => void pasteImagesFromClipboard(),
                },
              ]
            : []),
          ...(!folderId
            ? [
                {
                  key: "create-folder",
                  label: "Новая папка",
                  icon: folderIcon,
                  onClick: () => setFolderDialog(true),
                },
              ]
            : []),
        ]}
      >
        <main className="fm-main">
          {error && <div className="fm-error">{error}</div>}

          <input
            ref={uploadRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(event) => {
              if (event.target.files && event.target.files.length > 0) {
                void upload(event.target.files);
              }
              event.target.value = "";
            }}
          />

          {!shared && (
            <section
              className={`fm-quota${quotaPercent >= 90 ? " is-warning" : ""}`}
            >
              <div
                className="fm-quota-ring"
                style={
                  {
                    "--fm-quota-percent": `${quotaPercent}%`,
                  } as React.CSSProperties
                }
                aria-label={`Использовано ${quotaPercent}% квоты`}
              >
                <span>{quotaPercent}%</span>
              </div>
              <div className="fm-quota-copy">
                <strong>Хранилище</strong>
                <span>
                  {quota
                    ? `${formatSize(quota.usedBytes)} из ${formatSize(quota.quotaBytes)}`
                    : "Загрузка квоты..."}
                </span>
              </div>
              <span className="fm-quota-label">использовано</span>
            </section>
          )}

          {/* ---------- Toolbar: search pill / Favorited-All segment / Filters ---------- */}
          <div className="fm-toolbar">
            <div className="fm-search-wrap">
              <img
                className="fm-search-icon"
                src={searchIcon}
                alt=""
                aria-hidden="true"
              />
              <input
                className="fm-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по названию файла"
              />
            </div>

            <div className="fm-toolbar-spacer" />

            {!shared && !folderId && (
              <button
                type="button"
                className="btn btn-secondary fm-toolbar-btn"
                onClick={() => setFolderDialog(true)}
              >
                Новая папка
              </button>
            )}
            {!shared && (
              <button
                type="button"
                className="btn btn-primary fm-toolbar-btn"
                onClick={() => uploadRef.current?.click()}
              >
                Загрузить
              </button>
            )}
          </div>

          {selected.size > 0 && (
            <div className="fm-bulk-bar">
              <span>{selected.size} выбрано</span>
              <div className="fm-bulk-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => void bulkSetVisibility(2)}
                >
                  Сделать публичными
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => void bulkSetVisibility(1)}
                >
                  Только авторизованным
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => void bulkSetVisibility(0)}
                >
                  Сделать приватными
                </button>
                <button
                  className="btn btn-danger btn-sm fm-bulk-danger"
                  onClick={() => void bulkDelete()}
                >
                  Удалить
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelected(new Set())}
                >
                  Отмена
                </button>
              </div>
            </div>
          )}

          <div className="fm-breadcrumb-row">
            <nav className="fm-breadcrumb">
              <button
                type="button"
                className={`fm-breadcrumb-link${folderId ? "" : " is-current"}`}
                onClick={() => setFolderId(null)}
              >
                Все файлы
              </button>
              {folder && (
                <>
                  <span className="fm-breadcrumb-sep">/</span>
                  <span className="fm-breadcrumb-current">{folder.name}</span>
                </>
              )}
            </nav>
            <div className="fm-filter" ref={filterMenuRef}>
              <button
                type="button"
                className={`btn btn-secondary fm-filter-button${isFilterMenuOpen ? " is-open" : ""}`}
                aria-expanded={isFilterMenuOpen}
                aria-haspopup="menu"
                onClick={() => setIsFilterMenuOpen((open) => !open)}
              >
                <img
                  className="fm-filter-button-icon"
                  src={filterIcon}
                  alt=""
                  aria-hidden="true"
                />
                Фильтр: {fileFilterLabels[fileFilter]}
              </button>
              {isFilterMenuOpen && (
                <div className="fm-filter-menu" role="menu">
                  {(Object.keys(fileFilterLabels) as FileFilter[]).map(
                    (filter) => (
                      <button
                        key={filter}
                        type="button"
                        role="menuitemradio"
                        aria-checked={fileFilter === filter}
                        className={`fm-filter-option${fileFilter === filter ? " is-selected" : ""}`}
                        onClick={() => {
                          setFileFilter(filter);
                          setIsFilterMenuOpen(false);
                        }}
                      >
                        <span>{fileFilterLabels[filter]}</span>
                        {fileFilter === filter && (
                          <span aria-hidden="true">✓</span>
                        )}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ---------- Table: checkbox | avatar+name | cell | cell | badge | Edit ... ---------- */}
          <section
            className={`fm-list${isDragging ? " is-dragging" : ""}`}
            onDragOver={(event) => {
              if (shared) return;
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setIsDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setIsDragging(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              if (shared) return;
              if (event.dataTransfer.files.length > 0) {
                void upload(event.dataTransfer.files);
              }
            }}
          >
            <div
              className={`fm-list-scroll${visibleItemsPage.length === 0 && !folderId ? " is-empty" : ""}`}
            >
              <div className="fm-table-head">
                <span className="fm-row-check">
                  <input
                    type="checkbox"
                    checked={
                      visibleFiles.length > 0 &&
                      visibleFiles.every((file) => selected.has(file.id))
                    }
                    onChange={toggleSelectAll}
                  />
                </span>
                <span>Имя</span>
                <span>Размер</span>
                <span>Загружен</span>
                <span>Доступ</span>
                <span />
              </div>
              {visibleItemsPage.length === 0 && !folderId ? (
                <EmptyFilesState
                  onUpload={() => uploadRef.current?.click()}
                  readOnly={shared}
                />
              ) : (
                <>
                  {folderId && (
                    <div
                      className={`fm-up-row${dragOverFolderId === "root" ? " is-drop-target" : ""}`}
                      onDragOver={(event) => {
                        if (!event.dataTransfer.types.includes("file-id"))
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = "move";
                        setDragOverFolderId("root");
                      }}
                      onDragLeave={() => setDragOverFolderId(null)}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const fileId = event.dataTransfer.getData("file-id");
                        if (fileId) void moveFile(fileId, null);
                        else setDragOverFolderId(null);
                      }}
                    >
                      <span className="fm-row-check" />
                      <button
                        type="button"
                        className=" fm-file-name fm-folder-name fm-up-name"
                        onClick={() => setFolderId(null)}
                      >
                        <img
                          className="fm-folder-mark"
                          src={folderIcon}
                          alt=""
                        />
                        <span className="fm-file-meta">
                          <strong>..</strong>
                        </span>
                      </button>
                      <span />
                      <span />
                      <span />
                      <div className="fm-row-actions fm-up-actions"></div>
                    </div>
                  )}
                  {visibleItemsPage.length === 0 && (
                    <EmptyFilesState
                      onUpload={() => uploadRef.current?.click()}
                      readOnly={shared}
                    />
                  )}
                  {visibleItemsPage.map((entry) => {
                    if (entry.type === "folder") {
                      const item = entry.item;
                      return (
                        <ContextMenu
                          customActions={[
                            {
                              key: "open",
                              label: "Открыть",
                              icon: folderIcon,
                              onClick: () => setFolderId(item.id),
                            },
                            {
                              key: "rename",
                              label: "Переименовать",
                              onClick: () =>
                                startRename({ type: "folder", item }),
                            },
                            {
                              key: "share",
                              label: "Поделиться",
                              icon: copyIcon,
                              onClick: () =>
                                void copyShareUrl(
                                  `${window.location.origin}/files/gallery/${item.id}`,
                                ),
                            },
                            {
                              key: "toggle-visibility",
                              label:
                                item.accessLevel === 2
                                  ? "Скрыть галерею"
                                  : "Открыть галерею",
                              icon: downloadIcon,
                              onClick: () => void toggleFolder(item),
                            },
                            {
                              key: "delete",
                              label: "Удалить",
                              icon: deleteIcon,
                              danger: true,
                              onClick: () => void removeFolder(item),
                            },
                          ]}
                        >
                          <div
                            className={`fm-file-row fm-folder-row${dragOverFolderId === item.id ? " is-drop-target" : ""}`}
                            key={item.id}
                            onDragOver={(event) => {
                              if (!event.dataTransfer.types.includes("file-id"))
                                return;
                              event.preventDefault();
                              event.stopPropagation();
                              event.dataTransfer.dropEffect = "move";
                              setDragOverFolderId(item.id);
                            }}
                            onDragLeave={() => setDragOverFolderId(null)}
                            onDrop={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const fileId =
                                event.dataTransfer.getData("file-id");
                              if (fileId) void moveFile(fileId, item.id);
                              else setDragOverFolderId(null);
                            }}
                          >
                            <span className="fm-row-check" />
                            <div className="fm-file-name fm-folder-name">
                              <img
                                className="fm-folder-mark"
                                src={folderIcon}
                                alt=""
                              />
                              <span className="fm-file-meta">
                                {renameTarget?.type === "folder" &&
                                renameTarget.item.id === item.id ? (
                                  <InlineRenameInput
                                    value={renameName}
                                    onChange={setRenameName}
                                    onConfirm={confirmRename}
                                    onCancel={() => setRenameTarget(null)}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className="fm-folder-name"
                                    onClick={() => setFolderId(item.id)}
                                  >
                                    <strong>{item.name}</strong>
                                  </button>
                                )}
                                <small>{item.fileCount} файлов</small>
                              </span>
                            </div>
                            <span className="fm-cell"></span>
                            <span className="fm-cell">
                              {new Date(item.createdAt).toLocaleDateString(
                                "ru-RU",
                              )}
                            </span>
                            <ContextMenu
                              triggerPlacement="left"
                              customActions={[
                                {
                                  key: "public",
                                  label: "Сделать публичным",
                                  disabled: item.accessLevel === 2,
                                  onClick: () => void setFolderAccess(item, 2),
                                },
                                {
                                  key: "authenticated",
                                  label: "Только авторизованным",
                                  disabled: item.accessLevel === 1,
                                  onClick: () => void setFolderAccess(item, 1),
                                },
                                {
                                  key: "private",
                                  label: "Сделать приватным",
                                  disabled: item.accessLevel === 0,
                                  onClick: () => void setFolderAccess(item, 0),
                                },
                              ]}
                            >
                              <button
                                type="button"
                                className={`btn btn-ghost fm-badge fm-visibility${item.accessLevel === 2 ? " public" : ""}`}
                                data-context-menu-trigger="true"
                                aria-label={`Доступ папки ${item.name}`}
                              >
                                {accessLabel(item.accessLevel)}
                              </button>
                            </ContextMenu>
                            <div className="fm-row-actions">
                              <ContextMenu
                                triggerPlacement="left"
                                customActions={[
                                  {
                                    key: "open",
                                    label: "Открыть",
                                    icon: folderIcon,
                                    onClick: () => setFolderId(item.id),
                                  },
                                  {
                                    key: "rename",
                                    label: "Переименовать",
                                    onClick: () =>
                                      startRename({ type: "folder", item }),
                                  },
                                  {
                                    key: "share",
                                    label: "Поделиться",
                                    icon: copyIcon,
                                    onClick: () =>
                                      void copyShareUrl(
                                        `${window.location.origin}/files/gallery/${item.id}`,
                                      ),
                                  },
                                  {
                                    key: "toggle-visibility",
                                    label:
                                      item.accessLevel === 2
                                        ? "Скрыть галерею"
                                        : "Открыть галерею",
                                    icon: downloadIcon,
                                    onClick: () => void toggleFolder(item),
                                  },
                                  {
                                    key: "delete",
                                    label: "Удалить",
                                    icon: deleteIcon,
                                    danger: true,
                                    onClick: () => void removeFolder(item),
                                  },
                                ]}
                              >
                                <button
                                  type="button"
                                  className="btn btn-icon fm-more-btn"
                                  data-context-menu-trigger="true"
                                  aria-label={`Действия для папки ${item.name}`}
                                >
                                  <svg viewBox="0 0 20 20" fill="none">
                                    <circle
                                      cx="5"
                                      cy="10"
                                      r="1.4"
                                      fill="currentColor"
                                    />
                                    <circle
                                      cx="10"
                                      cy="10"
                                      r="1.4"
                                      fill="currentColor"
                                    />
                                    <circle
                                      cx="15"
                                      cy="10"
                                      r="1.4"
                                      fill="currentColor"
                                    />
                                  </svg>
                                </button>
                              </ContextMenu>
                            </div>
                          </div>
                        </ContextMenu>
                      );
                    }

                    const file = entry.item;
                    return (
                      <ContextMenu
                        customActions={[
                          {
                            key: "open",
                            label: "Открыть",
                            icon: downloadIcon,
                            ...(isVideo(file) || isAudio(file)
                              ? { onClick: () => void openMedia(file) }
                              : {
                                  href: `${window.location.origin}/files/file/${file.id}`,
                                }),
                          },
                          {
                            key: "rename",
                            label: "Переименовать",
                            onClick: () =>
                              startRename({ type: "file", item: file }),
                          },
                          {
                            key: "share",
                            label: "Поделиться",
                            icon: copyIcon,
                            onClick: () =>
                              void copyShareUrl(
                                `${window.location.origin}/files/file/${file.id}`,
                              ),
                          },
                          {
                            key: "toggle-visibility",
                            label:
                              file.accessLevel === 2
                                ? "Сделать приватным"
                                : "Сделать публичным",
                            icon: downloadIcon,
                            onClick: () => void toggleFile(file),
                          },
                          {
                            key: "delete",
                            label: "Удалить",
                            icon: deleteIcon,
                            danger: true,
                            onClick: () =>
                              setPendingDelete({ type: "file", item: file }),
                          },
                        ]}
                      >
                        <div
                          className={`fm-file-row${selected.has(file.id) ? " is-selected" : ""}`}
                          key={file.id}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData("file-id", file.id);
                            event.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => setDragOverFolderId(null)}
                        >
                          <span className="fm-row-check">
                            <input
                              type="checkbox"
                              checked={selected.has(file.id)}
                              onChange={() => toggleSelected(file.id)}
                            />
                          </span>

                          {isImage(file) ? (
                            <ImageFilePreview
                              file={file}
                              isRenaming={
                                renameTarget?.type === "file" &&
                                renameTarget.item.id === file.id
                              }
                              renameName={renameName}
                              onRenameChange={setRenameName}
                              onConfirmRename={confirmRename}
                              onCancelRename={() => setRenameTarget(null)}
                            />
                          ) : isVideo(file) || isAudio(file) ? (
                            <button
                              type="button"
                              className=" fm-file-name fm-image-file-name"
                              onClick={() => void openMedia(file)}
                            >
                              <span className="fm-file-avatar">
                                {isVideo(file) ? "VID" : "AUD"}
                              </span>
                              <span className="fm-file-meta">
                                {renameTarget?.type === "file" &&
                                renameTarget.item.id === file.id ? (
                                  <InlineRenameInput
                                    value={renameName}
                                    onChange={setRenameName}
                                    onConfirm={confirmRename}
                                    onCancel={() => setRenameTarget(null)}
                                  />
                                ) : (
                                  <strong>{file.fileName}</strong>
                                )}
                                <small>
                                  {file.fileName
                                    .split(".")
                                    .pop()
                                    ?.toUpperCase()}
                                </small>
                              </span>
                            </button>
                          ) : (
                            <div className="fm-file-name">
                              <span className="fm-file-avatar">
                                {fileInitials(file.fileName)}
                              </span>
                              <div className="fm-file-meta">
                                {renameTarget?.type === "file" &&
                                renameTarget.item.id === file.id ? (
                                  <InlineRenameInput
                                    value={renameName}
                                    onChange={setRenameName}
                                    onConfirm={confirmRename}
                                    onCancel={() => setRenameTarget(null)}
                                  />
                                ) : (
                                  <strong>{file.fileName}</strong>
                                )}
                                <small>
                                  {file.fileName
                                    .split(".")
                                    .pop()
                                    ?.toUpperCase()}
                                </small>
                              </div>
                            </div>
                          )}

                          <span className="fm-cell">
                            {formatSize(file.sizeBytes)}
                          </span>
                          <span className="fm-cell">
                            {new Date(file.uploadedAt).toLocaleDateString(
                              "ru-RU",
                            )}
                          </span>

                          <ContextMenu
                            triggerPlacement="left"
                            customActions={[
                              {
                                key: "public",
                                label: "Сделать публичным",
                                disabled: file.accessLevel === 2,
                                onClick: () => void setFileAccess(file, 2),
                              },
                              {
                                key: "authenticated",
                                label: "Только авторизованным",
                                disabled: file.accessLevel === 1,
                                onClick: () => void setFileAccess(file, 1),
                              },
                              {
                                key: "private",
                                label: "Сделать приватным",
                                disabled: file.accessLevel === 0,
                                onClick: () => void setFileAccess(file, 0),
                              },
                            ]}
                          >
                            <button
                              type="button"
                              className={`btn btn-ghost fm-badge${file.accessLevel === 2 ? " public" : ""}`}
                              data-context-menu-trigger="true"
                              aria-label={`Доступ файла ${file.fileName}`}
                            >
                              {accessLabel(file.accessLevel)}
                            </button>
                          </ContextMenu>

                          <div className="fm-row-actions">
                            <ContextMenu
                              triggerPlacement="left"
                              customActions={[
                                {
                                  key: "open",
                                  label: "Открыть",
                                  icon: downloadIcon,
                                  ...(isVideo(file) || isAudio(file)
                                    ? { onClick: () => openMedia(file) }
                                    : {
                                        href: `${window.location.origin}/files/file/${file.id}`,
                                      }),
                                },
                                {
                                  key: "rename",
                                  label: "Переименовать",
                                  onClick: () =>
                                    startRename({ type: "file", item: file }),
                                },
                                {
                                  key: "share",
                                  label: "Поделиться",
                                  icon: copyIcon,
                                  onClick: () =>
                                    void copyShareUrl(
                                      `${window.location.origin}/files/file/${file.id}`,
                                    ),
                                },
                                {
                                  key: "toggle-visibility",
                                  label:
                                    file.accessLevel === 2
                                      ? "Сделать приватным"
                                      : "Сделать публичным",
                                  icon: downloadIcon,
                                  onClick: () => void toggleFile(file),
                                },
                                {
                                  key: "delete",
                                  label: "Удалить",
                                  icon: deleteIcon,
                                  danger: true,
                                  onClick: () =>
                                    setPendingDelete({
                                      type: "file",
                                      item: file,
                                    }),
                                },
                              ]}
                            >
                              <button
                                type="button"
                                className="btn btn-icon fm-more-btn"
                                data-context-menu-trigger="true"
                                aria-label={`Действия для ${file.fileName}`}
                              >
                                <svg viewBox="0 0 20 20" fill="none">
                                  <circle
                                    cx="5"
                                    cy="10"
                                    r="1.4"
                                    fill="currentColor"
                                  />
                                  <circle
                                    cx="10"
                                    cy="10"
                                    r="1.4"
                                    fill="currentColor"
                                  />
                                  <circle
                                    cx="15"
                                    cy="10"
                                    r="1.4"
                                    fill="currentColor"
                                  />
                                </svg>
                              </button>
                            </ContextMenu>
                          </div>
                        </div>
                      </ContextMenu>
                    );
                  })}
                </>
              )}
            </div>

            {/* ---------- Footer: "Showing X-Y of Z" + numbered pagination ---------- */}
            <div className="fm-table-footer">
              <span className="fm-table-footer-text">
                {visibleItems.length === 0
                  ? "Файлы не найдены"
                  : `Показано ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, visibleItems.length)} из ${visibleItems.length}`}
              </span>
              <div className="fm-pagination">
                <button
                  className="btn btn-ghost btn-sm fm-page-nav"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Назад
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1)
                  .filter(
                    (n) =>
                      n === 1 || n === pageCount || Math.abs(n - page) <= 1,
                  )
                  .reduce<(number | "ellipsis")[]>((acc, n) => {
                    if (
                      acc.length > 0 &&
                      acc[acc.length - 1] !== "ellipsis" &&
                      (n as number) - (acc[acc.length - 1] as number) > 1
                    )
                      acc.push("ellipsis");
                    acc.push(n);
                    return acc;
                  }, [])
                  .map((n, idx) =>
                    n === "ellipsis" ? (
                      <span className="fm-page-ellipsis" key={`e${idx}`}>
                        …
                      </span>
                    ) : (
                      <button
                        className={`btn btn-ghost fm-page-btn${page === n ? " is-active" : ""}`}
                        key={n}
                        onClick={() => setPage(n)}
                      >
                        {n}
                      </button>
                    ),
                  )}
                <button
                  className="btn btn-ghost btn-sm fm-page-nav"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page === pageCount}
                >
                  Далее
                </button>
              </div>
            </div>
          </section>
        </main>
      </ContextMenu>

      {activeMedia && (
        <MediaModal
          type={activeMedia.type}
          name={activeMedia.name}
          url={activeMedia.url}
          onClose={() => setActiveMedia(null)}
        />
      )}

      <AlertDialog
        open={pendingDelete !== null}
        title={
          pendingDelete?.type === "folder"
            ? "Удалить папку?"
            : pendingDelete?.type === "file"
              ? "Удалить файл?"
              : "Удалить выбранные файлы?"
        }
        description={
          pendingDelete?.type === "folder"
            ? `Папка «${pendingDelete.item.name}» и все файлы внутри будут удалены. Это действие нельзя отменить.`
            : pendingDelete?.type === "file"
              ? `Файл «${pendingDelete.item.fileName}» будет удалён. Это действие нельзя отменить.`
              : `Будет удалено файлов: ${pendingDelete?.ids.length ?? 0}. Это действие нельзя отменить.`
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />

      {uploadProgress && (
        <div className="fm-modal-backdrop fm-upload-backdrop">
          <div
            className="fm-modal fm-upload-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-progress-title"
          >
            <h2 id="upload-progress-title">Загрузка файлов</h2>
            <p className="fm-upload-status">
              {uploadProgress.completed} из {uploadProgress.total} загружено
            </p>
            <p className="fm-upload-file" title={uploadProgress.currentFile}>
              {uploadProgress.currentFile}
            </p>
            <div
              className="fm-upload-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadProgress.percent}
            >
              <span style={{ width: `${uploadProgress.percent}%` }} />
            </div>
            <strong className="fm-upload-percent">
              {uploadProgress.percent}%
            </strong>
          </div>
        </div>
      )}

      {folderDialog && (
        <div
          className="fm-modal-backdrop"
          onClick={() => setFolderDialog(false)}
        >
          <div
            className="fm-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Новая папка</h2>
            <input
              autoFocus
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              onKeyDown={(event) =>
                event.key === "Enter" && void createFolder()
              }
              placeholder="Например, фотографии"
            />
            <div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setFolderDialog(false)}
              >
                Отмена
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void createFolder()}
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
