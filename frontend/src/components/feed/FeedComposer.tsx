import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "../../context/AuthContext";
import { AppLink } from "../ui/AppLink";

interface FeedComposerProps {
  onSubmit: (text: string, files: File[]) => Promise<void>;
  onError: (message: string) => void;
  children: React.ReactNode;
}

interface StoredFeedDraft {
  key: string;
  text: string;
  files: Array<{
    name: string;
    type: string;
    lastModified: number;
    data: Blob;
  }>;
}

const FEED_DRAFT_DATABASE = "pomoyka-feed-drafts";
const FEED_DRAFT_STORE = "drafts";
let feedDraftDatabase: Promise<IDBDatabase> | null = null;
let feedDraftWriteQueue = Promise.resolve();

function openFeedDraftDatabase() {
  const existingDatabase = feedDraftDatabase;
  if (existingDatabase) return existingDatabase;

  const openingDatabase = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(FEED_DRAFT_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(FEED_DRAFT_STORE)) {
        request.result.createObjectStore(FEED_DRAFT_STORE, {
          keyPath: "key",
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Не удалось открыть хранилище"));
    request.onblocked = () =>
      reject(new Error("Хранилище черновиков заблокировано"));
  });
  const cachedDatabase = openingDatabase.catch((error: unknown) => {
    if (feedDraftDatabase === cachedDatabase) {
      feedDraftDatabase = null;
    }
    throw error;
  });
  feedDraftDatabase = cachedDatabase;
  return cachedDatabase;
}

async function readFeedDraft(key: string) {
  const database = await openFeedDraftDatabase();
  return new Promise<StoredFeedDraft | undefined>((resolve, reject) => {
    const transaction = database.transaction(FEED_DRAFT_STORE, "readonly");
    const request = transaction.objectStore(FEED_DRAFT_STORE).get(key);
    request.onsuccess = () =>
      resolve(request.result as StoredFeedDraft | undefined);
    request.onerror = () =>
      reject(request.error ?? new Error("Не удалось прочитать черновик"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Не удалось прочитать черновик"));
  });
}

async function writeFeedDraft(draft: StoredFeedDraft) {
  const database = await openFeedDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(FEED_DRAFT_STORE, "readwrite");
    transaction.objectStore(FEED_DRAFT_STORE).put(draft);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Не удалось сохранить черновик"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Не удалось сохранить черновик"));
  });
}

async function deleteFeedDraft(key: string) {
  const database = await openFeedDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(FEED_DRAFT_STORE, "readwrite");
    transaction.objectStore(FEED_DRAFT_STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Не удалось удалить черновик"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Не удалось удалить черновик"));
  });
}

function queueFeedDraftWrite(draftKey: string, text: string, files: File[]) {
  const write = feedDraftWriteQueue.then(async () => {
    if (!text && files.length === 0) {
      await deleteFeedDraft(draftKey);
      return;
    }

    await writeFeedDraft({
      key: draftKey,
      text,
      files: files.map((file) => ({
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        data: file,
      })),
    });
  });
  feedDraftWriteQueue = write.catch(() => undefined);
  return write;
}

function getExtension(name: string) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "FILE";
  return name.slice(dot + 1, dot + 5).toUpperCase();
}

function FilePreview({
  file,
  index,
  isSubmitting,
  onRemove,
}: {
  file: File;
  index: number;
  isSubmitting: boolean;
  onRemove: (index: number) => void;
}) {
  const isImage = file.type.startsWith("image/");
  const setImageRef = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image) return;
      const objectUrl = URL.createObjectURL(file);
      image.src = objectUrl;
      return () => URL.revokeObjectURL(objectUrl);
    },
    [file],
  );

  return (
    <li
      className={`composer-preview${isImage ? "" : " composer-preview-file"}`}
      title={file.name}
    >
      {isImage ? (
        <img ref={setImageRef} alt={file.name} />
      ) : (
        <span className="composer-preview-meta">
          <strong>{getExtension(file.name)}</strong>
          <span>{file.name}</span>
        </span>
      )}
      <button
        type="button"
        aria-label={`Удалить ${file.name}`}
        disabled={isSubmitting}
        onClick={() => onRemove(index)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </li>
  );
}

function hasFiles(event: React.DragEvent) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function FeedComposer({
  onSubmit,
  onError,
  children,
}: FeedComposerProps) {
  const { user } = useAuth();
  const draftKey = user ? `feed-composer:${user.id}` : null;
  const [text, setText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const [failedDraftKey, setFailedDraftKey] = useState<string | null>(null);
  const isDraftLoading =
    Boolean(draftKey) &&
    loadedDraftKey !== draftKey &&
    failedDraftKey !== draftKey;
  const onErrorRef = useRef(onError);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const dragDepthRef = useRef(0);

  const canSubmit =
    (text.trim().length > 0 || selectedFiles.length > 0) &&
    !isSubmitting &&
    !isDraftLoading;

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // textarea растёт вместе с текстом (предел задаёт max-height в CSS)
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    let isActive = true;
    if (!draftKey) return;

    void readFeedDraft(draftKey)
      .then((draft) => {
        if (!isActive) return;
        if (draft) {
          if (typeof draft.text !== "string" || !Array.isArray(draft.files)) {
            throw new Error("Сохраненный черновик имеет неверный формат");
          }
          setText(draft.text);
          setSelectedFiles(
            draft.files.map(
              (file) =>
                new File([file.data], file.name, {
                  type: file.type,
                  lastModified: file.lastModified,
                }),
            ),
          );
        } else {
          setText("");
          setSelectedFiles([]);
        }
        setFailedDraftKey(null);
        setLoadedDraftKey(draftKey);
      })
      .catch(() => {
        if (!isActive) return;
        setText("");
        setSelectedFiles([]);
        setFailedDraftKey(draftKey);
        onErrorRef.current("Не удалось загрузить сохраненный черновик.");
      });

    return () => {
      isActive = false;
    };
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey || loadedDraftKey !== draftKey) return;

    void queueFeedDraftWrite(draftKey, text, selectedFiles).catch(() => {
      onErrorRef.current("Не удалось сохранить черновик на этом устройстве.");
    });
  }, [draftKey, loadedDraftKey, text, selectedFiles]);

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        !(event.target instanceof HTMLElement)
      ) {
        return;
      }

      const fileInput =
        event.target instanceof HTMLInputElement &&
        event.target.type === "file";
      if (
        !fileInput &&
        (event.target.isContentEditable ||
          event.target.closest(
            "input, textarea, select, [contenteditable='true'], button, a",
          ))
      ) {
        return;
      }

      event.preventDefault();
      if (fileInput) event.target.blur();
      formRef.current?.requestSubmit();
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  function addFiles(files: File[]) {
    if (files.length === 0 || isDraftLoading) return;
    setSelectedFiles((currentFiles) => [...currentFiles, ...files]);
  }

  function removeFile(index: number) {
    setSelectedFiles((currentFiles) =>
      currentFiles.filter((_, fileIndex) => fileIndex !== index),
    );
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (isSubmitting || isDraftLoading) return;
    if (!text.trim() && selectedFiles.length === 0) return;

    setIsSubmitting(true);
    try {
      await onSubmit(text, selectedFiles);
      setText("");
      setSelectedFiles([]);
      window.scrollTo(0, 0);
    } catch (error: any) {
      if (error.response?.status === 401) {
        onError("Сессия истекла. Пожалуйста, авторизуйтесь заново.");
      } else {
        onError("Не удалось опубликовать пост. Попробуйте еще раз.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {children}

      <div className="composer-dock">
        <form
          ref={formRef}
          className={`composer${isDragActive ? " is-drag-active" : ""}${
            selectedFiles.length > 0 ? " has-files" : ""
          }`}
          onSubmit={handleSubmit}
          onDragEnter={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            dragDepthRef.current += 1;
            setIsDragActive(true);
          }}
          onDragOver={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(event) => {
            if (!hasFiles(event)) return;
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setIsDragActive(false);
          }}
          onDrop={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            dragDepthRef.current = 0;
            setIsDragActive(false);
            addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          {selectedFiles.length > 0 && (
            <ul className="composer-previews" aria-label="Вложения">
              {selectedFiles.map((file, index) => (
                <FilePreview
                  file={file}
                  index={index}
                  isSubmitting={isSubmitting}
                  onRemove={removeFile}
                  key={`${file.name}-${file.lastModified}-${index}`}
                />
              ))}
            </ul>
          )}

          <textarea
            ref={textareaRef}
            className="textarea textarea-composer"
            rows={1}
            value={text}
            disabled={isDraftLoading}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items)
                .filter(
                  (item) =>
                    item.kind === "file" && item.type.startsWith("image/"),
                )
                .map((item) => item.getAsFile())
                .filter((file): file is File => file !== null);
              if (files.length > 0) {
                event.preventDefault();
                addFiles(files);
              }
            }}
            placeholder={isDraftLoading ? "Загружаю черновик…" : "Что нового?"}
          />

          <div className="composer-footer">
            <div className="composer-tools">
              <label className="composer-tool" title="Прикрепить файлы">
                <svg
                  className="icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span className="composer-tool-label">Прикрепить</span>
                <input
                  className="composer-file-input"
                  type="file"
                  multiple
                  accept="image/*,audio/*,video/*,.zip,.rar,.7z,.tar,.gz,.bz2"
                  disabled={isDraftLoading}
                  onChange={(event) => {
                    addFiles(Array.from(event.currentTarget.files ?? []));
                    event.currentTarget.value = "";
                    event.currentTarget.blur();
                  }}
                />
              </label>

              <AppLink className="composer-tool" to="/posts/new">
                <svg
                  className="icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className="composer-tool-label">Постишка</span>
              </AppLink>
            </div>

            <span className="composer-hint" aria-hidden="true">
              Enter — отправить
            </span>

            <button
              className="composer-send"
              type="submit"
              disabled={!canSubmit}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? (
                <span className="composer-spinner" aria-hidden="true" />
              ) : (
                <svg
                  className="icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              )}
              <span className="composer-send-label"></span>
            </button>
          </div>

          <div className="composer-drop" aria-hidden="true">
            <span>Отпусти, чтобы прикрепить</span>
          </div>
        </form>
      </div>
    </>
  );
}
