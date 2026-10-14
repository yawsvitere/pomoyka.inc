import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

interface CommentComposerProps {
  onSubmit: (text: string, files: File[]) => Promise<boolean>;
}

const MAX_LENGTH = 1000;
const MAX_FILES = 6;

export function CommentComposer({ onSubmit }: CommentComposerProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "36px";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const canSend = text.trim().length > 0 && !isSubmitting;

  function addFiles(newFiles: File[]) {
    const images = newFiles.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    setFiles((current) => [...current, ...images].slice(0, MAX_FILES));
  }

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      if (await onSubmit(trimmed, files)) {
        setText("");
        setFiles([]);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      addFiles(pasted);
    }
  }

  const showCounter = text.length > MAX_LENGTH * 0.8;

  return (
    <form className="comment-composer" onSubmit={handleSubmit}>
      {previews.length > 0 && (
        <div className="comment-previews">
          {previews.map((url, index) => (
            <div className="comment-preview" key={url}>
              <img src={url} alt="" />
              <button
                type="button"
                aria-label="Убрать фото"
                disabled={isSubmitting}
                onClick={() =>
                  setFiles((current) => current.filter((_, i) => i !== index))
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="comment-bar">
        <label
          className="comment-circle-btn comment-photo-btn"
          data-tooltip="Добавить фото"
          data-count={files.length > 0 ? files.length : undefined}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="m21 16-4.5-4.5a1.5 1.5 0 0 0-2.1 0L6 20" />
          </svg>
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="Добавить фото к комментарию"
            disabled={isSubmitting || files.length >= MAX_FILES}
            onChange={(event) => {
              addFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
        </label>

        <textarea
          ref={textareaRef}
          className="comment-textarea"
          name="comment"
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Написать комментарий..."
          maxLength={MAX_LENGTH}
          disabled={isSubmitting}
        />

        {showCounter && (
          <span
            className={`comment-counter${text.length >= MAX_LENGTH ? " is-limit" : ""}`}
          >
            {MAX_LENGTH - text.length}
          </span>
        )}

        <button
          className="comment-circle-btn comment-send"
          type="submit"
          aria-label="Отправить комментарий"
          data-tooltip="Отправить"
          disabled={!canSend}
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
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
      </div>
    </form>
  );
}
