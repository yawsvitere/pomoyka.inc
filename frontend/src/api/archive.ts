import { apiClient } from "./client";
import type { Comment, PostBlock, PostFile, User } from "./types";

export interface ArchiveDay {
  date: string;
  postCount: number;
  postishkaCount: number;
  participantCount: number;
  closedAt: string;
}

export interface ArchiveCalendarMonth {
  year: number;
  month: number;
  days: ArchiveDay[];
}

export interface ArchivePost {
  id: string;
  text: string | null;
  title: string | null;
  isArticle: boolean;
  blocks: PostBlock[];
  createdAt: string;
  author: User;
  files: PostFile[];
  comments: Comment[];
  likeCount: number;
  isLiked: boolean;
}

export interface ArchiveDayDetail {
  date: string;
  postCount: number;
  postishkaCount: number;
  participantCount: number;
  closedAt: string;
  posts: ArchivePost[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export async function getArchiveCalendar(year: number, month: number) {
  const { data } = await apiClient.get<ArchiveCalendarMonth>(
    `/api/archive/calendar/${year}/${month}`,
  );
  return data;
}

export async function getArchiveDay(
  year: number,
  month: number,
  day: number,
  page = 1,
  pageSize = 20,
) {
  const { data } = await apiClient.get<ArchiveDayDetail>(
    `/api/archive/${year}/${month}/${day}`,
    { params: { page, pageSize } },
  );
  return data;
}

export async function getArchivedPost(id: string) {
  const { data } = await apiClient.get<ArchivePost>(`/api/archive/post/${id}`);
  return data;
}
