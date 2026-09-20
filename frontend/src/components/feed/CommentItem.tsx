import type { Comment } from "../../api/types";
import { AvatarMedia } from "../ui/AvatarMedia";
import { getBrowserFileUrl } from "../../utils/fileUrl";

interface CommentItemProps {
  comment: Comment;
  onLike?: (commentId: string) => void;
}

export function CommentItem({ comment, onLike }: CommentItemProps) {
  return (
    <div className="comment">
      {comment.author.avatarUrl ? (
        <AvatarMedia
          className="comment-avatar"
          src={getBrowserFileUrl(comment.author.avatarUrl)}
          alt=""
        />
      ) : (
        <span className="comment-avatar comment-avatar-fallback">
          {comment.author.displayName.charAt(0).toUpperCase()}
        </span>
      )}
      <div className="comment-content">
        <div>
          <strong style={{ color: comment.author.nicknameColor ?? "#4f46e5" }}>
            {comment.author.displayName}
          </strong>
          <time>
            {new Date(comment.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
        <p>{comment.text}</p>
        {onLike && (
          <button
            className={`icon-action${comment.isLiked ? " is-active" : ""}`}
            type="button"
            onClick={() => onLike(comment.id)}
          >
            <svg
              className="icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            {comment.likeCount || ""}
          </button>
        )}
      </div>
    </div>
  );
}
