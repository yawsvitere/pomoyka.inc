import { apiClient } from './client';
import type { AuthResponse, User } from './types';

export async function register(email: string, password: string, displayName: string, inviteCode: string) {
  const { data } = await apiClient.post<AuthResponse>('/api/auth/register', {
    email,
    password,
    displayName,
    inviteCode,
  });
  return data;
}

export async function login(email: string, password: string) {
  const { data } = await apiClient.post<AuthResponse>('/api/auth/login', {
    email,
    password,
  });
  return data;
}

export async function refreshToken() {
  const { data } = await apiClient.post<AuthResponse>('/api/auth/refresh');
  return data;
}

export async function verifyInviteCode(code: string) {
  const { data } = await apiClient.post<{ valid: boolean }>('/api/auth/verify-code', { code });
  return data;
}

export async function updateProfile(displayName: string, nicknameColor?: string, about?: string) {
  const { data } = await apiClient.put<User>('/api/auth/me', { displayName, nicknameColor, about });
  return data;
}

export async function getProfile(displayName: string) {
  const { data } = await apiClient.get<User>(`/api/auth/profile/${encodeURIComponent(displayName)}`);
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  await apiClient.put('/api/auth/password', { currentPassword, newPassword });
}

export async function uploadAvatar(file: File, crop?: { x: number; y: number; width: number; height: number }) {
  const formData = new FormData();
  formData.append('file', file);
  if (crop) {
    formData.append('cropX', String(Math.round(crop.x)));
    formData.append('cropY', String(Math.round(crop.y)));
    formData.append('cropWidth', String(Math.round(crop.width)));
    formData.append('cropHeight', String(Math.round(crop.height)));
  }
  const { data } = await apiClient.post<string>('/api/files/avatar', formData);
  return data;
}

export async function uploadBanner(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await apiClient.post<string>('/api/files/banner', formData);
  return data;
}

export async function markWelcomeAsSeen() {
  const { data } = await apiClient.post<User>('/api/auth/welcome-seen');
  return data;
}