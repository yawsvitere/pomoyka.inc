import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { PhotoSlider } from "react-photo-view";
import * as filesApi from "../api/files";
import { ContextMenu } from "../components/feed/ContextMenu";
import { AlertDialog } from "../components/ui/AlertDialog";
import { MediaModal } from "../components/ui/MediaModal";
import { useToast } from "../components/ui/useToast";
import copyIcon from "../assets/icons/copy.svg";
import deleteIcon from "../assets/icons/delete.svg";
import downloadIcon from "../assets/icons/download.svg";
import filterIcon from "../assets/icons/filter.svg";
import folderIcon from "../assets/icons/folder.svg";
import searchIcon from "../assets/icons/search.svg";
import { getBrowserFileUrl } from "../utils/fileUrl";
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

type FileKind = "image" | "video" | "audio" | "other";

function fileKind(file: filesApi.UserFile): FileKind {
  if (isImage(file)) return "image";
  if (isVideo(file)) return "video";
  if (isAudio(file)) return "audio";
  return "other";
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
  filtered = false,
  onReset,
}: {
  onUpload: () => void;
  readOnly?: boolean;
  filtered?: boolean;
  onReset?: () => void;
}) {
  if (filtered) {
    return (
      <div className="fm-empty-state">
        <div className="fm-empty-state-icon">
          <img src={searchIcon} alt="" />
        </div>
        <strong>Ничего не найдено</strong>
        <p>Попробуйте изменить запрос или сбросить фильтр.</p>
        <div className="fm-empty-state-actions">
          <button type="button" className="btn btn-secondary" onClick={onReset}>
            Сбросить
          </button>
        </div>
      </div>
    );
  }
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
  const [isHoverPreviewVisible, setIsHoverPreviewVisible] = useState(false);
  const [hoverPreviewPosition, setHoverPreviewPosition] = useState({
    left: 0,
    top: 0,
  });
  const hoverPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  useEffect(() => {
    return () => {
      if (hoverPreviewTimer.current) {
        clearTimeout(hoverPreviewTimer.current);
      }
    };
  }, []);

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

  function showHoverPreview(event: MouseEvent<HTMLButtonElement>) {
    if (!file.previewUrl || isRenaming) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const previewWidth = 288;
    const previewHeight = 260;

    setHoverPreviewPosition({
      left: Math.max(
        12,
        Math.min(
          bounds.left,
          window.innerWidth - previewWidth - 12,
        ),
      ),
      top: Math.max(12, bounds.top - previewHeight - 12),
    });
    hoverPreviewTimer.current = setTimeout(
      () => setIsHoverPreviewVisible(true),
      500,
    );
  }

  function hideHoverPreview() {
    if (hoverPreviewTimer.current) {
      clearTimeout(hoverPreviewTimer.current);
      hoverPreviewTimer.current = null;
    }
    setIsHoverPreviewVisible(false);
  }

  const content = (
    <>
      {file.iconPreviewUrl ? (
        <img
          className="fm-image-preview"
          src={file.iconPreviewUrl}
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
      onMouseEnter={showHoverPreview}
      onMouseLeave={hideHoverPreview}
      disabled={isLoading}
    >
      {content}
    </button>
  );

  return (
    <>
      {fileNameControl}
      {isHoverPreviewVisible &&
        file.previewUrl &&
        createPortal(
          <div
            className="fm-hover-image-preview"
            style={hoverPreviewPosition}
            aria-hidden="true"
          >
            <img src={file.previewUrl} alt="" />
            <span>{file.fileName}</span>
          </div>,
          document.body,
        )}
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

const accessOptions: {
  level: filesApi.FileAccessLevel;
  label: string;
  hint: string;
}[] = [
  { level: 2, label: "Публичный", hint: "Доступен всем" },
  { level: 1, label: "Братва", hint: "Только авторизованным" },
  { level: 0, label: "Приватный", hint: "Только вам" },
];

type SortKey = "name" | "size" | "date";
type SortDir = "asc" | "desc";

const kindLabels: Record<FileKind, string> = {
  image: "Фото",
  video: "Видео",
  audio: "Аудио",
  other: "Другое",
};

export function FileManagerPage({ shared = false }: { shared?: boolean }) {
  const { notify } = useToast();
  const [library, setLibrary] = useState<filesApi.Library>({
    folders: [],
    files: [],
  });
  const [quota, setQuota] = useState<filesApi.StorageQuota | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [fileFilter, setFileFilter] = useState<FileFilter>("all");
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [isAccessMenuOpen, setIsAccessMenuOpen] = useState(false);
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
  const lastSelectedRef = useRef<string | null>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const accessMenuRef = useRef<HTMLDivElement>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [isBulkBusy, setIsBulkBusy] = useState(false);

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
      return true;
    } catch {
      notify("error", "Не удалось загрузить файловую библиотеку");
      return false;
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

  const scopedFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return library.files.filter(
      (file) =>
        (folderId ? file.folderId === folderId : !file.folderId) &&
        file.fileName.toLowerCase().includes(query),
    );
  }, [folderId, library.files, search]);

  const filteredFiles = useMemo(() => {
    const list =
      fileFilter === "all"
        ? scopedFiles
        : scopedFiles.filter((file) => fileKind(file) === fileFilter);
    if (!sortKey) return list;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === "size") return (a.sizeBytes - b.sizeBytes) * dir;
      if (sortKey === "date") {
        return (
          (new Date(a.uploadedAt).getTime() -
            new Date(b.uploadedAt).getTime()) *
          dir
        );
      }
      return (
        a.fileName.localeCompare(b.fileName, "ru", {
          numeric: true,
          sensitivity: "base",
        }) * dir
      );
    });
  }, [fileFilter, scopedFiles, sortDir, sortKey]);

  const filteredFolders = useMemo(() => {
    if (folderId) return [];
    const query = search.trim().toLowerCase();
    const list = library.folders.filter((item) =>
      item.name.toLowerCase().includes(query),
    );
    if (!sortKey || sortKey === "size") return list;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) =>
      sortKey === "date"
        ? (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) *
          dir
        : a.name.localeCompare(b.name, "ru", {
            numeric: true,
            sensitivity: "base",
          }) * dir,
    );
  }, [folderId, library.folders, search, sortDir, sortKey]);

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

  const allFileIds = useMemo(
    () => filteredFiles.map((file) => file.id),
    [filteredFiles],
  );
  const selectedInScope = useMemo(
    () => allFileIds.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0),
    [allFileIds, selected],
  );
  const allSelected =
    allFileIds.length > 0 && selectedInScope === allFileIds.length;
  const someSelected = selectedInScope > 0 && !allSelected;
  const isFiltered = search.trim() !== "" || fileFilter !== "all";

  const quotaTotal = quota ? Math.max(quota.quotaBytes, 1) : 1;
  const quotaUsed = quota?.usedBytes ?? 0;
  const quotaFree = Math.max(0, quotaTotal - quotaUsed);
  const quotaTone =
    quotaPercent >= 95 ? " is-danger" : quotaPercent >= 80 ? " is-warning" : "";
  const storageSegments = useMemo(() => {
    const sums: Record<FileKind, number> = {
      image: 0,
      video: 0,
      audio: 0,
      other: 0,
    };
    for (const file of library.files) sums[fileKind(file)] += file.sizeBytes;
    const total = Object.values(sums).reduce((a, b) => a + b, 0);
    const scale = total > quotaTotal ? quotaTotal / total : 1;
    return (Object.keys(sums) as FileKind[])
      .map((kind) => ({
        kind,
        bytes: sums[kind],
        percent: (sums[kind] * scale * 100) / quotaTotal,
      }))
      .filter((segment) => segment.bytes > 0);
  }, [library.files, quotaTotal]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
    lastSelectedRef.current = null;
  }, [folderId, search, fileFilter]);

  useEffect(() => {
    setPage(1);
  }, [sortKey, sortDir]);

  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const existing = new Set(library.files.map((file) => file.id));
      const next = new Set([...current].filter((id) => existing.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [library.files]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        ((target.tagName === "INPUT" &&
          (target as HTMLInputElement).type !== "checkbox") ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (
        typing ||
        pendingDelete ||
        folderDialog ||
        renameTarget ||
        uploadProgress
      )
        return;
      if (event.key === "Escape" && selected.size > 0) {
        setSelected(new Set());
        lastSelectedRef.current = null;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "a" &&
        allFileIds.length > 0
      ) {
        event.preventDefault();
        setSelected(new Set(allFileIds));
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    allFileIds,
    folderDialog,
    pendingDelete,
    renameTarget,
    selected.size,
    uploadProgress,
  ]);

  async function upload(files: FileList | File[]) {
    const uploadFiles = Array.from(files);
    if (uploadFiles.length === 0) return;
    setUploadProgress({
      currentFile: uploadFiles[0].name,
      completed: 0,
      total: uploadFiles.length,
      percent: 0,
    });
    try {
      const fileProgress = uploadFiles.map(() => 0);
      const preparedUploads = await filesApi.prepareLibraryUploads(
        uploadFiles,
        folderId,
      );
      const successfullyUploaded: filesApi.PreparedLibraryUpload[] = [];
      let nextFileIndex = 0;
      let completed = 0;
      const updateProgress = (currentFile: string) => {
        setUploadProgress({
          currentFile,
          completed,
          total: uploadFiles.length,
          percent: Math.round(
            fileProgress.reduce((total, progress) => total + progress, 0) /
              uploadFiles.length,
          ),
        });
      };
      const uploadWorker = async () => {
        while (nextFileIndex < uploadFiles.length) {
          const index = nextFileIndex;
          nextFileIndex += 1;
          const upload = preparedUploads[index];
          updateProgress(upload.file.name);
          await filesApi.uploadLibraryFileDirect(upload, (filePercent) => {
            fileProgress[index] = filePercent;
            updateProgress(upload.file.name);
          });
          successfullyUploaded.push(upload);
          fileProgress[index] = 100;
          completed += 1;
          updateProgress(upload.file.name);
        }
      };
      const results = await Promise.allSettled(
        Array.from({ length: Math.min(3, uploadFiles.length) }, () =>
          uploadWorker(),
        ),
      );
      const failedUpload = results.find(
        (result) => result.status === "rejected",
      );
      if (successfullyUploaded.length > 0)
        await filesApi.completeLibraryUploads(folderId, successfullyUploaded);
      if (successfullyUploaded.length > 0) await reload();
      if (failedUpload?.status === "rejected") {
        throw failedUpload.reason;
      }
      if (successfullyUploaded.length > 0) {
        notify(
          "success",
          uploadFiles.length === 1
            ? "Файл загружен"
            : `Загружено файлов: ${uploadFiles.length}`,
        );
      }
    } catch (reason: any) {
      notify(
        "error",
        reason?.response?.data?.message ?? "Не удалось загрузить файл",
      );
    } finally {
      setUploadProgress(null);
    }
  }
  async function pasteImagesFromClipboard() {
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
        notify("error", "В буфере обмена нет изображения");
        return;
      }
      await upload(pastedFiles);
    } catch {
      notify("error", "Не удалось вставить изображение из буфера обмена");
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

  useEffect(() => {
    if (!isAccessMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!accessMenuRef.current?.contains(event.target as Node)) {
        setIsAccessMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isAccessMenuOpen]);

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
      notify("success", "Папка создана");
    } catch (reason: any) {
      notify(
        "error",
        reason?.response?.data?.message ?? "Не удалось создать папку",
      );
    }
  }
  async function setFileAccess(
    file: filesApi.UserFile,
    accessLevel: filesApi.FileAccessLevel,
  ) {
    try {
      const updated = await filesApi.setFileVisibility(file.id, accessLevel);
      setLibrary((current) => ({
        ...current,
        files: current.files.map((item) =>
          item.id === file.id ? updated : item,
        ),
      }));
    } catch (reason: any) {
      notify(
        "error",
        reason?.response?.data?.message ?? "Не удалось изменить доступ",
      );
    }
  }
  async function toggleFile(file: filesApi.UserFile) {
    await setFileAccess(file, file.accessLevel === 2 ? 0 : 2);
  }
  async function setFolderAccess(
    item: filesApi.FileFolder,
    accessLevel: filesApi.FileAccessLevel,
  ) {
    try {
      await filesApi.setFolderVisibility(item.id, accessLevel);
      setLibrary((current) => ({
        ...current,
        folders: current.folders.map((folderItem) =>
          folderItem.id === item.id
            ? { ...folderItem, accessLevel }
            : folderItem,
        ),
      }));
    } catch (reason: any) {
      notify(
        "error",
        reason?.response?.data?.message ?? "Не удалось изменить доступ",
      );
    }
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
      notify("error", "Не удалось открыть файл");
    }
  }
  async function downloadFile(file: filesApi.UserFile) {
    try {
      const url = await filesApi.getAuthenticatedFileUrl(file.downloadUrl);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      notify("error", "Не удалось скачать файл");
    }
  }
  async function copyShareUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      notify("success", "Ссылка скопирована");
    } catch {
      notify("error", "Не удалось скопировать ссылку");
    }
  }
  async function moveFile(fileId: string, targetFolderId: string | null) {
    setDragOverFolderId(null);
    try {
      await filesApi.moveFile(fileId, targetFolderId);
      if (await reload()) notify("success", "Файл перемещён");
    } catch (reason: any) {
      notify(
        "error",
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
    try {
      if (renameTarget.type === "folder") {
        await filesApi.renameFolder(renameTarget.item.id, renameName);
      } else {
        await filesApi.renameFile(renameTarget.item.id, renameName);
      }
      setRenameTarget(null);
      setRenameName("");
      if (await reload()) {
        notify(
          "success",
          renameTarget.type === "folder"
            ? "Папка переименована"
            : "Файл переименован",
        );
      }
    } catch (reason: any) {
      notify(
        "error",
        reason?.response?.data?.message ?? "Не удалось переименовать",
      );
    }
  }
  async function confirmDelete() {
    const action = pendingDelete;
    setPendingDelete(null);
    if (!action) return;
    try {
      if (action.type === "folder") {
        await filesApi.deleteFolder(action.item.id);
        if (folderId === action.item.id) setFolderId(null);
      } else if (action.type === "file") {
        await filesApi.deleteFile(action.item.id);
      } else {
        setIsBulkBusy(true);
        try {
          await filesApi.deleteFiles(action.ids);
        } finally {
          setIsBulkBusy(false);
        }
        setSelected(new Set());
      }
      if (await reload()) {
        notify(
          "success",
          action.type === "folder"
            ? "Папка удалена"
            : action.type === "file"
              ? "Файл удалён"
              : "Файлы удалены",
        );
      }
    } catch (reason: any) {
      notify(
        "error",
        reason?.response?.data?.message ??
          (action.type === "folder"
            ? "Не удалось удалить папку"
            : "Не удалось удалить файлы"),
      );
    }
  }
  async function bulkSetVisibility(accessLevel: filesApi.FileAccessLevel) {
    if (isBulkBusy || selected.size === 0) return;
    const ids = [...selected];
    setIsBulkBusy(true);
    try {
      await filesApi.setFilesVisibility(ids, accessLevel);
      await reload();
      clearSelection();
    } catch (reason: any) {
      notify(
        "error",
        reason?.response?.data?.message ?? "Не удалось изменить доступ у файлов",
      );
    } finally {
      setIsBulkBusy(false);
    }
  }
  function bulkDownload() {
    if (isBulkBusy) return;
    const selectedFiles = library.files.filter((file) => selected.has(file.id));
    for (const file of selectedFiles) {
      const link = document.createElement("a");
      link.href = getBrowserFileUrl(file.downloadUrl);
      link.download = file.fileName;
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  }
  async function bulkDownloadArchive() {
    if (isBulkBusy || selected.size === 0) return;
    setIsBulkBusy(true);
    try {
      const blob = await filesApi.downloadFilesArchive(
        allFileIds.filter((id) => selected.has(id)),
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `files-${new Date().toISOString().slice(0, 10)}.7z`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      notify("error", "Не удалось скачать архив");
    } finally {
      setIsBulkBusy(false);
    }
  }
  async function downloadFolderArchive(item: filesApi.FileFolder) {
    if (isBulkBusy) return;
    setIsBulkBusy(true);
    try {
      const blob = await filesApi.downloadFolderArchive(item.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${item.name}.7z`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      notify("error", "Не удалось скачать архив папки");
    } finally {
      setIsBulkBusy(false);
    }
  }
  function bulkDelete() {
    setPendingDelete({ type: "files", ids: [...selected] });
  }

  function clearSelection() {
    setIsAccessMenuOpen(false);
    setSelected(new Set());
    lastSelectedRef.current = null;
  }
  function selectAllFiles() {
    setSelected(new Set(allFileIds));
  }
  function toggleSelectAll() {
    if (allSelected) clearSelection();
    else selectAllFiles();
  }
  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleRowCheck(
    event: React.MouseEvent<HTMLInputElement>,
    id: string,
  ) {
    const checked = event.currentTarget.checked;
    const anchor = lastSelectedRef.current;
    if (event.shiftKey && anchor && anchor !== id) {
      const a = allFileIds.indexOf(anchor);
      const b = allFileIds.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelected((current) => {
          const next = new Set(current);
          for (const rangeId of allFileIds.slice(from, to + 1)) {
            if (checked) next.add(rangeId);
            else next.delete(rangeId);
          }
          return next;
        });
        lastSelectedRef.current = id;
        return;
      }
    }
    toggleSelected(id);
    lastSelectedRef.current = id;
  }

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    } else if (sortDir === "desc" && key !== "name") {
      setSortDir("asc");
    } else if (sortDir === "asc" && key === "name") {
      setSortDir("desc");
    } else {
      setSortKey(null);
    }
  }
  const sortHead = (key: SortKey, label: string) => (
    <button
      type="button"
      className={`fm-sort-btn${sortKey === key ? " is-active" : ""}`}
      onClick={() => toggleSort(key)}
      aria-label={`Сортировать: ${label}`}
    >
      {label}
      <span className="fm-sort-arrow" aria-hidden="true">
        {sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </span>
    </button>
  );

  const emptyState = (
    <EmptyFilesState
      onUpload={() => uploadRef.current?.click()}
      readOnly={shared}
      filtered={isFiltered}
      onReset={() => {
        setSearch("");
        setFileFilter("all");
      }}
    />
  );

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
            <section className={`fm-storage${quotaTone}`}>
              <div className="fm-storage-head">
                <div className="fm-storage-title">
                  <strong>Хранилище</strong>
                  <span>
                    {quota
                      ? `${formatSize(quotaUsed)} из ${formatSize(quota.quotaBytes)}`
                      : "Загрузка..."}
                  </span>
                </div>
                <span className="fm-storage-percent">
                  {quota ? `${quotaPercent}%` : ""}
                </span>
              </div>
              <div
                className="fm-storage-bar"
                role="progressbar"
                aria-label="Использование хранилища"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={quotaPercent}
              >
                {storageSegments.map((segment) => (
                  <span
                    key={segment.kind}
                    className={`fm-storage-seg is-${segment.kind}`}
                    style={{ width: `${segment.percent}%` }}
                    title={`${kindLabels[segment.kind]}: ${formatSize(segment.bytes)}`}
                  />
                ))}
              </div>
              <div className="fm-storage-legend">
                {storageSegments.map((segment) => (
                  <span key={segment.kind} className="fm-storage-legend-item">
                    <i className={`fm-storage-dot is-${segment.kind}`} />
                    {kindLabels[segment.kind]}
                    <b>{formatSize(segment.bytes)}</b>
                  </span>
                ))}
                {quota && (
                  <span className="fm-storage-free">
                    Свободно {formatSize(quotaFree)}
                  </span>
                )}
              </div>
            </section>
          )}

          {selected.size === 0 && (
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
          )}

          {selected.size > 0 && (
            <div
              className="fm-selection-bar"
              role="toolbar"
              aria-label="Действия с выбранными файлами"
            >
              <button
                type="button"
                className="fm-selection-close"
                onClick={clearSelection}
                aria-label="Снять выделение"
                title="Снять выделение (Esc)"
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="m5 5 10 10M15 5 5 15"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              <div className="fm-selection-info" aria-live="polite">
                <strong>Выбрано: {selected.size}</strong>
                {allFileIds.length > selected.size ? (
                  <button
                    type="button"
                    className="fm-selection-link"
                    onClick={selectAllFiles}
                  >
                    Выбрать все {allFileIds.length}
                  </button>
                ) : allFileIds.length > 1 ? (
                  <span className="fm-selection-note">все файлы</span>
                ) : null}
              </div>

              <span className="fm-selection-divider" aria-hidden="true" />

              <div className="fm-access-menu-wrap" ref={accessMenuRef}>
                <button
                  type="button"
                  className={`btn btn-secondary fm-selection-access${isAccessMenuOpen ? " is-open" : ""}`}
                  disabled={isBulkBusy}
                  aria-haspopup="menu"
                  aria-expanded={isAccessMenuOpen}
                  onClick={() => setIsAccessMenuOpen((open) => !open)}
                >
                  Изменить доступ
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      d="m5.5 8 4.5 4.5L14.5 8"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {isAccessMenuOpen && (
                  <div className="fm-access-menu" role="menu">
                    {accessOptions.map((option) => (
                      <button
                        key={option.level}
                        type="button"
                        role="menuitem"
                        className={`fm-access-option access-${option.level}`}
                        onClick={() => {
                          setIsAccessMenuOpen(false);
                          void bulkSetVisibility(option.level);
                        }}
                      >
                        <i className="fm-access-dot" />
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.hint}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                className="btn btn-secondary fm-selection-download"
                disabled={isBulkBusy}
                onClick={bulkDownload}
              >
                Скачать
              </button>
              <button
                type="button"
                className="btn btn-secondary fm-selection-download"
                disabled={isBulkBusy}
                onClick={() => void bulkDownloadArchive()}
              >
                Скачать архивом (.7z)
              </button>

              <button
                type="button"
                className="btn btn-danger fm-selection-delete"
                disabled={isBulkBusy}
                onClick={bulkDelete}
              >
                <img src={deleteIcon} alt="" aria-hidden="true" />
                Удалить
              </button>
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

          <section
            className={`fm-list${isDragging ? " is-dragging" : ""}${selected.size > 0 ? " has-selection" : ""}`}
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
                    aria-label="Выбрать все файлы"
                    title={
                      allFileIds.length > 0
                        ? `Выбрать все файлы (${allFileIds.length})`
                        : undefined
                    }
                    disabled={allFileIds.length === 0}
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleSelectAll}
                  />
                </span>
                {sortHead("name", "Имя")}
                {sortHead("size", "Размер")}
                {sortHead("date", "Загружен")}
                <span>Доступ</span>
                <span />
              </div>
              {visibleItemsPage.length === 0 && !folderId ? (
                emptyState
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
                  {visibleItemsPage.length === 0 && emptyState}
                  {visibleItemsPage.map((entry) => {
                    if (entry.type === "folder") {
                      const item = entry.item;
                      return (
                        <ContextMenu
                          key={item.id}
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
                                  className: "access-2",
                                  disabled: item.accessLevel === 2,
                                  onClick: () => void setFolderAccess(item, 2),
                                },
                                {
                                  key: "authenticated",
                                  label: "Только авторизованным",
                                  className: "access-1",
                                  disabled: item.accessLevel === 1,
                                  onClick: () => void setFolderAccess(item, 1),
                                },
                                {
                                  key: "private",
                                  label: "Сделать приватным",
                                  className: "access-0",
                                  disabled: item.accessLevel === 0,
                                  onClick: () => void setFolderAccess(item, 0),
                                },
                              ]}
                            >
                              <button
                                type="button"
                                className={`btn btn-ghost fm-badge fm-visibility access-${item.accessLevel}`}
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
                                  ...(item.id !==
                                  "00000000-0000-0000-0000-000000000000"
                                    ? [
                                        {
                                          key: "download-archive",
                                          label: "Скачать архивом (.7z)",
                                          icon: downloadIcon,
                                          onClick: () =>
                                            downloadFolderArchive(item),
                                        },
                                      ]
                                    : []),
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
                        key={file.id}
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
                            key: "download",
                            label: "Скачать",
                            icon: downloadIcon,
                            onClick: () => downloadFile(file),
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
                              aria-label={`Выбрать ${file.fileName}`}
                              checked={selected.has(file.id)}
                              onClick={(event) =>
                                handleRowCheck(event, file.id)
                              }
                              onChange={() => undefined}
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
                                className: "access-2",
                                disabled: file.accessLevel === 2,
                                onClick: () => void setFileAccess(file, 2),
                              },
                              {
                                key: "authenticated",
                                label: "Только авторизованным",
                                className: "access-1",
                                disabled: file.accessLevel === 1,
                                onClick: () => void setFileAccess(file, 1),
                              },
                              {
                                key: "private",
                                label: "Сделать приватным",
                                className: "access-0",
                                disabled: file.accessLevel === 0,
                                onClick: () => void setFileAccess(file, 0),
                              },
                            ]}
                          >
                            <button
                              type="button"
                              className={`btn btn-ghost fm-badge access-${file.accessLevel}`}
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
                                  key: "download",
                                  label: "Скачать",
                                  icon: downloadIcon,
                                  onClick: () => downloadFile(file),
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

      {uploadProgress &&
        createPortal(
          <div className="fm-modal-backdrop fm-upload-backdrop">
            <div
              className="fm-modal fm-upload-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="upload-progress-title"
            >
              <div className="fm-modal-head">
                <span className="fm-modal-icon fm-modal-icon-spin">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 16V5m0 0-4 4m4-4 4 4M5 19h14"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div className="fm-modal-titles">
                  <h2 id="upload-progress-title">Загрузка файлов</h2>
                  <p className="fm-modal-subtitle">
                    {uploadProgress.completed} из {uploadProgress.total}{" "}
                    загружено
                  </p>
                </div>
                <strong className="fm-upload-percent">
                  {uploadProgress.percent}%
                </strong>
              </div>

              <div
                className="fm-upload-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={uploadProgress.percent}
              >
                <span style={{ width: `${uploadProgress.percent}%` }} />
              </div>

              <div className="fm-upload-current">
                <span className="fm-upload-current-dot" />
                <span
                  className="fm-upload-file"
                  title={uploadProgress.currentFile}
                >
                  {uploadProgress.currentFile}
                </span>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {folderDialog &&
        createPortal(
          <div
            className="fm-modal-backdrop"
            onClick={() => setFolderDialog(false)}
          >
            <div
              className="fm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-folder-title"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) =>
                event.key === "Escape" && setFolderDialog(false)
              }
            >
              <div className="fm-modal-head">
                <span className="fm-modal-icon">
                  <img src={folderIcon} alt="" />
                </span>
                <div className="fm-modal-titles">
                  <h2 id="new-folder-title">Новая папка</h2>
                  <p className="fm-modal-subtitle">
                    Дайте папке понятное название
                  </p>
                </div>
                <button
                  type="button"
                  className="fm-modal-close"
                  aria-label="Закрыть"
                  onClick={() => setFolderDialog(false)}
                >
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      d="m5 5 10 10M15 5 5 15"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <label className="fm-field">
                <span className="fm-field-label">Название</span>
                <input
                  autoFocus
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  onKeyDown={(event) =>
                    event.key === "Enter" && void createFolder()
                  }
                  placeholder="Например, фотографии"
                />
              </label>

              <div className="fm-modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setFolderDialog(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!folderName.trim()}
                  onClick={() => void createFolder()}
                >
                  Создать
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
