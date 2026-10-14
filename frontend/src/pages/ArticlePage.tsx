import {
  Fragment,
  createElement,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PhotoProvider, PhotoView } from "react-photo-view";
import * as postsApi from "../api/posts";
import type { Comment, Post } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { CommentItem } from "../components/feed/CommentItem";
import { CommentComposer } from "../components/feed/CommentComposer";
import { ErrorPage } from "../components/ui/ErrorPage";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../components/ui/useToast";
import shareIcon from "../assets/icons/share.svg";
import { sanitizeEmbedHtml } from "../utils/safeHtml";
import { getBrowserFileUrl } from "../utils/fileUrl";
import { AvatarMedia } from "../components/ui/AvatarMedia";
import { getPostishkaUrl } from "../utils/postishkaUrl";
import "../styles/pages/article.css";
import "../styles/components/comment.css";
import "../styles/components/post.css";
import "react-photo-view/dist/react-photo-view.css";

function articleDocument(post: Post) {
  const documentParser = new DOMParser();
  const documentNode = documentParser.parseFromString(
    sanitizeEmbedHtml(post.text ?? ""),
    "text/html",
  );
  const markers = documentNode.querySelectorAll(
    "[data-file-index], [data-file-id]",
  );
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
    if (file.contentType.startsWith("image/")) {
      const image = documentNode.createElement("img");
      image.src = getBrowserFileUrl(file.downloadUrl);
      image.alt = file.fileName;
      marker.replaceWith(image);
    } else {
      const link = documentNode.createElement("a");
      link.className = "article-file";
      link.href = getBrowserFileUrl(file.downloadUrl);
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = file.fileName;
      marker.replaceWith(link);
    }
  });
  if (markers.length === 0 && post.files.length > 0) {
    post.files.forEach((file) => {
      if (file.contentType.startsWith("image/")) {
        const image = documentNode.createElement("img");
        image.src = getBrowserFileUrl(file.downloadUrl);
        image.alt = file.fileName;
        documentNode.body.appendChild(image);
      } else {
        const link = documentNode.createElement("a");
        link.className = "article-file";
        link.href = getBrowserFileUrl(file.downloadUrl);
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = file.fileName;
        documentNode.body.appendChild(link);
      }
    });
  }
  return documentNode;
}

function renderArticleNode(node: Node, post: Post): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();

  if (element.hasAttribute("data-gallery-widget")) {
    const url = getSafeWebUrl(element.dataset.galleryUrl);
    if (!url) return null;
    const imageUrl = getSafeWebUrl(element.dataset.galleryImage);
    const title = element.dataset.galleryTitle || element.dataset.gallerySite || url;
    const description = element.dataset.galleryDescription;
    const siteName = element.dataset.gallerySite;
    return (
      <a
        className="article-gallery-widget"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {imageUrl && <img src={imageUrl} alt="" loading="lazy" />}
        <span className="article-gallery-widget-copy">
          <strong>{title}</strong>
          {description && <small>{description}</small>}
          {siteName && <small>{siteName}</small>}
        </span>
      </a>
    );
  }

  if (element.hasAttribute("data-html-embed")) {
    const html = element.getAttribute("data-html") ?? "";
    return (
      <div
        className="article-html-embed"
        dangerouslySetInnerHTML={{ __html: sanitizeEmbedHtml(html) }}
      />
    );
  }

  if (element.tagName === "IMG") {
    const src = element.getAttribute("src");
    if (!src) return null;
    return (
      <PhotoView src={src}>
        <img src={src} alt={element.getAttribute("alt") ?? ""} />
      </PhotoView>
    );
  }

  const props: Record<string, unknown> = {};
  Array.from(element.attributes).forEach((attribute) => {
    if (attribute.name === "class") props.className = attribute.value;
    else if (attribute.name === "href") props.href = attribute.value;
    else if (attribute.name === "style") {
      props.style = Object.fromEntries(
        attribute.value
          .split(";")
          .map((declaration) => {
            const separator = declaration.indexOf(":");
            if (separator < 1) return [];
            const property = declaration
              .slice(0, separator)
              .trim()
              .replace(/-([a-z])/g, (_, letter: string) =>
                letter.toUpperCase(),
              );
            return [property, declaration.slice(separator + 1).trim()];
          })
          .filter((entry) => entry.length > 0),
      );
    } else props[attribute.name] = attribute.value;
  });

  if (
    [
      "area",
      "base",
      "br",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "source",
      "track",
      "wbr",
    ].includes(tagName)
  ) {
    return createElement(tagName, props);
  }

  const children = Array.from(element.childNodes).map((child, index) => (
    <Fragment key={index}>{renderArticleNode(child, post)}</Fragment>
  ));
  return createElement(tagName, props, children);
}

function getSafeWebUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function ArticleContent({ post }: { post: Post }) {
  const documentNode = articleDocument(post);
  return (
    <>
      {Array.from(documentNode.body.childNodes).map((node, index) => (
        <Fragment key={index}>{renderArticleNode(node, post)}</Fragment>
      ))}
    </>
  );
}

function getAuthorInitials(displayName: string) {
  return displayName.trim().slice(0, 2).toUpperCase() || "?";
}

export function ArticlePage({ publicOnly = false }: { publicOnly?: boolean }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { notify } = useToast();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<404 | 500 | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!slug) {
      setPost(null);
      setError(404);
      return;
    }
    setPost(null);
    setError(null);
    const isLegacyId =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        slug,
      );
    void (
      isLegacyId
        ? postsApi[publicOnly ? "getPublicPost" : "getPost"](slug)
        : postsApi[publicOnly ? "getPublicPostBySlug" : "getPostBySlug"](slug)
    )
      .then(setPost)
      .catch((requestError: { response?: { status?: number } }) =>
        setError(requestError.response?.status === 404 ? 404 : 500),
      );
  }, [slug, publicOnly]);

  useEffect(() => {
    if (!post) return;
    const readableUrl = getPostishkaUrl(post, publicOnly);
    if (window.location.pathname !== readableUrl)
      navigate(readableUrl, { replace: true });
  }, [navigate, post, publicOnly]);

  useEffect(() => {
    if (!post || !user) return;

    const postId = post.id;
    const connection = new HubConnectionBuilder()
      .withUrl(`${import.meta.env.VITE_API_URL ?? ""}/hubs/feed`, {
        accessTokenFactory: () => localStorage.getItem("token") ?? "",
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    connection.on(
      "CommentReactionChanged",
      (
        changedPostId: string,
        commentId: string,
        result: {
          reactionCounts: Record<string, number>;
          reactions: Comment["reactions"];
        },
      ) => {
        if (changedPostId !== postId) return;
        setPost((current) =>
          current?.id === postId
            ? {
                ...current,
                comments: current.comments.map((comment) =>
                  comment.id === commentId
                    ? {
                        ...comment,
                        reactionCounts: result.reactionCounts,
                        reactions: result.reactions,
                      }
                    : comment,
                ),
              }
            : current,
        );
      },
    );

    void connection.start().catch(() => undefined);
    return () => {
      void connection.stop();
    };
  }, [post?.id, user?.id]);

  useEffect(() => {
    if (!post) return;

    const previousTitle = document.title;
    const descriptionMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    const previousDescription = descriptionMeta?.content;
    const title = post.title?.trim() || "Без заголовка";
    const ogImage = `${window.location.origin}/og/${post.id}.png`;

    document.title = `Помойка.inc | ${title}`;
    if (descriptionMeta) {
      descriptionMeta.content =
        post.description?.trim() ||
        `Постишка «${title}» от ${post.author.displayName}.`;
    }

    const setMeta = (selector: string, content: string, attrName: "property" | "name") => {
      let tag = document.head.querySelector(selector) as HTMLMetaElement | null;
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(attrName, selector.split('"')[1]);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };

    setMeta('meta[property="og:title"]', `Помойка.inc | ${title}`, "property");
    setMeta('meta[property="og:description"]', post.description?.trim() || `Постишка «${title}» от ${post.author.displayName}.`, "property");
    setMeta('meta[property="og:image"]', ogImage, "property");
    setMeta('meta[property="og:type"]', "website", "property");
    setMeta('meta[property="og:url"]', `${window.location.origin}${getPostishkaUrl(post, post.accessLevel === 2)}`, "property");
    setMeta('meta[name="twitter:card"]', "summary_large_image", "name");
    setMeta('meta[name="twitter:title"]', `Помойка.inc | ${title}`, "name");
    setMeta('meta[name="twitter:description"]', post.description?.trim() || `Постишка «${title}» от ${post.author.displayName}.`, "name");
    setMeta('meta[name="twitter:image"]', ogImage, "name");

    return () => {
      document.title = previousTitle;
      if (descriptionMeta && previousDescription !== undefined)
        descriptionMeta.content = previousDescription;
    };
  }, [post]);

  async function handleCommentSubmit(
    text: string,
    files: File[],
  ): Promise<boolean> {
    if (!post || !text.trim()) return false;
    try {
      const comment = await postsApi.createComment(post.id, text, files);
      setPost((current) =>
        current?.id === post.id &&
        !current.comments.some((item) => item.id === comment.id)
          ? { ...current, comments: [...current.comments, comment] }
          : current,
      );
      notify("success", "Комментарий добавлен");
      return true;
    } catch {
      notify("error", "Не удалось добавить комментарий");
      return false;
    }
  }

  async function handleCommentReaction(commentId: string, emoji: string) {
    try {
      const result = await postsApi.setCommentReaction(commentId, emoji);
      setPost((current) =>
        current
          ? {
              ...current,
              comments: current.comments.map((comment) =>
                comment.id === commentId
                  ? {
                      ...comment,
                      reactionCounts: result.reactionCounts,
                      reactions: result.reactions,
                    }
                  : comment,
              ),
            }
          : current,
      );
    } catch {
      notify("error", "Не удалось оценить комментарий");
    }
  }

  if (error === 404)
    return <ErrorPage status={404} title="Постишка не найдена" description="Она была закрыта владельцем или такого адреса не существует." />;
  if (error === 500)
    return <ErrorPage status={500} title="Не удалось открыть постишку" description="При загрузке постишки произошла ошибка. Попробуйте еще раз позже." />;
  if (!post)
    return (
      <div className="article-reader">
        <p>
          <Spinner />
        </p>
      </div>
    );

  const shareUrl = `${window.location.origin}${getPostishkaUrl(post, post.accessLevel === 2)}`;

  return (
    <PhotoProvider>
      <article className="article-reader">
        <p className="article-kicker">
          Постишка · {new Date(post.createdAt).toLocaleDateString()}
        </p>
        <h1>{post.title ?? post.text}</h1>
        <div className="article-share-row">
          <button
            type="button"
            className="btn btn-ghost btn-sm article-share-button"
            onClick={() => {
              void navigator.clipboard
                .writeText(shareUrl)
                .then(() => {
                  setIsCopied(true);
                  window.setTimeout(() => setIsCopied(false), 1800);
                });
            }}
          >
            <img className="article-share-icon" src={shareIcon} alt="" aria-hidden="true" />
            <span>{isCopied ? "Ссылка скопирована" : "Поделиться"}</span>
          </button>
        </div>
        <div className="article-byline">
          <Link
            className="article-author"
            to={`/profile/${encodeURIComponent(post.author.displayName)}`}
            style={{ color: post.author.nicknameColor ?? "#4f46e5" }}
          >
            {post.author.avatarUrl ? (
              <AvatarMedia
                className="article-author-avatar"
                src={getBrowserFileUrl(post.author.avatarUrl)}
                alt=""
              />
            ) : (
              <span className="article-author-avatar article-author-avatar-fallback">
                {getAuthorInitials(post.author.displayName)}
              </span>
            )}
            <span className="article-author-name">{post.author.displayName}</span>
          </Link>
        </div>
        <div className="article-content">
          {post.text && (
            <div className="article-rich-content">
              <ArticleContent post={post} />
            </div>
          )}
        </div>
        <section
          className="article-comments post-comments"
          aria-labelledby="article-comments-title"
        >
          <h2 id="article-comments-title">
            Комментарии <span>{post.comments.length}</span>
          </h2>
          {post.comments.length > 0 ? (
            post.comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onReaction={user ? handleCommentReaction : undefined}
              />
            ))
          ) : (
            <p className="article-comments-empty">Комментариев пока нет.</p>
          )}
          {user ? (
            <CommentComposer onSubmit={handleCommentSubmit} />
          ) : (
            <p className="article-comments-sign-in">
              <Link to="/auth">Войдите</Link>, чтобы оставить комментарий.
            </p>
          )}
        </section>
      </article>
    </PhotoProvider>
  );
}
