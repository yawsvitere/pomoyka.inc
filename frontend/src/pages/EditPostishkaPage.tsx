import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Editor } from "@tiptap/react";
import * as postsApi from "../api/posts";
import type { Post } from "../api/types";
import {
  RichEditor,
  editorToContent,
  hasTextContent,
} from "../components/editor/RichEditor";
import { Spinner } from "../components/ui/Spinner";
import { getBrowserFileUrl } from "../utils/fileUrl";
import { sanitizeEmbedHtml } from "../utils/safeHtml";
import "../styles/pages/article.css";
import "../styles/pages/rte-context-menu.css";

function getEditorContent(post: Post) {
  const documentNode = new DOMParser().parseFromString(
    sanitizeEmbedHtml(post.text ?? "<p></p>"),
    "text/html",
  );
  const markers = documentNode.querySelectorAll("[data-file-index], [data-file-id]");

  markers.forEach((marker) => {
    const fileId = marker.getAttribute("data-file-id");
    const index = Number(marker.getAttribute("data-file-index"));
    const file = fileId
      ? post.files.find((candidate) => candidate.id === fileId)
      : post.files[index];
    if (!file) {
      marker.remove();
      return;
    }

    const attachment = documentNode.createElement("div");
    attachment.setAttribute("data-attachment-id", `existing-${file.id}`);
    attachment.setAttribute("data-file-id", file.id);
    attachment.setAttribute("data-file-name", file.fileName);
    attachment.setAttribute("data-file-url", getBrowserFileUrl(file.downloadUrl));
    attachment.setAttribute("data-content-type", file.contentType);
    marker.replaceWith(attachment);
  });

  if (markers.length === 0 && post.files.length > 0) {
    post.files.forEach((file) => {
      const attachment = documentNode.createElement("div");
      attachment.setAttribute("data-attachment-id", `existing-${file.id}`);
      attachment.setAttribute("data-file-id", file.id);
      attachment.setAttribute("data-file-name", file.fileName);
      attachment.setAttribute("data-file-url", getBrowserFileUrl(file.downloadUrl));
      attachment.setAttribute("data-content-type", file.contentType);
      documentNode.body.appendChild(attachment);
    });
  }

  return documentNode.body.innerHTML || "<p></p>";
}

export function EditPostishkaPage() {
  const { postId } = useParams();
  const navigate = useNavigate();
  const editorRef = useRef<Editor | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [accessLevel, setAccessLevel] = useState<1 | 2>(1);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, forceRerender] = useState(0);

  useEffect(() => {
    if (!postId) return;
    void postsApi
      .getPost(postId)
      .then((loadedPost) => {
        setPost(loadedPost);
        setTitle(loadedPost.title ?? "");
        setDescription(loadedPost.description ?? "");
        setAccessLevel(loadedPost.accessLevel === 2 ? 2 : 1);
      })
      .catch(() => setError("Не удалось загрузить постишку"));
  }, [postId]);

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
    editor.on("update", () => forceRerender((value) => value + 1));
    forceRerender((value) => value + 1);
  }, []);

  if (error && !post) {
    return <div className="article-editor"><p className="article-error">{error}</p></div>;
  }
  if (!post) {
    return <div className="article-editor"><Spinner /></div>;
  }

  const canSave =
    title.trim().length > 0 &&
    !!editorRef.current &&
    hasTextContent(editorRef.current) &&
    !isSubmitting;

  async function save() {
    const editor = editorRef.current;
    if (!postId || !editor || !title.trim() || !hasTextContent(editor)) return;

    setIsSubmitting(true);
    setError("");
    try {
      const { html, files } = editorToContent(editor);
      await postsApi.updateArticle(
        postId,
        title.trim(),
        description.trim(),
        html,
        files,
        accessLevel,
      );
      navigate(`/posts/${postId}`);
    } catch {
      setError("Не удалось сохранить постишку");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="article-editor">
      <p className="article-kicker">Редактирование постишки</p>
      <input
        className="article-title-input"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Заголовок"
        maxLength={200}
      />
      <input
        className="article-description-input"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Короткое описание для списка постишек"
        maxLength={500}
      />
      <RichEditor
        key={post.id}
        initialContent={getEditorContent(post)}
        onReady={handleEditorReady}
      />
      {error && <p className="article-error">{error}</p>}
      <div className="article-editor-actions">
        <Link to={`/posts/${post.id}`}>Отмена</Link>
        <button className="btn btn-primary" type="button" disabled={!canSave} onClick={() => void save()}>
          {isSubmitting ? "Сохраняем..." : "Сохранить"}
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
