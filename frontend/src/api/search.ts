import { apiClient } from "./client";

export interface SearchUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface SearchFile {
  id: string;
  fileName: string;
  kind: "user" | "post";
}

export interface SearchDate {
  date: string;
  postCount: number;
}

export interface SearchPost {
  id: string;
  title: string | null;
  text: string | null;
  isPostishka: boolean;
  createdAt: string;
}

export interface SearchResponse {
  users: SearchUser[];
  files: SearchFile[];
  dates: SearchDate[];
  posts: SearchPost[];
}

export async function search(query: string) {
  const response = await apiClient.get<SearchResponse>("/api/search", {
    params: { query },
  });
  return response.data;
}