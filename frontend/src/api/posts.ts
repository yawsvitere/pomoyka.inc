import { apiClient } from "./client";
import type { Comment, FeedBanner, Post, PostFile, PostReaction } from "./types";

export async function getFeed(page = 1, pageSize = 20) {
  const { data } = await apiClient.get<Post[]>("/api/posts", {
    params: { page, pageSize },
  });
  return data;
}

export async function getFeedBanners() {
  const { data } = await apiClient.get<FeedBanner[]>('/api/banners');
  return data;
}

export async function getPostishki(page = 1, pageSize = 20) {
  const { data } = await apiClient.get<Post[]>('/api/posts/postishki', {
    params: { page, pageSize },
  });
  return data;
}

export async function createPost(text: string) {
  const { data } = await apiClient.post<Post>("/api/posts", { text });
  return data;
}

export async function deletePost(id: string) {
  await apiClient.delete(`/api/posts/${id}`);
}

export async function createComment(postId: string, text: string) {
  const { data } = await apiClient.post<Comment>(
    `/api/posts/${postId}/comments`,
    { text },
  );
  return data;
}

export async function uploadPostFile(postId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await apiClient.post<PostFile>(
    `/api/files/post/${postId}`,
    formData,
  );
  return data;
}

export async function getUserPosts(displayName: string) {
  const { data } = await apiClient.get<Post[]>("/api/posts/by-user", {
    params: { displayName },
  });
  return data;
}

export async function togglePostLike(postId: string) {
  const { data } = await apiClient.post<{ liked: boolean; likeCount: number }>(
    `/api/likes/post/${postId}`,
  );
  return data;
}

export async function toggleCommentLike(commentId: string) {
  const { data } = await apiClient.post<{ liked: boolean; likeCount: number }>(
    `/api/likes/comment/${commentId}`,
  );
  return data;
}

export async function createArticle(
  title: string,
  description: string,
  text: string,
  files: File[],
  accessLevel: 1 | 2,
) {
  const formData = new FormData();
  formData.append("title", title);
  formData.append("description", description);
  formData.append("text", text);
  formData.append("accessLevel", String(accessLevel));
  files.forEach((file) => formData.append("files", file, file.name));
  const { data } = await apiClient.post<Post>("/api/posts/article", formData);
  return data;
}

export async function updateArticle(
  id: string,
  title: string,
  description: string,
  text: string,
  files: File[],
  accessLevel: 1 | 2,
) {
  const formData = new FormData();
  formData.append("title", title);
  formData.append("description", description);
  formData.append("text", text);
  formData.append("accessLevel", String(accessLevel));
  files.forEach((file) => formData.append("files", file, file.name));
  const { data } = await apiClient.put<Post>(
    `/api/posts/${id}/article`,
    formData,
  );
  return data;
}

export async function getPost(id: string) {
  const { data } = await apiClient.get<Post>(`/api/posts/${id}`);
  return data;
}

export async function getPublicPost(id: string) {
  const { data } = await apiClient.get<Post>(`/api/posts/public/${id}`);
  return data;
}

export async function setPostReaction(postId: string, emoji: string) {
  const { data } = await apiClient.put<{
    reactionCounts: Record<string, number>;
    reactions: PostReaction[];
  }>(`/api/reactions/post/${postId}`, { emoji });
  return data;
}
