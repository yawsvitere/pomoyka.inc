import { apiClient } from './client';
import type { FeedBanner, Post } from './types';

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
  const { data } = await apiClient.get<AdminUser[]>('/api/admin/users');
  return data;
}

export async function getStorageSummary() {
  const { data } = await apiClient.get<AdminStorageSummary>('/api/admin/storage-summary');
  return data;
}

export async function updateStorageSettings(totalQuotaBytes: number, defaultUserQuotaBytes: number) {
  const { data } = await apiClient.put<AdminStorageSummary>('/api/admin/storage-settings', {
    totalQuotaBytes,
    defaultUserQuotaBytes,
  });
  return data;
}

export async function updateUserStorageQuota(id: string, quotaBytes: number | null) {
  const { data } = await apiClient.put<{ quotaBytes: number | null }>(`/api/admin/users/${id}/storage-quota`, {
    quotaBytes,
  });
  return data;
}

export async function createInviteCode(name: string, expiresInHours: number | null) {
  const { data } = await apiClient.post<AdminInviteCode>('/api/admin/invite-codes', {
    name,
    expiresInHours,
  });
  return data;
}

export async function changeRole(id: string, role: string) {
  await apiClient.put(`/api/admin/users/${id}/role`, { role });
}

export interface AdminInviteCode {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  usedAt: string | null;
  usedById: string | null;
}

export async function getInviteCodes() {
  const { data } = await apiClient.get<AdminInviteCode[]>('/api/admin/invite-codes');
  return data;
}

export async function deleteInviteCode(id: string) {
  await apiClient.delete(`/api/admin/invite-codes/${id}`);
}

export async function getBanners() {
  const { data } = await apiClient.get<FeedBanner[]>('/api/admin/banners');
  return data;
}

export async function addBanner(postId: string) {
  const { data } = await apiClient.post<FeedBanner>('/api/admin/banners', { postId });
  return data;
}

export async function deleteBanner(id: string) {
  await apiClient.delete(`/api/admin/banners/${id}`);
}

export async function getPostishki() {
  const { data } = await apiClient.get<Post[]>('/api/posts/postishki', {
    params: { page: 1, pageSize: 100 },
  });
  return data;
}