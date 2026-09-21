import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { PhotoSlider } from "react-photo-view";
import * as postsApi from "../api/posts";
import * as authApi from "../api/auth";
import * as filesApi from "../api/files";
import type { Post, User } from "../api/types";
import { Spinner } from "../components/ui/Spinner";
import { PostCard } from "../components/feed/PostCard";
import { MediaModal } from "../components/ui/MediaModal";
import { getBrowserFileUrl } from "../utils/fileUrl";
import { AvatarMedia } from "../components/ui/AvatarMedia";
import folderIcon from "../assets/icons/folder.svg";
import "react-photo-view/dist/react-photo-view.css";
import "../styles/components/post.css";
import "../styles/pages/file-manager.css";
import "../styles/pages/profile.css";

type ProfileData = {
  profile: User;
  posts: Post[];
  files: filesApi.UserFile[];
  folders: filesApi.FileFolder[];
};

type ProfileCacheEntry = {
  data: ProfileData;
  updatedAt: number;
};

const PROFILE_CACHE_TTL_MS = 30_000;
const profileCache = new Map<string, ProfileCacheEntry>();
const profileRequests = new Map<string, Promise<ProfileData>>();

function loadProfile(displayName: string) {
  const existingRequest = profileRequests.get(displayName);
  if (existingRequest) return existingRequest;

  const request = Promise.all([
    authApi.getProfile(displayName),
    postsApi.getUserPosts(displayName),
    filesApi.getProfileLibrary(displayName),
  ]).then(([profile, posts, library]) => ({
    profile,
    posts: posts.filter((post) => post.isPostishka),
    files: library.files,
    folders: library.folders,
  }));

  profileRequests.set(displayName, request);
  request.then(
    () => {
      if (profileRequests.get(displayName) === request) {
        profileRequests.delete(displayName);
      }
    },
    () => {
      if (profileRequests.get(displayName) === request) {
        profileRequests.delete(displayName);
      }
    },
  );

  return request;
}

function formatFileSize(bytes: number) {
  if (!bytes) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex ? 1 : 0)} ${units[unitIndex]}`;
}

function fileInitials(name: string) {
  return (name.split(".")[0] || name).slice(0, 2).toUpperCase();
}

function isImageFile(file: filesApi.UserFile) {
  return (
    file.contentType.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i.test(file.fileName)
  );
}

function isVideoFile(file: filesApi.UserFile) {
  return (
    file.contentType.startsWith("video/") ||
    /\.(mp4|webm|mov|m4v|ogv|avi|mkv)$/i.test(file.fileName)
  );
}

function isAudioFile(file: filesApi.UserFile) {
  return (
    file.contentType.startsWith("audio/") ||
    /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i.test(file.fileName)
  );
}

function ProfileFileRow({ file }: { file: filesApi.UserFile }) {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [activeMedia, setActiveMedia] = useState<{
    type: "video" | "audio";
    name: string;
    url: string;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  async function openFile() {
    if (isLoading) return;

    try {
      if (isImageFile(file)) {
        if (url) {
          setIsViewerOpen(true);
          return;
        }

        setIsLoading(true);
        const loadedUrl = await filesApi.getAuthenticatedFileUrl(
          file.downloadUrl,
        );
        setUrl(loadedUrl);
        setIsViewerOpen(true);
        return;
      }

      if (isVideoFile(file) || isAudioFile(file)) {
        const loadedUrl = await filesApi.getAuthenticatedFileUrl(
          file.downloadUrl,
        );
        setActiveMedia({
          type: isVideoFile(file) ? "video" : "audio",
          name: file.fileName,
          url: loadedUrl,
        });
        return;
      }

      const newWindow = window.open("", "_blank");
      setIsLoading(true);
      const loadedUrl = await filesApi.getAuthenticatedFileUrl(
        file.downloadUrl,
      );
      if (newWindow) {
        newWindow.location.href = loadedUrl;
      } else {
        window.location.href = loadedUrl;
      }
    } catch {
      if (isImageFile(file)) {
        setIsViewerOpen(false);
      }
    } finally {
      setIsLoading(false);
    }
  }

  const previewUrl = isImageFile(file)
    ? getBrowserFileUrl(file.previewUrl || file.downloadUrl)
    : undefined;

  return (
    <>
      <div className="fm-file-row profile-file-row">
        <span className="fm-file-name">
          {isImageFile(file) ? (
            <img
              className="fm-image-preview"
              src={previewUrl}
              alt=""
              loading="lazy"
              style={{ width: 34, height: 34, objectFit: "cover" }}
            />
          ) : (
            <span className="fm-file-avatar">
              {isVideoFile(file)
                ? "VID"
                : isAudioFile(file)
                  ? "AUD"
                  : fileInitials(file.fileName)}
            </span>
          )}
          <span className="fm-file-meta">
            <a
              href={url ?? "#"}
              target={isImageFile(file) ? undefined : "_blank"}
              rel={isImageFile(file) ? undefined : "noreferrer"}
              onClick={(event) => {
                if (
                  isImageFile(file) ||
                  isVideoFile(file) ||
                  isAudioFile(file)
                ) {
                  event.preventDefault();
                  void openFile();
                  return;
                }

                if (url) return;
                event.preventDefault();
                void openFile();
              }}
            >
              <strong>{file.fileName}</strong>
            </a>
            <small>
              {file.contentType ||
                file.fileName.split(".").pop()?.toUpperCase()}
            </small>
          </span>
        </span>
        <span className="fm-cell">{formatFileSize(file.sizeBytes)}</span>
        <span className="fm-cell">
          {new Date(file.uploadedAt).toLocaleDateString("ru-RU")}
        </span>
        <span className={`fm-badge${file.accessLevel === 2 ? " public" : ""}`}>
          {file.accessLevel === 2 ? "Публичный" : "Братва"}
        </span>
      </div>

      {isImageFile(file) && url && (
        <PhotoSlider
          images={[{ key: file.id, src: url }]}
          index={0}
          visible={isViewerOpen}
          onClose={() => setIsViewerOpen(false)}
        />
      )}

      {activeMedia && (
        <MediaModal
          type={activeMedia.type}
          name={activeMedia.name}
          url={activeMedia.url}
          onClose={() => setActiveMedia(null)}
        />
      )}
    </>
  );
}

export function ProfilePage() {
  const { userId: displayName } = useParams();
  const [posts, setPosts] = useState<Post[]>([]);
  const [profile, setProfile] = useState<User | null>(null);
  const [files, setFiles] = useState<filesApi.UserFile[]>([]);
  const [folders, setFolders] = useState<filesApi.FileFolder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!displayName) {
      setIsLoading(false);
      return;
    }

    let active = true;
    const cached = profileCache.get(displayName);
    const hasCachedData = Boolean(cached);

    if (cached) {
      setProfile(cached.data.profile);
      setPosts(cached.data.posts);
      setFiles(cached.data.files);
      setFolders(cached.data.folders);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    setError("");

    const isCacheFresh =
      cached && Date.now() - cached.updatedAt < PROFILE_CACHE_TTL_MS;
    if (isCacheFresh)
      return () => {
        active = false;
      };

    void loadProfile(displayName)
      .then((data) => {
        profileCache.set(displayName, { data, updatedAt: Date.now() });
        if (!active) return;
        setProfile(data.profile);
        setPosts(data.posts);
        setFiles(data.files);
        setFolders(data.folders);
      })
      .catch(() => {
        if (active && !hasCachedData) {
          setError("Не удалось загрузить профиль");
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [displayName]);

  const currentFolder = folders.find((folder) => folder.id === folderId);
  const visibleFolders = useMemo(
    () => (folderId ? [] : folders),
    [folderId, folders],
  );
  const visibleFiles = useMemo(
    () => files.filter((file) => file.folderId === folderId),
    [files, folderId],
  );

  return (
    <div className="profile-page">
      {isLoading ? (
        <p className="profile-loading">
          <Spinner />
        </p>
      ) : error ? (
        <p className="auth-error">{error}</p>
      ) : profile ? (
        <>
          <header className="profile-header">
            <div
              className="profile-banner"
              style={
                profile.bannerUrl
                  ? {
                      backgroundImage: `url(${getBrowserFileUrl(profile.bannerUrl)})`,
                    }
                  : undefined
              }
            />
            <div className="profile-header-content">
              {profile.avatarUrl ? (
                <AvatarMedia
                  src={getBrowserFileUrl(profile.avatarUrl)}
                  alt=""
                  className="profile-avatar"
                />
              ) : (
                <div className="profile-avatar profile-avatar-fallback">
                  {profile.displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="profile-details">
                <div className="profile-status-line">
                  <span
                    className={`profile-status ${profile.isOnline ? "online" : "offline"}`}
                  >
                    {profile.isOnline ? "Онлайн" : "Не в сети"}
                  </span>
                  {!profile.isOnline && profile.lastSeenAt && (
                    <span className="profile-last-seen">
                      Был в сети{" "}
                      {new Date(profile.lastSeenAt).toLocaleString("ru-RU", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  )}
                </div>
                <p className="profile-email">{profile.email}</p>
                <h1 style={{ color: profile.nicknameColor ?? "#4f46e5" }}>
                  {profile.displayName}
                </h1>
                {profile.about && (
                  <p className="profile-about">{profile.about}</p>
                )}
              </div>
            </div>
          </header>
          <section className="profile-files">
            <div className="fm-list profile-files-list">
              <nav className="fm-breadcrumb profile-files-breadcrumb">
                <button
                  type="button"
                  className={!folderId ? "is-current" : undefined}
                  onClick={() => setFolderId(null)}
                >
                  Все файлы
                </button>
                {currentFolder && (
                  <>
                    <span className="fm-breadcrumb-sep">/</span>
                    <span className="fm-breadcrumb-current">
                      {currentFolder.name}
                    </span>
                  </>
                )}
              </nav>
              <div className="fm-table-head">
                <span>Имя</span>
                <span>Размер</span>
                <span>Загружен</span>
                <span>Доступ</span>
              </div>
              <div className="fm-list-scroll">
                {folderId && (
                  <button
                    type="button"
                    className="fm-file-row profile-folder-row profile-up-row"
                    onClick={() => setFolderId(null)}
                  >
                    <span className="fm-file-name">
                      <img className="fm-folder-mark" src={folderIcon} alt="" />
                      <span className="fm-file-meta">
                        <strong>..</strong>
                        <small>Назад</small>
                      </span>
                    </span>
                    <span />
                    <span className="fm-cell" />
                    <span className="fm-badge">Вверх</span>
                  </button>
                )}
                {visibleFolders.map((folder) => (
                  <button
                    type="button"
                    className="fm-file-row profile-folder-row"
                    key={folder.id}
                    onClick={() => setFolderId(folder.id)}
                  >
                    <span className="fm-file-name">
                      <img className="fm-folder-mark" src={folderIcon} alt="" />
                      <span className="fm-file-meta">
                        <strong>{folder.name}</strong>
                        <small>{folder.fileCount} файлов</small>
                      </span>
                    </span>
                    <span />
                    <span className="fm-cell">
                      {new Date(folder.createdAt).toLocaleDateString("ru-RU")}
                    </span>
                    <span className="fm-badge">
                      {folder.accessLevel === 2 ? "Публичный" : "Братва"}
                    </span>
                  </button>
                ))}
                {visibleFiles.map((file) => (
                  <ProfileFileRow key={file.id} file={file} />
                ))}
                {visibleFolders.length === 0 && visibleFiles.length === 0 && (
                  <div className="fm-empty">Открытых файлов пока нет</div>
                )}
              </div>
            </div>
          </section>
          <section className="profile-posts">
            <h2>Постишки</h2>
            {posts.map((post, index) => (
              <PostCard
                key={post.id}
                post={post}
                showAuthor={
                  index === 0 ||
                  (posts[index - 1].author.id !== post.author.id &&
                    posts[index - 1].author.displayName !==
                      post.author.displayName)
                }
                authorLinks
                showArticleLink
              />
            ))}
            {posts.length === 0 && (
              <p className="profile-empty">Постишек пока нет.</p>
            )}
          </section>
        </>
      ) : (
        <p>Профиль не найден.</p>
      )}
    </div>
  );
}
