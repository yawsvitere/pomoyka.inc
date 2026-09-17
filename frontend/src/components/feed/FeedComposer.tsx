import { useState } from "react";
import { Link } from "react-router-dom";

interface FeedComposerProps {
  onSubmit: (text: string, files: File[]) => Promise<void>;
  onError: (message: string) => void;
  children: React.ReactNode;
}

export function FeedComposer({
  onSubmit,
  onError,
  children,
}: FeedComposerProps) {
  const [text, setText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  function removeFile(index: number) {
    setSelectedFiles((currentFiles) =>
      currentFiles.filter((_, fileIndex) => fileIndex !== index),
    );
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
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
        <header className="feed-heading">
          <Link className="btn btn-secondary btn-sm" to="/posts/new">
            + Постишка
          </Link>
        </header>

        <form
          className={`composer${isDragActive ? " is-drag-active" : ""}`}
          onSubmit={handleSubmit}
        >
          <textarea
            className="textarea textarea-composer"
            value={text}
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
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDragLeave={() => {
              setIsDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragActive(false);
              const files = Array.from(event.dataTransfer.files);
              if (files.length > 0) {
                setSelectedFiles((currentFiles) => [...currentFiles, ...files]);
              }
            }}
            onPaste={async (event) => {
              const files = Array.from(event.clipboardData.items)
                .filter(
                  (item) =>
                    item.kind === "file" && item.type.startsWith("image/"),
                )
                .map((item) => item.getAsFile())
                .filter((file): file is File => file !== null);
              if (files.length > 0) {
                event.preventDefault();
                try {
                  setSelectedFiles((currentFiles) => [
                    ...currentFiles,
                    ...files,
                  ]);
                } catch {
                  onError("Не удалось обработать изображение из буфера обмена");
                }
              }
            }}
            placeholder="Что нового?"
          />
          <div className="composer-footer">
            <label className="btn btn-secondary btn-sm">
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
              <span className="attach-label">Прикрепить</span>
              <input
                type="file"
                multiple
                accept="image/*,audio/*,video/*,.zip,.rar,.7z,.tar,.gz,.bz2"
                style={{ display: "none" }}
                onChange={(event) =>
                  setSelectedFiles(Array.from(event.target.files ?? []))
                }
              />
            </label>
            <button
              className="btn btn-primary btn-sm"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Публикуем..." : "Опубликовать"}
            </button>
          </div>
          {selectedFiles.length > 0 && (
            <ul className="composer-selected-files">
              {selectedFiles.map((file, index) => (
                <li className="composer-file-chip" key={`${file.name}-${index}`}>
                  <span>{file.name}</span>
                  <button
                    type="button"
                    aria-label={`Удалить ${file.name}`}
                    onClick={() => removeFile(index)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      </div>
    </>
  );
}