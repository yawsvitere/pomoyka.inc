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
}
export interface Library {
  folders: FileFolder[];
  files: UserFile[];
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
}
export async function getLibrary() {
  return (await apiClient.get<Library>("/api/files/library")).data;
}
export async function getCommonLibrary() {
  return (await apiClient.get<Library>("/api/files/common")).data;
}
export async function getQuota() {
  return (await apiClient.get<StorageQuota>("/api/files/quota")).data;
}
export async function getPinterestMedia() {
  return (await apiClient.get<PinterestMedia[]>("/api/files/pinterest")).data;
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
  if (file.type.startsWith("image/")) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
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
export async function getGallery(id: string) {
  return (
    await apiClient.get<{
      name: string;
      images: {
        id: string;
        fileName: string;
        url: string;
        previewUrl: string | null;
        contentType: string;
        width: number | null;
        height: number | null;
      }[];
    }>(`/api/files/gallery/${id}`)
  ).data;
}
