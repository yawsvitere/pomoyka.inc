import axios from "axios";
import { apiClient } from "./client";
import { getBrowserFileUrl } from "../utils/fileUrl";

export type FileAccessLevel = 0 | 1 | 2;
export interface FileFolder {
  id: string;
  name: string;
  accessLevel: FileAccessLevel;
  fileCount: number;
  createdAt: string;
  galleryUrl: string;
}
export interface UserFile {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  accessLevel: FileAccessLevel;
  folderId: string | null;
  folderName: string | null;
  uploadedAt: string;
  downloadUrl: string;
  previewUrl?: string | null;
  iconPreviewUrl?: string | null;
  author?: {
    displayName: string;
    nicknameColor: string;
    avatarUrl: string | null;
  } | null;
}
export interface Library {
  folders: FileFolder[];
  files: UserFile[];
}

interface LibraryUploadMetadata {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface PreparedLibraryUpload extends LibraryUploadMetadata {
  file: File;
  storageKey: string;
  uploadUrl: string;
}
export interface StorageQuota {
  usedBytes: number;
  quotaBytes: number;
}
export interface PinterestMedia {
  id: string;
  fileName: string;
  contentType: string;
  width: number | null;
  height: number | null;
  uploadedAt: string;
  downloadUrl: string;
  previewUrl: string | null;
  ownerId: string | null;
  author: {
    displayName: string;
    nicknameColor: string;
    avatarUrl: string | null;
  } | null;
}
export interface PinterestMediaPage {
  items: PinterestMedia[];
  hasMore: boolean;
  authors: PinterestAuthor[];
}
export interface PinterestAuthor {
  id: string;
  displayName: string;
  nicknameColor: string;
  avatarUrl: string | null;
}
export interface PinterestMediaFilters {
  authorId?: string;
  fromDate?: string;
  toDate?: string;
  mediaType?: "image" | "video";
}
export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  imageUrl: string | null;
  siteName: string;
}
export async function getLibrary() {
  return (await apiClient.get<Library>("/api/files/library")).data;
}
export async function getLinkPreview(url: string) {
  return (
    await apiClient.get<LinkPreview>("/api/files/link-preview", {
      params: { url },
    })
  ).data;
}
export async function getCommonLibrary() {
  return (await apiClient.get<Library>("/api/files/common")).data;
}
export async function getQuota() {
  return (await apiClient.get<StorageQuota>("/api/files/quota")).data;
}
export async function getPinterestMedia(
  page = 1,
  pageSize = 50,
  seed = 0,
  filters: PinterestMediaFilters = {},
) {
  return (
    await apiClient.get<PinterestMediaPage>("/api/files/pinterest", {
      params: { page, pageSize, seed, ...filters },
    })
  ).data;
}
export async function getProfileLibrary(displayName: string) {
  return (
    await apiClient.get<Library>(
      `/api/files/profile/${encodeURIComponent(displayName)}/library`,
    )
  ).data;
}
export async function getAuthenticatedFileUrl(url: string) {
  const response = await apiClient.get<Blob>(getBrowserFileUrl(url), {
    responseType: "blob",
  });
  return URL.createObjectURL(response.data);
}
export async function downloadFilesArchive(fileIds: string[]) {
  return (
    await apiClient.post<Blob>(
      "/api/files/library/download-archive",
      { fileIds },
      { responseType: "blob" },
    )
  ).data;
}
export async function downloadFolderArchive(folderId: string) {
  return (
    await apiClient.post<Blob>(
      "/api/files/library/download-archive",
      { folderId },
      { responseType: "blob" },
    )
  ).data;
}
export async function createFolder(name: string, accessLevel: FileAccessLevel) {
  return (
    await apiClient.post<FileFolder>("/api/files/folders", {
      name,
      accessLevel,
    })
  ).data;
}
async function getMediaDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (file.type.startsWith("video/")) {
    const url = URL.createObjectURL(file);
    try {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () =>
          reject(new Error("Unable to read video metadata"));
      });
      return { width: video.videoWidth, height: video.videoHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return null;
}
export async function uploadFile(
  file: File,
  folderId: string | null,
  onUploadProgress?: (percent: number) => void,
) {
  const body = new FormData();
  body.append("file", file);
  if (folderId) body.append("folderId", folderId);
  const dimensions = await getMediaDimensions(file).catch(() => null);
  if (dimensions) {
    body.append("width", String(dimensions.width));
    body.append("height", String(dimensions.height));
  }
  return (
    await apiClient.post<UserFile>("/api/files/library/upload", body, {
      onUploadProgress: (event) => {
        if (event.total)
          onUploadProgress?.(Math.round((event.loaded / event.total) * 100));
      },
    })
  ).data;
}

export async function prepareLibraryUploads(
  files: File[],
  folderId: string | null,
): Promise<PreparedLibraryUpload[]> {
  const metadata = await Promise.all(
    files.map(async (file): Promise<LibraryUploadMetadata> => {
      const dimensions = await getMediaDimensions(file).catch(() => null);
      return {
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      };
    }),
  );
  const response = await apiClient.post<{
    files: { index: number; storageKey: string; uploadUrl: string }[];
  }>("/api/files/library/batch-presign", { folderId, files: metadata });
  const plans = response.data.files.sort((a, b) => a.index - b.index);
  if (plans.length !== files.length)
    throw new Error("Сервер вернул неполный пакет загрузки");
  return plans.map((plan, index) => ({
    ...metadata[index],
    file: files[index],
    storageKey: plan.storageKey,
    uploadUrl: plan.uploadUrl,
  }));
}

export async function uploadLibraryFileDirect(
  upload: PreparedLibraryUpload,
  onUploadProgress?: (percent: number) => void,
) {
  const target = new URL(upload.uploadUrl);
  // In the normal one-domain deployment MinIO is published by nginx under
  // /feed-files. Keep this request same-origin, including its scheme, so a
  // browser cannot upgrade an HTTP localhost URL to unavailable HTTPS.
  const uploadUrl = target.host === window.location.host
    ? `${target.pathname}${target.search}`
    : upload.uploadUrl;
  await axios.put(uploadUrl, upload.file, {
    headers: { "Content-Type": upload.contentType },
    onUploadProgress: (event) => {
      if (event.total)
        onUploadProgress?.(Math.round((event.loaded / event.total) * 100));
    },
  });
}

export async function completeLibraryUploads(
  folderId: string | null,
  uploads: PreparedLibraryUpload[],
) {
  return (
    await apiClient.post<UserFile[]>("/api/files/library/batch-complete", {
      folderId,
      files: uploads.map(({ file, uploadUrl, ...metadata }) => metadata),
    })
  ).data;
}
export async function setFileVisibility(
  id: string,
  accessLevel: FileAccessLevel,
) {
  return (
    await apiClient.patch<UserFile>(`/api/files/library/${id}/visibility`, {
      accessLevel,
    })
  ).data;
}
export async function renameFile(id: string, name: string) {
  return (
    await apiClient.patch<UserFile>(`/api/files/library/${id}/name`, { name })
  ).data;
}
export async function moveFile(id: string, folderId: string | null) {
  return (
    await apiClient.patch<UserFile>(`/api/files/library/${id}/folder`, {
      folderId,
    })
  ).data;
}
export async function setFolderVisibility(
  id: string,
  accessLevel: FileAccessLevel,
) {
  await apiClient.patch(`/api/files/folders/${id}/visibility`, { accessLevel });
}
export async function renameFolder(id: string, name: string) {
  return (
    await apiClient.patch<FileFolder>(`/api/files/folders/${id}/name`, { name })
  ).data;
}
export async function deleteFolder(id: string) {
  await apiClient.delete(`/api/files/folders/${id}`);
}
export async function deleteFile(id: string) {
  await apiClient.delete(`/api/files/library/${id}`);
}
export async function deleteFiles(ids: string[]) {
  await apiClient.delete("/api/files/library", { data: { fileIds: ids } });
}
export async function setFilesVisibility(
  ids: string[],
  accessLevel: FileAccessLevel,
) {
  await apiClient.patch("/api/files/library/visibility", {
    fileIds: ids,
    accessLevel,
  });
}
export async function getGallery(id: string) {
  return (
    await apiClient.get<{
      name: string;
      accessLevel: FileAccessLevel;
      images: {
        id: string;
        fileName: string;
        url: string;
        previewUrl: string | null;
        contentType: string;
        width: number | null;
        height: number | null;
        ownerId: string | null;
        author: {
          displayName: string;
          nicknameColor: string;
          avatarUrl: string | null;
        } | null;
      }[];
    }>(`/api/files/gallery/${id}`)
  ).data;
}
