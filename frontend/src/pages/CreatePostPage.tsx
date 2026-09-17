import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Editor } from "@tiptap/react";
import * as postsApi from "../api/posts";
import {
  RichEditor,
  editorToContent,
  hasTextContent,
} from "../components/editor/RichEditor";
import "../styles/pages/article.css";
import "../styles/pages/rte-context-menu.css";

export function CreatePostPage() {
  const navigate = useNavigate();
  const editorRef = useRef<Editor | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [accessLevel, setAccessLevel] = useState<1 | 2>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [, forceRerender] = useState(0);

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
    editor.on("update", () => forceRerender((n) => n + 1));
    forceRerender((n) => n + 1);
  }, []);

  const canPublish =
    title.trim().length > 0 &&
    !!editorRef.current &&
    hasTextContent(editorRef.current) &&
    !isSubmitting;

  async function publish() {
    const editor = editorRef.current;
    const cleanTitle = title.trim();
    if (!editor || !cleanTitle || !hasTextContent(editor)) return;

    setIsSubmitting(true);
    setError("");
    try {
      const { html, files } = editorToContent(editor);
      await postsApi.createArticle(
        cleanTitle,
        description.trim(),
        html,
        files,
        accessLevel,
      );
      navigate("/posts");
    } catch {
      setError("Не удалось опубликовать");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="article-editor">

      <input
        className="article-title-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Заголовок"
        maxLength={200}
      />
      <input
        className="article-description-input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Короткое описание для списка постишек"
        maxLength={500}
      />

      <RichEditor onReady={handleEditorReady} />

      {error && <p className="article-error">{error}</p>}
      <div className="article-editor-actions">
        <Link to="/">Отмена</Link>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!canPublish}
          onClick={() => void publish()}
        >
          {isSubmitting ? "Публикуем..." : "Опубликовать"}
        </button>
      </div>
      <div className="article-access-row">
        <span>Публичный</span>
        <button
          type="button"
          className={`btn-pill-toggle${accessLevel === 2 ? " is-public" : ""}`}
          aria-label={accessLevel === 2 ? "Сделать доступным только авторизованным" : "Сделать публичным"}
          aria-pressed={accessLevel === 2}
          onClick={() => setAccessLevel((level) => (level === 1 ? 2 : 1))}
        >
          <span aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
