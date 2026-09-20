export interface User {
  id: string;
  email: string;
  displayName: string;
  welcomeName?: string | null;
  welcomeImageUrl?: string | null;
  nicknameColor?: string | null;
  avatarUrl: string | null;
  bannerUrl?: string | null;
  about?: string | null;
  hasSeenWelcome: boolean;
  isOnline?: boolean;
  lastSeenAt?: string | null;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: User;
}

export interface PostFile {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
  previewUrl?: string;
}

export interface Post {
  id: string;
  text: string | null;
  title: string | null;
  description?: string | null;
  isArticle: boolean;
  isPostishka?: boolean;
  accessLevel?: 1 | 2;
  relatedPostId?: string | null;
  blocks: PostBlock[];
  createdAt: string;
  author: User;
  files: PostFile[];
  comments: Comment[];
  likeCount: number;
  isLiked: boolean;
  reactionCounts: Record<string, number>;
  reactions: PostReaction[];
}

export interface PostReaction {
  emoji: string;
  user: User;
}

export interface Comment {
  id: string;
  text: string;
  createdAt: string;
  author: User;
  likeCount: number;
  isLiked: boolean;
}

export interface PostBlock {
  id: string;
  sortOrder: number;
  type: "text" | "image" | "file";
  text: string | null;
  file: PostFile | null;
}

export interface FeedBanner {
  id: string;
  postId: string;
  title: string;
  createdAt: string;
  imageUrl: string | null;
}
