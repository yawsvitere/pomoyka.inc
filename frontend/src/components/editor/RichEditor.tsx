import { useCallback, useEffect, useRef, useState } from "react";
import {
  EditorContent,
  useEditor,
  type Editor,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Node, mergeAttributes } from "@tiptap/core";
import { DOMSerializer, Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { sanitizeEmbedHtml } from "../../utils/safeHtml";

export type UploadedFile = { localId: string; file: File; url?: string };

const fileRegistry = new Map<string, UploadedFile>();

function registerFile(file: File): string {
  const localId = `att_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const isImage = file.type.startsWith("image/");
  fileRegistry.set(localId, {
    localId,
    file,
    url: isImage ? URL.createObjectURL(file) : undefined,
  });
  return localId;
}

function AttachmentView({ node, deleteNode }: any) {
  const localId = node.attrs.localId as string;
  const entry = fileRegistry.get(localId);
  const fileName = entry?.file.name ?? node.attrs.fileName ?? "Вложение";
  const fileUrl = entry?.url ?? node.attrs.fileUrl;
  const contentType = entry?.file.type ?? node.attrs.contentType ?? "";
  const isImage = contentType.startsWith("image/");

  return (
    <NodeViewWrapper className="rte-attachment-wrapper" data-drag-handle>
      {isImage ? (
        <div className="rte-image-block">
          {fileUrl && <img src={fileUrl} alt={fileName} />}
          <button
            type="button"
            className="rte-attachment-remove"
            onClick={() => deleteNode()}
            aria-label="Удалить изображение"
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="rte-file-block">
          <span className="rte-file-icon">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
          </span>
          <span className="rte-file-meta">
            <strong>{fileName}</strong>
            <small>
              {entry ? `${Math.round(entry.file.size / 1024)} KB` : "Сохранённый файл"}
            </small>
          </span>
          <button
            type="button"
            className="rte-attachment-remove rte-attachment-remove-inline"
            onClick={() => deleteNode()}
            aria-label="Удалить файл"
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}

const AttachmentNode = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      localId: { default: null },
      fileId: { default: null },
      fileName: { default: null },
      fileUrl: { default: null },
      contentType: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-attachment-id]",
        getAttrs: (el) => ({
          localId: (el as HTMLElement).getAttribute("data-attachment-id"),
          fileId: (el as HTMLElement).getAttribute("data-file-id"),
          fileName: (el as HTMLElement).getAttribute("data-file-name"),
          fileUrl: (el as HTMLElement).getAttribute("data-file-url"),
          contentType: (el as HTMLElement).getAttribute("data-content-type"),
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({
        "data-attachment-id": HTMLAttributes.localId,
        "data-file-id": HTMLAttributes.fileId,
        "data-file-name": HTMLAttributes.fileName,
        "data-file-url": HTMLAttributes.fileUrl,
        "data-content-type": HTMLAttributes.contentType,
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView);
  },
});

function HtmlEmbedView({ node, deleteNode }: any) {
  return (
    <NodeViewWrapper className="rte-html-embed">
      <div className="rte-html-embed-label">HTML-виджет</div>
      <div
        dangerouslySetInnerHTML={{ __html: sanitizeEmbedHtml(node.attrs.html) }}
      />
      <button
        type="button"
        className="rte-embed-remove"
        onClick={() => deleteNode()}
      >
        Удалить виджет
      </button>
    </NodeViewWrapper>
  );
}

const HtmlEmbedNode = Node.create({
  name: "htmlEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { html: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-html-embed]",
        getAttrs: (el) => ({
          html: (el as HTMLElement).getAttribute("data-html") ?? "",
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const html = HTMLAttributes.html ?? "";
    return [
      "div",
      mergeAttributes({ "data-html-embed": "", "data-html": html }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(HtmlEmbedView);
  },
});

function insertFilesAtSelection(editor: Editor, files: File[]) {
  const content = files.flatMap((file) => {
    const localId = registerFile(file);
    return [{ type: "attachment", attrs: { localId } }, { type: "paragraph" }];
  });
  if (content.length) editor.chain().focus().insertContent(content).run();
}

export function editorToContent(editor: Editor): {
  html: string;
  files: File[];
} {
  const files: File[] = [];
  let currentHtml = "";
  const serializer = DOMSerializer.fromSchema(editor.schema);

  editor.state.doc.forEach((node) => {
    if (node.type.name === "attachment") {
      const entry = fileRegistry.get(node.attrs.localId);
      if (entry) {
        const fileIndex = files.length;
        files.push(entry.file);
        currentHtml += `<span data-file-index="${fileIndex}"></span>`;
      } else if (node.attrs.fileId) {
        currentHtml += `<span data-file-id="${node.attrs.fileId}"></span>`;
      }
    } else if (node.type.name === "htmlEmbed") {
      const embed = document.createElement("div");
      embed.setAttribute("data-html-embed", "true");
      embed.setAttribute("data-html", sanitizeEmbedHtml(node.attrs.html));
      currentHtml += embed.outerHTML;
    } else {
      const dom = serializer.serializeNode(node) as HTMLElement;
      const wrapper = document.createElement("div");
      wrapper.appendChild(dom);
      currentHtml += wrapper.innerHTML;
    }
  });
  return { html: currentHtml, files };
}

export function hasTextContent(editor: Editor): boolean {
  return editor.state.doc.textContent.trim().length > 0;
}

type MenuState = { x: number; y: number } | null;

function toggleSelectedBlockquote(
  editor: Editor,
  selection: { from: number; to: number },
) {
  const { doc } = editor.state;
  const $from = doc.resolve(selection.from);
  const $to = doc.resolve(selection.to);
  let paragraphDepth = -1;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "paragraph") {
      paragraphDepth = depth;
      break;
    }
  }

  const isSingleParagraph =
    paragraphDepth > 0 &&
    $from.node(paragraphDepth) === $to.node(paragraphDepth) &&
    $from.node(paragraphDepth - 1).type.name === "doc";

  if (!isSingleParagraph) {
    editor
      .chain()
      .focus()
      .setTextSelection(selection)
      .toggleBlockquote()
      .run();
    return;
  }

  const paragraph = $from.node(paragraphDepth);
  const paragraphStart = $from.start(paragraphDepth);
  const start = selection.from - paragraphStart;
  const end = selection.to - paragraphStart;
  const before = paragraph.content.cut(0, start);
  const selected = paragraph.copy(paragraph.content.cut(start, end));
  const after = paragraph.content.cut(end);
  const blockquote = doc.type.schema.nodes.blockquote.create(
    null,
    selected,
  );
  const replacement = [
    ...(before.size ? [paragraph.copy(before)] : []),
    blockquote,
    ...(after.size ? [paragraph.copy(after)] : []),
  ];
  const paragraphPos = $from.before(paragraphDepth);
  const transaction = editor.state.tr.replaceWith(
    paragraphPos,
    paragraphPos + paragraph.nodeSize,
    Fragment.fromArray(replacement),
  );
  const selectedStart =
    paragraphPos + (before.size ? before.size + 2 : 0) + 2;
  transaction.setSelection(
    TextSelection.create(
      transaction.doc,
      selectedStart,
      selectedStart + selected.content.size,
    ),
  );
  editor.view.dispatch(transaction);
  editor.view.focus();
}

function MenuItem({
  active,
  disabled,
  onSelect,
  icon,
  label,
}: {
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`rte-menu-item${active ? " rte-menu-item-active" : ""}`}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
    >
      <span className="rte-menu-icon">{icon}</span>
      <span className="rte-menu-label">{label}</span>
      {active && (
        <svg
          className="rte-menu-check"
          viewBox="0 0 20 20"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 10.5l4 4 8-9" />
        </svg>
      )}
    </button>
  );
}

function SelectionContextMenu({
  editor,
  canvasRef,
  onAddEmbed,
}: {
  editor: Editor;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  onAddEmbed: () => void;
}) {
  const [menu, setMenu] = useState<MenuState>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<{ from: number; to: number } | null>(null);

  const setLink = useCallback(() => {
    const selection = selectionRef.current;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL ссылки", previous ?? "https://");
    setMenu(null);
    if (url === null) return;
    if (selection) editor.commands.setTextSelection(selection);
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url.trim() })
      .run();
  }, [editor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onContextMenu(e: MouseEvent) {
      const { from, to, empty } = editor.state.selection;
      e.preventDefault();
      selectionRef.current = { from, to: empty ? from : to };
      setMenu({ x: e.clientX, y: e.clientY });
    }

    canvas.addEventListener("contextmenu", onContextMenu);
    return () => canvas.removeEventListener("contextmenu", onContextMenu);
  }, [editor, canvasRef]);

  useEffect(() => {
    if (!menu) return;
    function onDocClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as globalThis.Node)
      )
        setMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    function onScroll() {
      setMenu(null);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu]);

  if (!menu) return null;

  const copySelection = async () => {
    const selection = selectionRef.current;
    if (!selection || !navigator.clipboard) return;

    const text = editor.state.doc.textBetween(
      selection.from,
      selection.to,
      "\n",
    );
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access can be denied by the browser or page context.
    }
    setMenu(null);
  };

  const pasteFromClipboard = async () => {
    const selection = selectionRef.current;
    if (!selection || !navigator.clipboard) return;

    try {
      const text = await navigator.clipboard.readText();
      editor
        .chain()
        .focus()
        .setTextSelection(selection)
        .insertContent(text)
        .run();
    } catch {
      // Clipboard access can be denied by the browser or page context.
    }
    setMenu(null);
  };

  const cutSelection = async () => {
    const selection = selectionRef.current;
    if (!selection || !navigator.clipboard) return;

    const text = editor.state.doc.textBetween(
      selection.from,
      selection.to,
      "\n",
    );
    try {
      await navigator.clipboard.writeText(text);
      editor.chain().focus().setTextSelection(selection).deleteSelection().run();
    } catch {
      // Clipboard access can be denied by the browser or page context.
    }
    setMenu(null);
  };

  const deleteSelection = () => {
    const selection = selectionRef.current;
    if (!selection) return;
    editor.chain().focus().setTextSelection(selection).deleteSelection().run();
    setMenu(null);
  };

  const uploadMedia = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*,audio/*,video/*,.zip,.rar,.7z,.tar,.gz,.bz2,.pdf";
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      if (files.length) {
        const selection = selectionRef.current;
        if (selection) editor.commands.setTextSelection(selection);
        insertFilesAtSelection(editor, files);
      }
      setMenu(null);
    });
    input.click();
  };

  const menuWidth = 248;
  const menuHeight = 560;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - menuWidth));
  const opensAbove = menu.y > window.innerHeight - menuHeight;
  const top = Math.max(8, opensAbove ? menu.y - menuHeight : menu.y);
  const clampedX = left !== menu.x;
  const clampedY = opensAbove;
  const style: React.CSSProperties = {
    position: "fixed",
    left,
    top,
    transformOrigin: `${clampedX ? "right" : "left"} ${clampedY ? "bottom" : "top"}`,
  };

  const run = (
    command: (chain: ReturnType<Editor["chain"]>) => void,
  ) => () => {
    const selection = selectionRef.current;
    if (!selection) return;

    const chain = editor.chain().focus().setTextSelection(selection);
    command(chain);
    chain.run();
    setMenu(null);
  };

  return (
    <div className="rte-context-menu" ref={menuRef} style={style} role="menu">
      <MenuItem
        label="Копировать"
        disabled={selectionRef.current?.from === selectionRef.current?.to}
        onSelect={copySelection}
        icon={
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        }
      />
      <MenuItem
        label="Вставить"
        onSelect={pasteFromClipboard}
        icon={
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" />
          </svg>
        }
      />
      <MenuItem
        label="Загрузить медиа"
        onSelect={uploadMedia}
        icon={
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3v12M7 8l5-5 5 5M5 21h14a2 2 0 0 0 2-2v-4M3 15v4a2 2 0 0 0 2 2" />
          </svg>
        }
      />
      <MenuItem
        label="Вырезать"
        disabled={selectionRef.current?.from === selectionRef.current?.to}
        onSelect={cutSelection}
        icon={
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="6" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="m8.5 7.5 10 10M8.5 16.5l4.5-4.5M18.5 6.5l-3 3" />
          </svg>
        }
      />
      <MenuItem
        label="Удалить"
        disabled={selectionRef.current?.from === selectionRef.current?.to}
        onSelect={deleteSelection}
        icon={
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
          </svg>
        }
      />
      <div className="rte-menu-divider" />
      <MenuItem
        label="Жирный"
        active={editor.isActive("bold")}
        onSelect={run((chain) => chain.toggleBold())}
        icon={<strong>B</strong>}
      />
      <MenuItem
        label="Курсив"
        active={editor.isActive("italic")}
        onSelect={run((chain) => chain.toggleItalic())}
        icon={<em>I</em>}
      />
      <MenuItem
        label="Подчёркнутый"
        active={editor.isActive("underline")}
        onSelect={run((chain) => chain.toggleUnderline())}
        icon={<span style={{ textDecoration: "underline" }}>U</span>}
      />
      <MenuItem
        label="Зачёркнутый"
        active={editor.isActive("strike")}
        onSelect={run((chain) => chain.toggleStrike())}
        icon={<s>S</s>}
      />
      <div className="rte-menu-divider" />
      <MenuItem
        label="Заголовок"
        active={editor.isActive("heading", { level: 2 })}
        onSelect={run((chain) => chain.toggleHeading({ level: 2 }))}
        icon="H"
      />
      <MenuItem
        label="Цитата"
        active={editor.isActive("blockquote")}
        onSelect={() => {
          const selection = selectionRef.current;
          if (!selection) return;
          toggleSelectedBlockquote(editor, selection);
          setMenu(null);
        }}
        icon={'"'}
      />
      <div className="rte-menu-divider" />
      <MenuItem
        label="Маркированный список"
        active={editor.isActive("bulletList")}
        onSelect={run(() => editor.chain().focus().toggleBulletList().run())}
        icon={
          <svg
            viewBox="0 0 20 20"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <circle cx="3" cy="5" r="1" fill="currentColor" stroke="none" />
            <circle cx="3" cy="10" r="1" fill="currentColor" stroke="none" />
            <circle cx="3" cy="15" r="1" fill="currentColor" stroke="none" />
            <path d="M7 5h10M7 10h10M7 15h10" />
          </svg>
        }
      />
      <MenuItem
        label="Нумерованный список"
        active={editor.isActive("orderedList")}
        onSelect={run(() => editor.chain().focus().toggleOrderedList().run())}
        icon={
          <svg
            viewBox="0 0 20 20"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M8 5h9M8 10h9M8 15h9" />
            <text x="0" y="6.5" fontSize="5" fill="currentColor" stroke="none">
              1
            </text>
            <text x="0" y="11.5" fontSize="5" fill="currentColor" stroke="none">
              2
            </text>
            <text x="0" y="16.5" fontSize="5" fill="currentColor" stroke="none">
              3
            </text>
          </svg>
        }
      />
      <div className="rte-menu-divider" />
      <MenuItem
        label={editor.isActive("link") ? "Изменить ссылку" : "Вставить ссылку"}
        active={editor.isActive("link")}
        onSelect={setLink}
        icon={
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        }
      />
      <MenuItem
        label="HTML-виджет"
        onSelect={() => {
          onAddEmbed();
          setMenu(null);
        }}
        icon="<>"
      />
    </div>
  );
}



export function RichEditor({
  onReady,
  initialContent = "<p></p>",
}: {
  onReady: (editor: Editor) => void;
  initialContent?: string;
}) {
  const [, forceRerender] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const editorInstance = useRef<Editor | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({
        placeholder: ({ node, editor: e }) => {
          if (node.type.name === "paragraph" && e.state.doc.childCount === 1) {
            return "Начните писать... вставляйте картинки прямо из буфера обмена";
          }
          return "";
        },
      }),
      AttachmentNode,
      HtmlEmbedNode,
    ],
    content: initialContent,
    editorProps: {
      attributes: { class: "rte-content", spellCheck: "true" },
      handlePaste(_view, event) {
        const items = Array.from(event.clipboardData?.items ?? []);
        const itemFiles = items
          .filter(
            (item) => item.kind === "file" && item.type.startsWith("image/"),
          )
          .map((item) => item.getAsFile())
          .filter((file): file is File => !!file);
        const clipboardFiles = Array.from(
          event.clipboardData?.files ?? [],
        ).filter((file) => file.type.startsWith("image/"));
        const files = itemFiles.length ? itemFiles : clipboardFiles;
        if (!files.length) return false;
        event.preventDefault();
        if (files.length && editorInstance.current)
          insertFilesAtSelection(editorInstance.current, files);
        return true;
      },
    },
    onUpdate: () => forceRerender((n) => n + 1),
  });

  useEffect(() => {
    if (editor) {
      editorInstance.current = editor;
      onReady(editor);
    }
  }, [editor, onReady]);

  if (!editor) return null;

  return (
    <div className="rte-shell">

      <div
        className="rte-canvas"
        ref={canvasRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const osFiles = Array.from(e.dataTransfer.files ?? []);
          if (osFiles.length) {
            e.preventDefault();
            insertFilesAtSelection(editor, osFiles);
          }
        }}
      >
        <EditorContent editor={editor} />
      </div>
      <SelectionContextMenu
        editor={editor}
        canvasRef={canvasRef}
        onAddEmbed={() => {
          const html = window.prompt(
            "Вставьте HTML-код виджета (поддерживается Spotify iframe)",
          );
          const safeHtml = html ? sanitizeEmbedHtml(html) : "";
          if (safeHtml)
            editor
              .chain()
              .focus()
              .insertContent({ type: "htmlEmbed", attrs: { html: safeHtml } })
              .run();
        }}
      />
    </div>
  );
}
