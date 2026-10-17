import { apiClient } from "./client";
import type { FeedBanner, FeedPoll, Post } from "./types";

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  nicknameColor?: string | null;
  avatarUrl: string | null;
  createdAt: string;
  roles: string[];
  storageUsedBytes: number;
  storageQuotaBytes?: number | null;
  effectiveStorageQuotaBytes: number;
  isOnline: boolean;
  lastSeenAt?: string | null;
}

export interface AdminStorageSummary {
  totalQuotaBytes: number;
  usedBytes: number;
  defaultUserQuotaBytes: number;
  userCount: number;
  measuredAt: string;
}

export async function getUsers() {
  const { data } = await apiClient.get<AdminUser[]>("/api/admin/users");
  return data;
}

export async function getStorageSummary() {
  const { data } = await apiClient.get<AdminStorageSummary>(
    "/api/admin/storage-summary",
  );
  return data;
}

export async function updateStorageSettings(
  totalQuotaBytes: number,
  defaultUserQuotaBytes: number,
) {
  const { data } = await apiClient.put<AdminStorageSummary>(
    "/api/admin/storage-settings",
    {
      totalQuotaBytes,
      defaultUserQuotaBytes,
    },
  );
  return data;
}

export async function updateUserStorageQuota(
  id: string,
  quotaBytes: number | null,
) {
  const { data } = await apiClient.put<{ quotaBytes: number | null }>(
    `/api/admin/users/${id}/storage-quota`,
    {
      quotaBytes,
    },
  );
  return data;
}

export async function updateUserProfile(
  id: string,
  email: string,
  displayName: string,
) {
  const { data } = await apiClient.put<{
    email: string;
    displayName: string;
  }>(`/api/admin/users/${id}/profile`, { email, displayName });
  return data;
}

export async function generateUserPassword(id: string) {
  const { data } = await apiClient.post<{ password: string }>(
    `/api/admin/users/${id}/generate-password`,
  );
  return data.password;
}

export async function createInviteCode(
  name: string,
  expiresInHours: number | null,
) {
  const { data } = await apiClient.post<AdminInviteCode>(
    "/api/admin/invite-codes",
    {
      name,
      expiresInHours,
    },
  );
  return data;
}

export async function uploadInviteImage(inviteId: string, file: File) {
  const formData = new FormData();
  formData.append("inviteId", inviteId);
  formData.append("file", file);
  const { data } = await apiClient.post<string>(
    "/api/files/invite-image",
    formData,
  );
  return data;
}

export async function changeRole(id: string, role: string) {
  await apiClient.put(`/api/admin/users/${id}/role`, { role });
}

export interface AdminInviteCode {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  createdAt: string;
  expiresAt: string | null;
  usedAt: string | null;
  usedById: string | null;
}

export async function getInviteCodes() {
  const { data } = await apiClient.get<AdminInviteCode[]>(
    "/api/admin/invite-codes",
  );
  return data;
}

export async function deleteInviteCode(id: string) {
  await apiClient.delete(`/api/admin/invite-codes/${id}`);
}

export async function getBanners() {
  const { data } = await apiClient.get<FeedBanner[]>("/api/admin/banners");
  return data;
}

export async function addBanner(postId: string) {
  const { data } = await apiClient.post<FeedBanner>("/api/admin/banners", {
    postId,
  });
  return data;
}

export async function deleteBanner(id: string) {
  await apiClient.delete(`/api/admin/banners/${id}`);
}

export async function getPolls() {
  const { data } = await apiClient.get<FeedPoll[]>("/api/admin/polls");
  return data;
}

export async function createPoll(request: {
  question: string;
  endsAt: string;
  isAnonymous: boolean;
  allowUserOptions: boolean;
  allowMultipleChoices: boolean;
  options: string[];
}) {
  const { data } = await apiClient.post<FeedPoll>("/api/admin/polls", request);
  return data;
}

export async function deletePoll(id: string) {
  await apiClient.delete(`/api/admin/polls/${id}`);
}

export async function getPostishki() {
  const { data } = await apiClient.get<Post[]>("/api/posts/postishki", {
    params: { page: 1, pageSize: 100 },
  });
  return data;
}
